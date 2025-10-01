import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { scanConsoleLogsInText } from "./scanner";
import { TextOccurrence, FileLogOccurrences, BackupData } from "./types";
import { findWorkspaceScriptFiles, getRelativePath } from "./fileUtils";

let lastBackup: BackupData | null = null;

interface RemovalStrategy {
  range: vscode.Range;
  replacement?: string;
  requiresConfirmation: boolean;
  context: string;
}

interface RemovalResult {
  filePath: string;
  relativePath: string;
  removals: Array<{
    line: number;
    originalCode: string;
    action: "removed" | "replaced";
    replacement?: string;
    context: string;
  }>;
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("No-Logs extension is activating...");

  // Main cleanup command (simplified workflow)
  const cleanCmd = vscode.commands.registerCommand("noLogs.clean", async () => {
    console.log("Clean command triggered");
    await runCleanupWorkflow();
  });

  // Rollback command
  const rollbackCmd = vscode.commands.registerCommand("noLogs.rollback", async () => {
    console.log("Rollback command triggered");
    await performRollback();
  });

  // Preview only command
  const previewCmd = vscode.commands.registerCommand("noLogs.preview", async () => {
    console.log("Preview command triggered");
    await runPreviewOnly();
  });

  context.subscriptions.push(cleanCmd, rollbackCmd, previewCmd);
  console.log("No-Logs extension activated successfully");
}

export function deactivate() {
  console.log("No-Logs extension deactivated");
}

async function runCleanupWorkflow() {
  console.log("Starting cleanup workflow...");

  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage(
        "No-Logs: No workspace folder is open. Please open a folder or workspace."
      );
      return;
    }

    // Step 1: Scan files
    const findings = await scanWorkspace();
    if (!findings || findings.length === 0) {
      return;
    }

    // Step 2: Show preview with quick pick
    const shouldProceed = await showPreviewAndConfirm(findings);
    if (!shouldProceed) {
      vscode.window.showInformationMessage("No-Logs: Cleanup cancelled.");
      return;
    }

    // Step 3: Perform cleanup with backup
    await performCleanup(findings);
  } catch (error) {
    console.error("Error in runCleanupWorkflow:", error);
    vscode.window.showErrorMessage(
      `No-Logs: Error during cleanup: ${(error as Error).message}`
    );
  }
}

async function runPreviewOnly() {
  try {
    const findings = await scanWorkspace();
    if (!findings || findings.length === 0) {
      return;
    }
    await showDetailedPreview(findings);
  } catch (error) {
    console.error("Error in runPreviewOnly:", error);
    vscode.window.showErrorMessage(
      `No-Logs: Error during preview: ${(error as Error).message}`
    );
  }
}

async function scanWorkspace(): Promise<FileLogOccurrences[] | null> {
  const files = await findWorkspaceScriptFiles();
  console.log(`Found ${files.length} files to scan`);

  if (files.length === 0) {
    vscode.window.showInformationMessage(
      "No-Logs: No JavaScript/TypeScript files found in the workspace."
    );
    return null;
  }

  const findings: FileLogOccurrences[] = [];
  let total = 0;
  let processedFiles = 0;
  let skippedFiles = 0;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Scanning for console statements...",
      cancellable: false,
    },
    async (progress) => {
      for (let i = 0; i < files.length; i++) {
        const uri = files[i];
        const filename = getRelativePath(uri);

        progress.report({
          increment: (1 / files.length) * 100,
          message: `${i + 1}/${files.length}: ${filename}`,
        });

        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          const text = doc.getText();

          if (text.length > 5_000_000) {
            skippedFiles++;
            continue;
          }

          const occurrences = scanConsoleLogsInText(text);
          if (occurrences.length > 0) {
            findings.push({
              filePath: uri.fsPath,
              occurrences,
            });
            total += occurrences.length;
          }

          processedFiles++;
        } catch (error) {
          console.error(`Error scanning ${filename}:`, error);
          skippedFiles++;
        }
      }
    }
  );

  if (total === 0) {
    let message = `No-Logs: ✨ No console statements found! (scanned ${processedFiles} files`;
    if (skippedFiles > 0) message += `, skipped ${skippedFiles}`;
    message += `)`;
    vscode.window.showInformationMessage(message);
    return null;
  }

  return findings;
}

async function showPreviewAndConfirm(findings: FileLogOccurrences[]): Promise<boolean> {
  const total = findings.reduce((acc, f) => acc + f.occurrences.length, 0);
  const fileCount = findings.length;

  // Calculate risky removals
  let riskyCount = 0;
  for (const file of findings) {
    const uri = vscode.Uri.file(file.filePath);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      for (const occ of file.occurrences) {
        const strategy = calculateSmartRemoval(doc, occ);
        if (strategy?.requiresConfirmation) {
          riskyCount++;
        }
      }
    } catch (error) {
      // Skip
    }
  }

  let message = `Found ${total} console statement${total === 1 ? "" : "s"} across ${fileCount} file${fileCount === 1 ? "" : "s"}`;
  let detail = "A backup will be created automatically. You can rollback anytime using 'No Logs: Rollback Last Cleanup'.\n\n";
  detail += "A detailed report will be saved to '.no-logs-report.md' in your workspace.";

  if (riskyCount > 0) {
    detail += `\n\n⚠️ Warning: ${riskyCount} statement${riskyCount === 1 ? '' : 's'} in complex expressions will be replaced with safe alternatives.`;
  }

  const choice = await vscode.window.showWarningMessage(
    message,
    {
      modal: true,
      detail,
    },
    "Remove All",
    "Show Details",
    "Cancel"
  );

  if (choice === "Show Details") {
    await showDetailedPreview(findings);
    // Ask again after showing details
    return await showPreviewAndConfirm(findings);
  }

  return choice === "Remove All";
}

async function showDetailedPreview(findings: FileLogOccurrences[]) {
  const items: vscode.QuickPickItem[] = [];

  for (const file of findings) {
    const rel = getRelativePath(vscode.Uri.file(file.filePath));
    for (const occ of file.occurrences) {
      items.push({
        label: `📍 ${rel}:${occ.startLine + 1}`,
        description: occ.preview,
        detail: `console.${occ.method}(...)`,
      });
    }
  }

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: false,
    title: `${items.length} console statements found`,
    placeHolder: "Select to jump to location (preview only)",
  });

  if (selected) {
    const match = selected.label.match(/📍 (.+):(\d+)/);
    if (match) {
      const [, filePath, lineStr] = match;
      const line = parseInt(lineStr, 10) - 1;
      const file = findings.find((f) =>
        getRelativePath(vscode.Uri.file(f.filePath)).includes(filePath)
      );
      if (file) {
        const doc = await vscode.workspace.openTextDocument(file.filePath);
        const editor = await vscode.window.showTextDocument(doc);
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter
        );
      }
    }
  }
}

async function performCleanup(findings: FileLogOccurrences[]) {
  // Create backup first
  const backup = await createBackup(findings);
  if (!backup) {
    vscode.window.showErrorMessage("No-Logs: Failed to create backup. Cleanup cancelled.");
    return;
  }

  lastBackup = backup;

  let successCount = 0;
  let failCount = 0;
  let replacementCount = 0;
  const removalResults: RemovalResult[] = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Removing console statements...",
      cancellable: false,
    },
    async (progress) => {
      for (let i = 0; i < findings.length; i++) {
        const file = findings[i];
        const filename = getRelativePath(vscode.Uri.file(file.filePath));

        progress.report({
          increment: (1 / findings.length) * 100,
          message: `${i + 1}/${findings.length}: ${filename}`,
        });

        try {
          const result = await processFileWithDetails(file);
          if (result.success) {
            successCount += result.removed;
            replacementCount += result.replaced;
            if (result.details) {
              removalResults.push(result.details);
            }
          } else {
            failCount += file.occurrences.length;
          }
        } catch (error) {
          failCount += file.occurrences.length;
          console.error(`Error processing ${filename}:`, error);
        }
      }
    }
  );

  // Generate report
  await generateReport(removalResults, successCount, replacementCount, failCount);

  // Show result
  if (successCount > 0) {
    let message = `✅ Successfully removed ${successCount} console statement${successCount === 1 ? "" : "s"}`;
    if (replacementCount > 0) {
      message += ` (${replacementCount} replaced)`;
    }
    if (failCount > 0) {
      message += `. ⚠️ ${failCount} failed`;
    }
    vscode.window.showInformationMessage(message);
    
    // Offer to open report
    const openReport = await vscode.window.showInformationMessage(
      "Report saved to .no-logs-report.md",
      "Open Report"
    );
    if (openReport === "Open Report") {
      await openReportFile();
    }
  } else {
    vscode.window.showWarningMessage("No-Logs: No console statements were removed.");
  }
}

async function createBackup(findings: FileLogOccurrences[]): Promise<BackupData | null> {
  try {
    const backupData: BackupData = {
      timestamp: new Date().toISOString(),
      files: []
    };

    for (const file of findings) {
      const uri = vscode.Uri.file(file.filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      backupData.files.push({
        filePath: file.filePath,
        originalContent: doc.getText()
      });
    }

    console.log(`Backup created for ${backupData.files.length} files`);
    return backupData;
  } catch (error) {
    console.error("Error creating backup:", error);
    return null;
  }
}

async function performRollback() {
  if (!lastBackup) {
    vscode.window.showWarningMessage(
      "No-Logs: No backup found. Nothing to rollback."
    );
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Rollback to state from ${new Date(lastBackup.timestamp).toLocaleString()}?`,
    {
      modal: true,
      detail: `This will restore ${lastBackup.files.length} file${lastBackup.files.length === 1 ? '' : 's'} to their previous state.`
    },
    "Rollback",
    "Cancel"
  );

  if (choice !== "Rollback") {
    return;
  }

  let restoredCount = 0;
  let failedCount = 0;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Rolling back changes...",
      cancellable: false,
    },
    async (progress) => {
      for (let i = 0; i < lastBackup!.files.length; i++) {
        const backup = lastBackup!.files[i];
        const filename = getRelativePath(vscode.Uri.file(backup.filePath));

        progress.report({
          increment: (1 / lastBackup!.files.length) * 100,
          message: `${i + 1}/${lastBackup!.files.length}: ${filename}`,
        });

        try {
          const uri = vscode.Uri.file(backup.filePath);
          const doc = await vscode.workspace.openTextDocument(uri);
          const edit = new vscode.WorkspaceEdit();
          
          const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length)
          );
          
          edit.replace(uri, fullRange, backup.originalContent);
          
          const success = await vscode.workspace.applyEdit(edit);
          if (success) {
            await doc.save();
            restoredCount++;
          } else {
            failedCount++;
          }
        } catch (error) {
          console.error(`Error restoring ${filename}:`, error);
          failedCount++;
        }
      }
    }
  );

  if (restoredCount > 0) {
    vscode.window.showInformationMessage(
      `✅ Rollback complete! Restored ${restoredCount} file${restoredCount === 1 ? '' : 's'}.`
    );
    lastBackup = null;
  } else {
    vscode.window.showErrorMessage("No-Logs: Rollback failed.");
  }
}

async function processFileWithDetails(file: FileLogOccurrences): Promise<{
  success: boolean;
  removed: number;
  replaced: number;
  details: RemovalResult | null;
}> {
  const uri = vscode.Uri.file(file.filePath);

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();

    const sorted = [...file.occurrences].sort(
      (a, b) => b.startIndex - a.startIndex
    );

    let removed = 0;
    let replaced = 0;
    const removalDetails: RemovalResult = {
      filePath: file.filePath,
      relativePath: getRelativePath(uri),
      removals: []
    };

    for (const occ of sorted) {
      const strategy = calculateSmartRemoval(doc, occ);
      if (strategy) {
        const line = doc.positionAt(occ.startIndex).line;
        const originalLine = doc.lineAt(line).text.trim();

        if (strategy.replacement !== undefined) {
          edit.replace(uri, strategy.range, strategy.replacement);
          replaced++;
          removalDetails.removals.push({
            line: line + 1,
            originalCode: originalLine,
            action: "replaced",
            replacement: strategy.replacement,
            context: strategy.context
          });
        } else {
          edit.delete(uri, strategy.range);
          removed++;
          removalDetails.removals.push({
            line: line + 1,
            originalCode: originalLine,
            action: "removed",
            context: strategy.context
          });
        }
      }
    }

    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      await doc.save();
    }
    return { success, removed, replaced, details: removalDetails };
  } catch (error) {
    console.error(`Error processing ${file.filePath}:`, error);
    return { success: false, removed: 0, replaced: 0, details: null };
  }
}

async function generateReport(
  results: RemovalResult[],
  totalRemoved: number,
  totalReplaced: number,
  totalFailed: number
) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return;

  const reportPath = path.join(workspaceFolders[0].uri.fsPath, ".no-logs-report.md");
  const timestamp = new Date().toLocaleString();

  let report = `# 🧹 No-Logs Cleanup Report\n\n`;
  report += `**Date:** ${timestamp}\n\n`;
  report += `## Summary\n\n`;
  report += `- **Files Modified:** ${results.length}\n`;
  report += `- **Total Removals:** ${totalRemoved}\n`;
  report += `- **Total Replacements:** ${totalReplaced}\n`;
  if (totalFailed > 0) {
    report += `- **Failed:** ${totalFailed}\n`;
  }
  report += `\n---\n\n`;

  report += `## Changes by File\n\n`;

  for (const result of results) {
    report += `### 📄 ${result.relativePath}\n\n`;
    
    for (const removal of result.removals) {
      report += `**Line ${removal.line}** _(${removal.context})_\n\n`;
      report += `\`\`\`diff\n`;
      report += `- ${removal.originalCode}\n`;
      if (removal.action === "replaced" && removal.replacement) {
        report += `+ ${removal.replacement}\n`;
      }
      report += `\`\`\`\n\n`;
    }
  }

  report += `---\n\n`;
  report += `> Generated by No-Logs VSCode Extension\n`;
  report += `> You can rollback this cleanup using: **No Logs: Rollback Last Cleanup**\n`;

  try {
    await fs.promises.writeFile(reportPath, report, "utf-8");
    console.log(`Report generated at: ${reportPath}`);
  } catch (error) {
    console.error("Error generating report:", error);
  }
}

async function openReportFile() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return;

  const reportPath = path.join(workspaceFolders[0].uri.fsPath, ".no-logs-report.md");
  
  try {
    const doc = await vscode.workspace.openTextDocument(reportPath);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (error) {
    console.error("Error opening report:", error);
  }
}

function calculateSmartRemoval(
  doc: vscode.TextDocument,
  occ: TextOccurrence
): RemovalStrategy | null {
  const start = doc.positionAt(occ.startIndex);
  const end = doc.positionAt(occ.endIndex);
  const line = doc.lineAt(start.line);

  const before = line.text.slice(0, start.character);
  const after = line.text.slice(end.character);
  const trimmedBefore = before.trim();
  const trimmedAfter = after.trim();

  const extendedBefore = getExtendedContext(doc, start, 100, 'before');
  const extendedAfter = getExtendedContext(doc, end, 50, 'after');

  // Arrow function without braces
  if (/=>\s*$/.test(trimmedBefore) && !/^\s*\{/.test(after)) {
    const trailingPunctMatch = trimmedAfter.match(/^([;,])/);
    const trailing = trailingPunctMatch ? trailingPunctMatch[1] : '';
    return {
      range: new vscode.Range(start, end),
      replacement: `{}${trailing}`,
      requiresConfirmation: true,
      context: "Arrow function body",
    };
  }

  // Ternary consequent
  if (/\?\s*$/.test(trimmedBefore)) {
    return {
      range: new vscode.Range(start, end),
      replacement: "undefined",
      requiresConfirmation: true,
      context: "Ternary consequent",
    };
  }

  // Ternary alternate
  if (/:\s*$/.test(trimmedBefore)) {
    const hasQuestionMark = extendedBefore.includes('?');
    const lastBraceIndex = extendedBefore.lastIndexOf('{');
    const lastQuestionIndex = extendedBefore.lastIndexOf('?');
    
    if (hasQuestionMark && (lastBraceIndex === -1 || lastQuestionIndex > lastBraceIndex)) {
      return {
        range: new vscode.Range(start, end),
        replacement: "undefined",
        requiresConfirmation: true,
        context: "Ternary alternate",
      };
    }
  }

  // Return statement
  if (/\breturn\s+$/.test(before)) {
    if (/^\s*(\|\||&&)/.test(after)) {
      return {
        range: new vscode.Range(start, end),
        replacement: "undefined",
        requiresConfirmation: true,
        context: "Return with logical operator",
      };
    }
    return {
      range: new vscode.Range(start, end),
      replacement: "undefined",
      requiresConfirmation: true,
      context: "Return statement",
    };
  }

  // Logical OR
  if (/\|\|\s*$/.test(trimmedBefore)) {
    return {
      range: new vscode.Range(start, end),
      replacement: "undefined",
      requiresConfirmation: true,
      context: "Logical OR",
    };
  }

  // Logical AND
  if (/&&\s*$/.test(trimmedBefore)) {
    return {
      range: new vscode.Range(start, end),
      replacement: "undefined",
      requiresConfirmation: true,
      context: "Logical AND",
    };
  }

  // Comma operator - first position
  if (/\(\s*$/.test(trimmedBefore) && /^\s*,/.test(trimmedAfter)) {
    const commaMatch = after.match(/^\s*,\s*/);
    if (commaMatch) {
      const endPos = doc.positionAt(occ.endIndex + commaMatch[0].length);
      return {
        range: new vscode.Range(start, endPos),
        replacement: "",
        requiresConfirmation: true,
        context: "Comma operator (first)",
      };
    }
  }

  // Comma operator - last position
  if (/,\s*$/.test(trimmedBefore) && /^\s*\)/.test(trimmedAfter)) {
    const commaMatch = before.match(/,\s*$/);
    if (commaMatch) {
      const startPos = new vscode.Position(
        start.line,
        start.character - commaMatch[0].length
      );
      return {
        range: new vscode.Range(startPos, end),
        replacement: "",
        requiresConfirmation: true,
        context: "Comma operator (last)",
      };
    }
  }

  // JSX expression
  if (/\{\s*$/.test(trimmedBefore) && /^\s*\}/.test(trimmedAfter)) {
    return {
      range: new vscode.Range(start, end),
      replacement: "null",
      requiresConfirmation: true,
      context: "JSX expression",
    };
  }

  // Function call argument
  if (/\w+\s*\(\s*$/.test(trimmedBefore) && /^\s*\)/.test(trimmedAfter)) {
    return {
      range: new vscode.Range(start, end),
      replacement: "() => {}",
      requiresConfirmation: true,
      context: "Function argument",
    };
  }

  // Safe removal cases

  // Whole line only console.log
  if (/^\s*$/.test(before) && /^\s*$/.test(after)) {
    return {
      range: line.rangeIncludingLineBreak,
      replacement: undefined,
      requiresConfirmation: false,
      context: "Standalone statement",
    };
  }

  // Console at start of line
  if (/^\s*$/.test(before)) {
    return {
      range: new vscode.Range(line.range.start, end),
      replacement: undefined,
      requiresConfirmation: false,
      context: "Start of line",
    };
  }

  // Console at end of 
  if (/^\s*;?\s*$/.test(after)) {
    return {
      range: new vscode.Range(start, line.rangeIncludingLineBreak.end),
      replacement: undefined,
      requiresConfirmation: false,
      context: "End of line",
    };
  }

  // Default removal
  return {
    range: new vscode.Range(start, end),
    replacement: undefined,
    requiresConfirmation: false,
    context: "Default removal",
  };
}

function getExtendedContext(
  doc: vscode.TextDocument,
  pos: vscode.Position,
  charCount: number,
  direction: 'before' | 'after'
): string {
  if (direction === 'before') {
    const startOffset = Math.max(0, doc.offsetAt(pos) - charCount);
    const startPos = doc.positionAt(startOffset);
    return doc.getText(new vscode.Range(startPos, pos));
  } else {
    const endOffset = Math.min(
      doc.getText().length,
      doc.offsetAt(pos) + charCount
    );
    const endPos = doc.positionAt(endOffset);
    return doc.getText(new vscode.Range(pos, endPos));
  }
}  