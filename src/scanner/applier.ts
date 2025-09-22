import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { findSourceFiles } from './fileScanner';

// NO BABEL IMPORTS - PURE REGEX ONLY!

export async function applyCleanup(): Promise<{ file: string; changed: boolean }[]> {
  console.log("STARTING REGEX-ONLY CLEANUP - NO AST PARSING!");
  const ws = vscode.workspace.workspaceFolders;
  if (!ws || ws.length === 0) {
    throw new Error('No workspace open');
  }
  const workspaceRoot = ws[0].uri;
  const uris = await findSourceFiles();

  if (!uris || uris.length === 0) {
    return [];
  }

  const changes: { file: string; changed: boolean }[] = [];
  let processed = 0;
  let totalModified = 0;
  let totalItemsRemoved = 0;

  // Create backup directory
  const backupDir = path.join(
    process.env.APPDATA || process.env.HOME || '.', 
    '.no-logs-backup', 
    new Date().toISOString().replace(/[:.]/g, '-')
  );
  
  try {
    await fs.mkdir(backupDir, { recursive: true });
    console.log(`No Logs: Backups created in ${backupDir}`);
  } catch (err) {
    console.warn('Failed to create backup directory:', err);
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'No Logs: REGEX-ONLY cleanup (no AST parsing)',
      cancellable: true,
    },
    async (progress, token) => {
      for (const uri of uris) {
        if (token.isCancellationRequested) {
          break;
        }
        
        const filePath = uri.fsPath;
        const relativePath = path.relative(workspaceRoot.fsPath, filePath);
        const fileName = path.basename(filePath);
        
        progress.report({ 
          message: `Processing ${fileName} (${++processed}/${uris.length})`,
          increment: (100 / uris.length)
        });

        let content: string;
        try {
          content = await fs.readFile(filePath, 'utf8');
        } catch (err) {
          console.log(`No Logs: Failed to read ${relativePath}: ${err}`);
          changes.push({ file: filePath, changed: false });
          continue;
        }

        // Create backup
        try {
          const backupPath = path.join(backupDir, relativePath);
          await fs.mkdir(path.dirname(backupPath), { recursive: true });
          await fs.writeFile(backupPath, content, 'utf8');
        } catch (err) {
          console.warn(`Failed to backup ${relativePath}:`, err);
        }

        const originalContent = content;
        const result = regexOnlyCleanup(content, relativePath);

        if (result.changed) {
          try {
            await fs.writeFile(filePath, result.content, 'utf8');
            totalModified++;
            totalItemsRemoved += result.itemsRemoved;
            console.log(`No Logs: SUCCESS ${relativePath} (removed ${result.itemsRemoved} items)`);
            changes.push({ file: filePath, changed: true });
          } catch (writeErr) {
            console.error(`No Logs: FAILED ${relativePath}:`, writeErr);
            changes.push({ file: filePath, changed: false });
          }
        } else {
          changes.push({ file: filePath, changed: false });
        }
      }
    }
  );

  console.log(`\nREGEX CLEANUP COMPLETE!`);
  console.log(`Modified: ${totalModified} files`);
  console.log(`Removed: ${totalItemsRemoved} items`);
  
  vscode.window.showInformationMessage(
    `No Logs: SUCCESS! Modified ${totalModified} files, removed ${totalItemsRemoved} items.`
  );
  
  return changes;
}

function regexOnlyCleanup(content: string, filePath: string): { content: string; changed: boolean; itemsRemoved: number } {
  let result = content;
  let itemsRemoved = 0;

  console.log(`REGEX PROCESSING: ${filePath}`);

  // STEP 1: Remove console statements
  const originalResult = result;
  
  // Pattern 1: Full line console statements
  const fullLinePattern = /^[ \t]*console\.(log|warn|error|info|debug|trace|clear|count|time|timeEnd|group|groupEnd|assert|table)\s*\([^;]*\);?[ \t]*(?:\r?\n|$)/gm;
  const fullLineMatches = result.match(fullLinePattern);
  if (fullLineMatches) {
    console.log(`  Removing ${fullLineMatches.length} full-line console calls`);
    itemsRemoved += fullLineMatches.length;
    result = result.replace(fullLinePattern, '');
  }

  // Pattern 2: Inline console statements
  const inlinePattern = /console\.(log|warn|error|info|debug|trace|clear|count|time|timeEnd|group|groupEnd|assert|table)\s*\([^)]*\);?/g;
  const inlineMatches = result.match(inlinePattern);
  if (inlineMatches) {
    console.log(`  Removing ${inlineMatches.length} inline console calls`);
    itemsRemoved += inlineMatches.length;
    result = result.replace(inlinePattern, '');
  }

  // STEP 2: Remove comments
  
  // Single line comments
  const singleCommentPattern = /^[ \t]*\/\/.*(?:\r?\n|$)/gm;
  const singleCommentMatches = result.match(singleCommentPattern);
  if (singleCommentMatches) {
    console.log(`  Removing ${singleCommentMatches.length} single-line comments`);
    itemsRemoved += singleCommentMatches.length;
    result = result.replace(singleCommentPattern, '');
  }

  // Block comments (including multiline)
  const blockCommentPattern = /\/\*[\s\S]*?\*\//g;
  const blockCommentMatches = result.match(blockCommentPattern);
  if (blockCommentMatches) {
    console.log(`  Removing ${blockCommentMatches.length} block comments`);
    itemsRemoved += blockCommentMatches.length;
    result = result.replace(blockCommentPattern, '');
  }

  // JSX comments
  const jsxCommentPattern = /\{[ \t]*\/\*[\s\S]*?\*\/[ \t]*\}/g;
  const jsxCommentMatches = result.match(jsxCommentPattern);
  if (jsxCommentMatches) {
    console.log(`  Removing ${jsxCommentMatches.length} JSX comments`);
    itemsRemoved += jsxCommentMatches.length;
    result = result.replace(jsxCommentPattern, '');
  }

  // STEP 3: Clean whitespace
  result = result.replace(/\n\s*\n\s*\n+/g, '\n\n');
  result = result.replace(/[ \t]+$/gm, '');
  result = result.replace(/\n+$/, '\n');

  const changed = result !== content;
  
  if (changed) {
    console.log(`  TOTAL REMOVED from ${filePath}: ${itemsRemoved} items`);
  } else {
    console.log(`  NO CHANGES needed in ${filePath}`);
  }

  return {
    content: result,
    changed,
    itemsRemoved
  };
}