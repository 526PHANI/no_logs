 import * as vscode from "vscode";
import { scanConsoleLogsInText } from "./scanner";
import { TextOccurrence, FileLogOccurrences } from "./types";
import { findWorkspaceScriptFiles, getRelativePath } from "./fileUtils";

let lastScan: FileLogOccurrences[] = [];

export async function activate(context: vscode.ExtensionContext) {
  console.log("No-Logs extension is activating...");

  const scanCmd = vscode.commands.registerCommand("noLogs.scan", async () => {
    console.log("Scan command triggered");
    await runScanAndMaybeClean(true); // preview only
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

  const choice = await vscode.window.showWarningMessage(
    `No-Logs: Remove ${total} console statement${
      total === 1 ? "" : "s"
    } across ${fileCount} file${fileCount === 1 ? "" : "s"}?`,
    {
      modal: true,
      detail:
        "This action cannot be undone. Make sure you have your files backed up or version controlled.",
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
          const success = await processFile(file);
          if (success) {
            successfulRemovals += file.occurrences.length;
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

async function processFile(file: FileLogOccurrences): Promise<boolean> {
  const uri = vscode.Uri.file(file.filePath);

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();

    const sorted = [...file.occurrences].sort(
      (a, b) => b.startIndex - a.startIndex
    );

    for (const occ of sorted) {
      const removal = calculateSmartRemoval(doc, occ);
      if (removal) {
        edit.delete(uri, removal);
      }
    }

    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      await doc.save();
    }
    return success;
  } catch (error) {
    console.error(
      `Error processing ${file.filePath}: ${(error as Error).message}`
    );
    return false;
  }
}

function calculateSmartRemoval(
  doc: vscode.TextDocument,
  occ: TextOccurrence
): vscode.Range | null {
  const start = doc.positionAt(occ.startIndex);
  const end = doc.positionAt(occ.endIndex);
  const line = doc.lineAt(start.line);

  const before = line.text.slice(0, start.character);
  const after = line.text.slice(end.character);

  // Case 1: whole line only console.log
  if (/^\s*$/.test(before) && /^\s*$/.test(after)) {
    return line.rangeIncludingLineBreak;
  }

  // Case 2: console at start of line
  if (/^\s*$/.test(before)) {
    return new vscode.Range(line.range.start, end);
  }

  // Case 3: console at end of line
  if (/^\s*$/.test(after)) {
    return new vscode.Range(start, line.rangeIncludingLineBreak.end);
  }

  // Default: just remove the statement
  return new vscode.Range(start, end);
}