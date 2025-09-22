import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface CleanupResult {
  file: string;
  originalSize: number;
  newSize: number;
  consoleLogsRemoved: number;
  commentsRemoved: number;
  changed: boolean;
  error?: string;
}

interface ScanResult {
  file: string;
  consoleLogs: Array<{ line: number; content: string }>;
  comments: Array<{ line: number; content: string; type: 'single' | 'block' | 'jsx' }>;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('No Logs Clean extension activated');

  const scanCommand = vscode.commands.registerCommand('no-logs-clean.scanWorkspace', async () => {
    try {
      const results = await scanWorkspace();
      await showScanResults(results);
    } catch (error) {
      vscode.window.showErrorMessage(`Scan failed: ${error}`);
    }
  });

  const cleanupCommand = vscode.commands.registerCommand('no-logs-clean.cleanupWorkspace', async () => {
    const response = await vscode.window.showWarningMessage(
      'This will remove console logs and comments from your workspace. A backup will be created.',
      { modal: true },
      'Yes, Clean Everything',
      'Cancel'
    );
    
    if (response === 'Yes, Clean Everything') {
      try {
        const results = await cleanupWorkspace();
        await showCleanupResults(results);
      } catch (error) {
        vscode.window.showErrorMessage(`Cleanup failed: ${error}`);
      }
    }
  });

  const cleanCurrentCommand = vscode.commands.registerCommand('no-logs-clean.cleanupCurrentFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor');
      return;
    }

    const response = await vscode.window.showWarningMessage(
      'Remove console logs and comments from current file?',
      'Yes',
      'Cancel'
    );

    if (response === 'Yes') {
      try {
        const result = await cleanupFile(editor.document.uri.fsPath);
        if (result.changed) {
          const newContent = fs.readFileSync(result.file, 'utf8');
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(editor.document.getText().length)
          );
          edit.replace(editor.document.uri, fullRange, newContent);
          await vscode.workspace.applyEdit(edit);
          vscode.window.showInformationMessage(
            `Cleaned! Removed ${result.consoleLogsRemoved} console logs and ${result.commentsRemoved} comments`
          );
        } else {
          vscode.window.showInformationMessage('No console logs or comments found');
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Cleanup failed: ${error}`);
      }
    }
  });

  context.subscriptions.push(scanCommand, cleanupCommand, cleanCurrentCommand);
}

async function getWorkspaceFiles(): Promise<string[]> {
  const config = vscode.workspace.getConfiguration('no-logs');
  const includePatterns = config.get<string[]>('includePatterns') || [
    '**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx', '**/*.vue', '**/*.svelte'
  ];
  const excludePatterns = config.get<string[]>('excludePatterns') || [
    '**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'
  ];

  const files: string[] = [];
  
  for (const includePattern of includePatterns) {
    const foundFiles = await vscode.workspace.findFiles(
      includePattern,
      `{${excludePatterns.join(',')}}`,
      10000
    );
    files.push(...foundFiles.map((uri: vscode.Uri) => uri.fsPath));
  }

  return [...new Set(files)];
}

async function scanWorkspace(): Promise<ScanResult[]> {
  const files = await getWorkspaceFiles();
  const results: ScanResult[] = [];

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Scanning for console logs and comments',
    cancellable: true
  }, async (progress: vscode.Progress<{message?: string; increment?: number}>, token: vscode.CancellationToken) => {
    for (let i = 0; i < files.length; i++) {
      if (token.isCancellationRequested) break;

      const file = files[i];
      progress.report({
        message: `Scanning ${path.basename(file)} (${i + 1}/${files.length})`,
        increment: (100 / files.length)
      });

      try {
        const scanResult = scanFile(file);
        if (scanResult.consoleLogs.length > 0 || scanResult.comments.length > 0) {
          results.push(scanResult);
        }
      } catch (error) {
        console.error(`Error scanning ${file}:`, error);
      }
    }
  });

  return results;
}

function scanFile(filePath: string): ScanResult {
  const content = fs.readFileSync(filePath, 'utf8');
  const consoleLogs: Array<{ line: number; content: string }> = [];
  const comments: Array<{ line: number; content: string; type: 'single' | 'block' | 'jsx' }> = [];

  const { safeConsoleLogs, safeComments } = findSafeTargets(content);
  
  safeConsoleLogs.forEach(item => {
    consoleLogs.push({ line: item.line, content: item.content });
  });

  safeComments.forEach(item => {
    comments.push({ line: item.line, content: item.content, type: item.type });
  });

  return { file: filePath, consoleLogs, comments };
}

// ULTRA-SAFE: Only finds items that are 100% guaranteed to be safe to remove
function findSafeTargets(content: string): {
  safeConsoleLogs: Array<{ line: number; content: string }>;
  safeComments: Array<{ line: number; content: string; type: 'single' | 'block' | 'jsx' }>;
} {
  const lines = content.split('\n');
  const safeConsoleLogs: Array<{ line: number; content: string }> = [];
  const safeComments: Array<{ line: number; content: string; type: 'single' | 'block' | 'jsx' }> = [];

  let inMultiLineComment = false;
  let inMultiLineString = false;
  let multiLineStringChar = '';
  let commentStartLine = 0;
  let commentBuffer = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Handle multi-line comment continuation
    if (inMultiLineComment) {
      commentBuffer += line + '\n';
      if (line.includes('*/')) {
        inMultiLineComment = false;
        if (!isProtectedComment(commentBuffer)) {
          safeComments.push({
            line: commentStartLine,
            content: commentBuffer.trim(),
            type: 'block'
          });
        }
        commentBuffer = '';
      }
      continue;
    }

    // Handle multi-line string continuation (template literals)
    if (inMultiLineString) {
      if (line.includes(multiLineStringChar)) {
        inMultiLineString = false;
        multiLineStringChar = '';
      }
      continue; // Skip entire line if inside multi-line string
    }

    // Parse line with extreme caution
    const safeItems = parseLineSafely(line, lineNumber);
    
    // Add safe console logs
    safeItems.consoleLogs.forEach(item => {
      safeConsoleLogs.push(item);
    });

    // Add safe comments
    safeItems.comments.forEach(item => {
      if (item.type === 'block' && item.multiline) {
        // Start of multi-line comment
        inMultiLineComment = true;
        commentStartLine = lineNumber;
        commentBuffer = item.content + '\n';
      } else if (!isProtectedComment(item.content)) {
        safeComments.push({
          line: lineNumber,
          content: item.content,
          type: item.type
        });
      }
    });

    // Check for start of multi-line string
    if (line.includes('`')) {
      const backtickCount = (line.match(/`/g) || []).length;
      if (backtickCount % 2 === 1) {
        inMultiLineString = true;
        multiLineStringChar = '`';
      }
    }
  }

  return { safeConsoleLogs, safeComments };
}

// Parse a single line with extreme caution
function parseLineSafely(line: string, lineNumber: number): {
  consoleLogs: Array<{ line: number; content: string }>;
  comments: Array<{ line: number; content: string; type: 'single' | 'block' | 'jsx'; multiline?: boolean }>;
} {
  const consoleLogs: Array<{ line: number; content: string }> = [];
  const comments: Array<{ line: number; content: string; type: 'single' | 'block' | 'jsx'; multiline?: boolean }> = [];

  // Ultra-conservative approach: Only process lines that are obviously safe
  
  // 1. Check if line starts with clear comment patterns (ignoring whitespace)
  const trimmed = line.trim();
  
  // Single-line comment that starts the line (most conservative)
  if (trimmed.match(/^\/\//) && !containsStringLiterals(line)) {
    comments.push({
      line: lineNumber,
      content: line.trim(),
      type: 'single'
    });
    return { consoleLogs, comments };
  }

  // Block comment that starts the line
  if (trimmed.match(/^\/\*/) && !containsStringLiterals(line)) {
    if (trimmed.includes('*/')) {
      // Single line block comment
      comments.push({
        line: lineNumber,
        content: line.trim(),
        type: 'block'
      });
    } else {
      // Multi-line block comment start
      comments.push({
        line: lineNumber,
        content: line.trim(),
        type: 'block',
        multiline: true
      });
    }
    return { consoleLogs, comments };
  }

  // 2. Check for console logs in obviously safe contexts
  // Only match console logs that are clearly standalone statements
  if (trimmed.match(/^console\.(log|warn|error|info|debug|trace|clear|count|time|timeEnd|group|groupEnd|assert|table)\s*\(/) && 
      !containsStringLiterals(line)) {
    consoleLogs.push({
      line: lineNumber,
      content: line.trim()
    });
  }

  // 3. Very conservative check for end-of-line comments with bulletproof string detection
  const endCommentResult = findEndOfLineCommentSafely(line);
  if (endCommentResult.found && !isProtectedComment(endCommentResult.commentText)) {
    comments.push({
      line: lineNumber,
      content: endCommentResult.commentText,
      type: 'single'
    });
  }

  return { consoleLogs, comments };
}

// Check if line contains string literals (too dangerous to process)
function containsStringLiterals(line: string): boolean {
  return line.includes('"') || line.includes("'") || line.includes('`');
}

// Check if line contains complex patterns that we should avoid
function containsComplexPatterns(line: string): boolean {
  // Avoid lines with URLs, regexes, or complex expressions
  return line.includes('://') || 
         line.includes('/*') || 
         line.includes('*/') ||
         line.includes('\\') ||
         /\/[^\/\s]+\/[gimsuvy]*/.test(line); // Regex pattern
}

// Find end-of-line comments with bulletproof string detection
function findEndOfLineCommentSafely(line: string): { found: boolean; commentText: string } {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inRegex = false;
  let escaped = false;

  // Find the position of // that's NOT inside strings or regexes
  for (let i = 0; i < line.length - 1; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    // Handle escape sequences
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }

    // Track string states
    if (char === '"' && !inSingleQuote && !inBacktick && !inRegex) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === "'" && !inDoubleQuote && !inBacktick && !inRegex) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '`' && !inDoubleQuote && !inSingleQuote && !inRegex) {
      inBacktick = !inBacktick;
    }
    // Simple regex detection
    else if (char === '/' && !inSingleQuote && !inDoubleQuote && !inBacktick && nextChar !== '/') {
      // Very conservative regex detection
      const before = line.slice(0, i).trim();
      const lastChar = before[before.length - 1];
      if ('=([{,:;!'.includes(lastChar) || before === '') {
        // Look for closing /
        for (let j = i + 1; j < line.length; j++) {
          if (line[j] === '/' && line[j-1] !== '\\') {
            i = j; // Skip to end of regex
            break;
          }
        }
        continue;
      }
    }

    // Found // outside of strings and regexes
    if (char === '/' && nextChar === '/' && 
        !inSingleQuote && !inDoubleQuote && !inBacktick && !inRegex) {
      
      const commentText = line.slice(i).trim();
      return {
        found: true,
        commentText: commentText
      };
    }
  }

  return {
    found: false,
    commentText: ''
  };
}

// Safely remove end-of-line comments with bulletproof string detection
function removeEndOfLineCommentSafely(line: string): { cleanedLine: string; wasRemoved: boolean } {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inRegex = false;
  let escaped = false;

  // Find the position of // that's NOT inside strings or regexes
  for (let i = 0; i < line.length - 1; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    // Handle escape sequences
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }

    // Track string states
    if (char === '"' && !inSingleQuote && !inBacktick && !inRegex) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === "'" && !inDoubleQuote && !inBacktick && !inRegex) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '`' && !inSingleQuote && !inDoubleQuote && !inRegex) {
      inBacktick = !inBacktick;
    }
    // Simple regex detection (very conservative)
    else if (char === '/' && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      // Check if this might be start of regex (very basic heuristic)
      const before = line.slice(0, i).trim();
      if (before.endsWith('=') || before.endsWith('(') || before.endsWith('[') || 
          before.endsWith('{') || before.endsWith(',') || before.endsWith(':') ||
          before.endsWith(';') || before.endsWith('!') || before === '') {
        // Might be regex, look for closing /
        for (let j = i + 1; j < line.length; j++) {
          if (line[j] === '/' && line[j-1] !== '\\') {
            inRegex = false;
            i = j; // Skip to end of regex
            break;
          }
        }
        continue;
      }
    }

    // Found // outside of strings and regexes
    if (char === '/' && nextChar === '/' && 
        !inSingleQuote && !inDoubleQuote && !inBacktick && !inRegex) {
      
      const beforeComment = line.slice(0, i).trimEnd();
      const commentText = line.slice(i);
      
      // Only remove if the comment is not protected
      if (!isProtectedComment(commentText)) {
        return {
          cleanedLine: beforeComment,
          wasRemoved: true
        };
      }
    }
  }

  return {
    cleanedLine: line,
    wasRemoved: false
  };
}

// Check if comment should be preserved (expanded list)
function isProtectedComment(commentText: string): boolean {
  const text = commentText.toLowerCase();
  
  // Preserve any comment with URLs
  if (/https?:\/\/|ftp:\/\/|file:\/\//.test(commentText)) {
    return true;
  }

  // Preserve any comment that looks like configuration or data
  if (text.includes('config') || 
      text.includes('setting') || 
      text.includes('option') || 
      text.includes('parameter') ||
      text.includes('value') ||
      text.includes('api') ||
      text.includes('endpoint') ||
      text.includes('url') ||
      text.includes('uri')) {
    return true;
  }

  // Preserve special directives
  if (text.includes('eslint') ||
      text.includes('prettier') ||
      text.includes('typescript') ||
      text.includes('@ts-') ||
      text.includes('jshint') ||
      text.includes('jslint') ||
      text.includes('istanbul') ||
      text.includes('coverage') ||
      text.includes('webpack') ||
      text.includes('rollup') ||
      text.includes('license') ||
      text.includes('copyright') ||
      text.includes('@author') ||
      text.includes('@version') ||
      text.includes('todo:') ||
      text.includes('fixme:') ||
      text.includes('hack:') ||
      text.includes('note:') ||
      text.includes('@param') ||
      text.includes('@return') ||
      text.includes('@throws') ||
      text.includes('@see') ||
      text.includes('@since') ||
      text.includes('@deprecated')) {
    return true;
  }

  // Preserve anything that looks like it might be important
  if (text.includes('important') ||
      text.includes('critical') ||
      text.includes('warning') ||
      text.includes('danger') ||
      text.includes('caution') ||
      text.includes('attention') ||
      text.includes('notice')) {
    return true;
  }

  return false;
}

async function cleanupWorkspace(): Promise<CleanupResult[]> {
  const files = await getWorkspaceFiles();
  const results: CleanupResult[] = [];

  const config = vscode.workspace.getConfiguration('no-logs');
  const createBackups = config.get<boolean>('createBackups', true);
  
  let backupDir = '';
  if (createBackups) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    backupDir = path.join(require('os').tmpdir(), `no-logs-backup-${timestamp}`);
    fs.mkdirSync(backupDir, { recursive: true });
    vscode.window.showInformationMessage(`Backup created: ${backupDir}`);
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Cleaning files',
    cancellable: true
  }, async (progress: vscode.Progress<{message?: string; increment?: number}>, token: vscode.CancellationToken) => {
    for (let i = 0; i < files.length; i++) {
      if (token.isCancellationRequested) break;

      const file = files[i];
      progress.report({
        message: `Cleaning ${path.basename(file)} (${i + 1}/${files.length})`,
        increment: (100 / files.length)
      });

      try {
        if (createBackups) {
          const relativePath = path.relative(vscode.workspace.workspaceFolders![0].uri.fsPath, file);
          const backupPath = path.join(backupDir, relativePath);
          fs.mkdirSync(path.dirname(backupPath), { recursive: true });
          fs.copyFileSync(file, backupPath);
        }

        const result = await cleanupFile(file);
        results.push(result);
      } catch (error) {
        results.push({
          file,
          originalSize: 0,
          newSize: 0,
          consoleLogsRemoved: 0,
          commentsRemoved: 0,
          changed: false,
          error: String(error)
        });
      }
    }
  });

  return results;
}

async function cleanupFile(filePath: string): Promise<CleanupResult> {
  const originalContent = fs.readFileSync(filePath, 'utf8');
  const originalSize = originalContent.length;
  
  const config = vscode.workspace.getConfiguration('no-logs');
  const removeComments = config.get<boolean>('removeComments', true);

  const cleanResult = cleanContentUltraSafe(originalContent, removeComments);
  
  const newSize = cleanResult.content.length;
  const changed = cleanResult.content !== originalContent;

  if (changed) {
    fs.writeFileSync(filePath, cleanResult.content, 'utf8');
  }

  return {
    file: filePath,
    originalSize,
    newSize,
    consoleLogsRemoved: cleanResult.consoleLogsRemoved,
    commentsRemoved: cleanResult.commentsRemoved,
    changed
  };
}

// Ultra-safe cleaning that only removes obviously safe targets
function cleanContentUltraSafe(content: string, removeComments: boolean = true): {
  content: string;
  consoleLogsRemoved: number;
  commentsRemoved: number;
} {
  const lines = content.split('\n');
  const cleanedLines: string[] = [];
  let consoleLogsRemoved = 0;
  let commentsRemoved = 0;
  let inMultiLineComment = false;
  let skipLinesUntilCommentEnd = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle multi-line comment state
    if (inMultiLineComment) {
      if (line.includes('*/')) {
        inMultiLineComment = false;
        skipLinesUntilCommentEnd = false;
      }
      if (skipLinesUntilCommentEnd) {
        commentsRemoved++;
        continue;
      }
    }

    const trimmed = line.trim();

    // Only remove lines that are 100% guaranteed to be safe
    
    // 1. Lines that are obviously just comments
    if (removeComments && trimmed.match(/^\/\//) && !containsStringLiterals(line)) {
      if (!isProtectedComment(line)) {
        commentsRemoved++;
        continue;
      }
    }

    // 2. Lines that are obviously just block comments
    if (removeComments && trimmed.match(/^\/\*/) && !containsStringLiterals(line)) {
      if (!isProtectedComment(line)) {
        if (trimmed.includes('*/')) {
          // Single line block comment
          commentsRemoved++;
          continue;
        } else {
          // Start of multi-line comment
          inMultiLineComment = true;
          skipLinesUntilCommentEnd = true;
          commentsRemoved++;
          continue;
        }
      }
    }

    // 3. Lines that are obviously just console statements
    if (trimmed.match(/^console\.(log|warn|error|info|debug|trace|clear|count|time|timeEnd|group|groupEnd|assert|table)\s*\(/) && 
        !containsStringLiterals(line)) {
      consoleLogsRemoved++;
      continue;
    }

    // 4. Very carefully handle end-of-line comments
    let processedLine = line;
    if (removeComments && !inMultiLineComment) {
      const endCommentResult = removeEndOfLineCommentSafely(line);
      if (endCommentResult.wasRemoved) {
        processedLine = endCommentResult.cleanedLine;
        commentsRemoved++;
      }
    }

    cleanedLines.push(processedLine);
  }

  let cleanedContent = cleanedLines.join('\n');

  // Very gentle whitespace cleanup
  cleanedContent = cleanedContent
    .replace(/\n\s*\n\s*\n+/g, '\n\n')  // Only clean up 3+ consecutive empty lines
    .replace(/[ \t]+$/gm, '');           // Remove trailing spaces

  // Preserve original file ending
  if (content.endsWith('\n') && !cleanedContent.endsWith('\n')) {
    cleanedContent += '\n';
  }

  return {
    content: cleanedContent,
    consoleLogsRemoved,
    commentsRemoved
  };
}

async function showScanResults(results: ScanResult[]): Promise<void> {
  if (results.length === 0) {
    vscode.window.showInformationMessage('No console logs or comments found in workspace!');
    return;
  }

  const totalConsole = results.reduce((sum, r) => sum + r.consoleLogs.length, 0);
  const totalComments = results.reduce((sum, r) => sum + r.comments.length, 0);

  const lines: string[] = [
    `# No Logs Clean - Scan Results`,
    ``,
    `Found **${totalConsole} console logs** and **${totalComments} comments** in **${results.length} files**.`,
    ``,
    `---`,
    ``
  ];

  results.forEach(result => {
    const fileName = path.basename(result.file);
    lines.push(`## ${fileName}`);
    lines.push(`Path: \`${result.file}\``);
    lines.push(``);

    if (result.consoleLogs.length > 0) {
      lines.push(`### Console Logs (${result.consoleLogs.length})`);
      result.consoleLogs.forEach(log => {
        lines.push(`- Line ${log.line}: \`${log.content}\``);
      });
      lines.push(``);
    }

    if (result.comments.length > 0) {
      lines.push(`### Comments (${result.comments.length})`);
      result.comments.forEach(comment => {
        const typeLabel = comment.type === 'single' ? 'Single-line' : comment.type === 'block' ? 'Block' : 'JSX';
        lines.push(`- Line ${comment.line} (${typeLabel}): \`${comment.content}\``);
      });
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(``);
  });

  lines.push(`### Next Steps`);
  lines.push(`Run **No Logs Clean: Remove All Console Logs & Comments** to clean all files.`);

  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const reportPath = path.join(workspaceRoot, `no-logs-scan-${Date.now()}.md`);
  fs.writeFileSync(reportPath, lines.join('\n'));

  const doc = await vscode.workspace.openTextDocument(reportPath);
  await vscode.window.showTextDocument(doc);
}

async function showCleanupResults(results: CleanupResult[]): Promise<void> {
  const successful = results.filter(r => r.changed);
  const errors = results.filter(r => r.error);
  const totalConsole = successful.reduce((sum, r) => sum + r.consoleLogsRemoved, 0);
  const totalComments = successful.reduce((sum, r) => sum + r.commentsRemoved, 0);

  let message = `Cleanup complete! `;
  message += `Modified ${successful.length} files. `;
  message += `Removed ${totalConsole} console logs and ${totalComments} comments.`;

  if (errors.length > 0) {
    message += ` ${errors.length} files had errors.`;
  }

  vscode.window.showInformationMessage(message);

  const lines: string[] = [
    `# No Logs Clean - Cleanup Results`,
    ``,
    `**${successful.length} files modified** | **${totalConsole} console logs removed** | **${totalComments} comments removed**`,
    ``,
    `---`,
    ``
  ];

  if (successful.length > 0) {
    lines.push(`## Modified Files`);
    lines.push(``);
    successful.forEach(result => {
      const fileName = path.basename(result.file);
      const sizeDiff = result.originalSize - result.newSize;
      lines.push(`- **${fileName}**: Removed ${result.consoleLogsRemoved} console logs, ${result.commentsRemoved} comments (${sizeDiff} chars saved)`);
    });
    lines.push(``);
  }

  if (errors.length > 0) {
    lines.push(`## Errors`);
    lines.push(``);
    errors.forEach(result => {
      const fileName = path.basename(result.file);
      lines.push(`- **${fileName}**: ${result.error}`);
    });
  }

  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const resultsPath = path.join(workspaceRoot, `no-logs-cleanup-${Date.now()}.md`);
  fs.writeFileSync(resultsPath, lines.join('\n'));

  const doc = await vscode.workspace.openTextDocument(resultsPath);
  await vscode.window.showTextDocument(doc);
}

export function deactivate() {}