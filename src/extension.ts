import * as vscode from "vscode";
import { scanConsoleLogsInText } from "./scanner";
import { TextOccurrence, FileLogOccurrences } from "./types";
import { findWorkspaceScriptFiles, getRelativePath } from "./fileUtils";

let lastScan: FileLogOccurrences[] = [];

interface RemovalStrategy {
  range: vscode.Range;
  replacement?: string;
  requiresConfirmation: boolean;
  context: string;
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("No-Logs extension is activating...");

  const scanCmd = vscode.commands.registerCommand("noLogs.scan", async () => {
    console.log("Scan command triggered");
    await runScanAndMaybeClean(true);
  });

  const cleanCmd = vscode.commands.registerCommand("noLogs.clean", async () => {
    console.log("Clean command triggered");
    if (lastScan.length === 0) {
      console.log("No previous scan results, running scan first");
      await runScanAndMaybeClean(false);
      return;
    }
    await confirmAndApplyRemoval(lastScan);
  });

  context.subscriptions.push(scanCmd, cleanCmd);
  console.log("No-Logs extension activated successfully");
}

export function deactivate() {
  console.log("No-Logs extension deactivated");
}

async function runScanAndMaybeClean(withPreview: boolean) {
  console.log("Starting scan process...");

  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage(
        "No-Logs: No workspace folder is open. Please open a folder or workspace."
      );
      return;
    }

    const files = await findWorkspaceScriptFiles();
    console.log(`Found ${files.length} files to scan`);

    if (files.length === 0) {
      vscode.window.showInformationMessage(
        "No-Logs: No JavaScript/TypeScript files found in the workspace."
      );
      return;
    }

    const findings: FileLogOccurrences[] = [];
    let total = 0;
    let processedFiles = 0;
    let skippedFiles = 0;
    let errors: string[] = [];

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
            message: `Scanning ${filename}... (${i + 1}/${files.length})`,
          });

          if (uri.fsPath.includes(".output")) {
            skippedFiles++;
            continue;
          }

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
            const errorMsg = `Error scanning ${filename}: ${error}`;
            console.error(errorMsg);
            errors.push(errorMsg);
            skippedFiles++;
          }
        }
      }
    );

    lastScan = findings;

    if (total === 0) {
      let message = `No-Logs: No console statements found (scanned ${processedFiles} files`;
      if (skippedFiles > 0) message += `, skipped ${skippedFiles}`;
      if (errors.length > 0) message += `, ${errors.length} errors`;
      message += `)`;
      vscode.window.showInformationMessage(message);
      return;
    }

    if (withPreview) {
      await showPreview(findings);
    } else {
      await confirmAndApplyRemoval(findings);
    }
  } catch (error) {
    console.error("Error in runScanAndMaybeClean:", error);
    vscode.window.showErrorMessage(
      `No-Logs: Error during scan: ${(error as Error).message}`
    );
  }
}

async function showPreview(findings: FileLogOccurrences[]) {
  const items: vscode.QuickPickItem[] = [];

  for (const file of findings) {
    const rel = getRelativePath(vscode.Uri.file(file.filePath));
    for (const occ of file.occurrences) {
      items.push({
        label: `${rel}:${occ.startLine + 1}`,
        description: occ.preview,
        detail: `console.${occ.method}(...)`,
      });
    }
  }

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: false,
    title: `No-Logs: Found ${items.length} console statements across ${findings.length} files`,
    placeHolder:
      "Select an item to open in the editor (this is just a preview, nothing will be deleted)",
  });

  if (selected) {
    const [filePath, lineStr] = selected.label.split(":");
    const line = parseInt(lineStr, 10) - 1;
    const file = findings.find((f) =>
      getRelativePath(vscode.Uri.file(f.filePath)).endsWith(filePath)
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

async function confirmAndApplyRemoval(findings: FileLogOccurrences[]) {
  const total = findings.reduce((acc, f) => acc + f.occurrences.length, 0);
  const fileCount = findings.length;

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

  let message = `No-Logs: Remove ${total} console statement${
    total === 1 ? "" : "s"
  } across ${fileCount} file${fileCount === 1 ? "" : "s"}?`;
  
  let detail = "This action cannot be undone. Make sure you have your files backed up or version controlled.";
  
  if (riskyCount > 0) {
    detail += `\n\n⚠️ Warning: ${riskyCount} console statement${riskyCount === 1 ? '' : 's'} are in complex expressions and will be replaced with safe alternatives (undefined, {}, or null) to prevent syntax errors.`;
  }

  const choice = await vscode.window.showWarningMessage(
    message,
    {
      modal: true,
      detail,
    },
    "Remove All",
    "Cancel"
  );

  if (choice !== "Remove All") {
    vscode.window.showInformationMessage("No-Logs: Removal cancelled.");
    return;
  }

  let successfulRemovals = 0;
  let failedRemovals = 0;
  let replacements = 0;
  const errors: string[] = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Removing console statements...",
      cancellable: false,
    },
    async (progress) => {
      for (let fileIndex = 0; fileIndex < findings.length; fileIndex++) {
        const file = findings[fileIndex];
        const filename = getRelativePath(vscode.Uri.file(file.filePath));

        progress.report({
          increment: (1 / findings.length) * 100,
          message: `Processing ${filename}... (${fileIndex + 1}/${findings.length})`,
        });

        try {
          const result = await processFile(file);
          if (result.success) {
            successfulRemovals += result.removed;
            replacements += result.replaced;
          } else {
            failedRemovals += file.occurrences.length;
            errors.push(`Failed to process ${filename}`);
          }
        } catch (error) {
          failedRemovals += file.occurrences.length;
          const errorMsg = `Error processing ${filename}: ${
            (error as Error).message
          }`;
          errors.push(errorMsg);
        }
      }
    }
  );

  if (successfulRemovals > 0) {
    let message = `No-Logs: Successfully removed ${successfulRemovals} console statement${
      successfulRemovals === 1 ? "" : "s"
    }`;
    if (replacements > 0) {
      message += ` (${replacements} replaced with safe alternatives)`;
    }
    if (failedRemovals > 0) {
      message += `. ${failedRemovals} removal${
        failedRemovals === 1 ? "" : "s"
      } failed`;
    }
    vscode.window.showInformationMessage(message);
    if (errors.length > 0) {
      vscode.window.showErrorMessage(
        `Some errors occurred:\n${errors.join("\n")}`
      );
    }
    lastScan = [];
  } else if (failedRemovals > 0) {
    vscode.window.showErrorMessage(
      `No-Logs: All ${failedRemovals} removal attempts failed.`
    );
  } else {
    vscode.window.showWarningMessage("No-Logs: No console statements removed.");
  }
}

async function processFile(file: FileLogOccurrences): Promise<{
  success: boolean;
  removed: number;
  replaced: number;
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

    for (const occ of sorted) {
      const strategy = calculateSmartRemoval(doc, occ);
      if (strategy) {
        if (strategy.replacement !== undefined) {
          edit.replace(uri, strategy.range, strategy.replacement);
          replaced++;
        } else {
          edit.delete(uri, strategy.range);
          removed++;
        }
      }
    }

    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      await doc.save();
    }
    return { success, removed, replaced };
  } catch (error) {
    console.error(
      `Error processing ${file.filePath}: ${(error as Error).message}`
    );
    return { success: false, removed: 0, replaced: 0 };
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

  // Get extended context for better detection
  const extendedBefore = getExtendedContext(doc, start, 100, 'before');
  const extendedAfter = getExtendedContext(doc, end, 50, 'after');

  // PATTERN 1: Arrow function without braces: => console.log(...)
  // Must check there's no { after =>
  if (/=>\s*$/.test(trimmedBefore) && !/^\s*\{/.test(after)) {
    // Preserve semicolon or comma if present
    const trailingPunctMatch = trimmedAfter.match(/^([;,])/);
    const trailing = trailingPunctMatch ? trailingPunctMatch[1] : '';
    return {
      range: new vscode.Range(start, end),
      replacement: `{}${trailing}`,
      requiresConfirmation: true,
      context: "Arrow function body",
    };
  }

  // PATTERN 2: Ternary consequent: ? console.log(...)
  if (/\?\s*$/.test(trimmedBefore)) {
    return {
      range: new vscode.Range(start, end),
      replacement: "undefined",
      requiresConfirmation: true,
      context: "Ternary consequent",
    };
  }

  // PATTERN 3: Ternary alternate: : console.log(...)
  // Check it's actually a ternary, not object property
  if (/:\s*$/.test(trimmedBefore)) {
    // Look back for ? to confirm it's a ternary
    const hasQuestionMark = extendedBefore.includes('?');
    // Check it's not an object literal by looking for opening brace
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

  // PATTERN 4: Return statement: return console.log(...)
  if (/\breturn\s+$/.test(before)) {
    // Check if there's more after (like || or &&)
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

  // PATTERN 5: Logical OR: || console.log(...)
  if (/\|\|\s*$/.test(trimmedBefore)) {
    return {
      range: new vscode.Range(start, end),
      replacement: "undefined",
      requiresConfirmation: true,
      context: "Logical OR",
    };
  }

  // PATTERN 6: Logical AND: && console.log(...)
  if (/&&\s*$/.test(trimmedBefore)) {
    return {
      range: new vscode.Range(start, end),
      replacement: "undefined",
      requiresConfirmation: true,
      context: "Logical AND",
    };
  }

  // PATTERN 7: Comma operator - first position: (console.log(...), something)
  if (/\(\s*$/.test(trimmedBefore) && /^\s*,/.test(trimmedAfter)) {
    // Remove console.log and the trailing comma
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

  // PATTERN 8: Comma operator - last position: (something, console.log(...))
  if (/,\s*$/.test(trimmedBefore) && /^\s*\)/.test(trimmedAfter)) {
    // Remove the preceding comma and console.log
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

  // PATTERN 9: JSX expression: {console.log(...)}
  if (/\{\s*$/.test(trimmedBefore) && /^\s*\}/.test(trimmedAfter)) {
    return {
      range: new vscode.Range(start, end),
      replacement: "null",
      requiresConfirmation: true,
      context: "JSX expression",
    };
  }

  // PATTERN 10: Function call argument: func(console.log(...))
  if (/\w+\s*\(\s*$/.test(trimmedBefore) && /^\s*\)/.test(trimmedAfter)) {
    return {
      range: new vscode.Range(start, end),
      replacement: "() => {}",
      requiresConfirmation: true,
      context: "Function argument",
    };
  }

  // Safe removal cases - original logic

  // Case 1: Whole line only console.log
  if (/^\s*$/.test(before) && /^\s*$/.test(after)) {
    return {
      range: line.rangeIncludingLineBreak,
      replacement: undefined,
      requiresConfirmation: false,
      context: "Standalone statement",
    };
  }

  // Case 2: Console at start of line with optional semicolon
  if (/^\s*$/.test(before)) {
    return {
      range: new vscode.Range(line.range.start, end),
      replacement: undefined,
      requiresConfirmation: false,
      context: "Start of line",
    };
  }

  // Case 3: Console at end of line
  if (/^\s*;?\s*$/.test(after)) {
    return {
      range: new vscode.Range(start, line.rangeIncludingLineBreak.end),
      replacement: undefined,
      requiresConfirmation: false,
      context: "End of line",
    };
  }

  // Default: just remove the statement
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