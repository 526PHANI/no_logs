import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { MatchItem, MatchType } from '../types/index';

const CONSOLE_METHODS = ['log', 'warn', 'error', 'info', 'debug', 'trace', 'clear', 'count', 'time', 'timeEnd', 'group', 'groupEnd', 'assert', 'table'];

export async function matchFile(uri: vscode.Uri, workspaceRoot?: vscode.Uri): Promise<MatchItem[]> {
  const res: MatchItem[] = [];
  let content: string;
  
  try {
    content = await fs.readFile(uri.fsPath, 'utf8');
  } catch (e) {
    return res;
  }

  const relativePath = workspaceRoot ? path.relative(workspaceRoot.fsPath, uri.fsPath) : uri.fsPath;
  const lines = content.split(/\r?\n/);

  // Process line by line - no AST parsing!
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineNumber = lineIndex + 1;
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      continue;
    }

    // Find console calls
    const consoleRegex = new RegExp(`console\\.(${CONSOLE_METHODS.join('|')})\\s*\\(`, 'g');
    let consoleMatch;
    while ((consoleMatch = consoleRegex.exec(line)) !== null) {
      res.push({
        uri,
        relativePath,
        line: lineNumber,
        endLine: lineNumber,
        column: consoleMatch.index,
        type: 'ConsoleCall',
        preview: line.trim(),
        rangeStart: undefined,
        rangeEnd: undefined,
      });
    }

    // Find single-line comments
    const singleLineCommentMatch = line.match(/\/\/.*/);
    if (singleLineCommentMatch) {
      res.push({
        uri,
        relativePath,
        line: lineNumber,
        endLine: lineNumber,
        column: singleLineCommentMatch.index || 0,
        type: 'SingleLineComment',
        preview: line.trim(),
        rangeStart: undefined,
        rangeEnd: undefined,
      });
    }

    // Find single-line block comments
    const blockCommentMatch = line.match(/\/\*.*?\*\//);
    if (blockCommentMatch) {
      res.push({
        uri,
        relativePath,
        line: lineNumber,
        endLine: lineNumber,
        column: blockCommentMatch.index || 0,
        type: 'BlockComment',
        preview: line.trim(),
        rangeStart: undefined,
        rangeEnd: undefined,
      });
    }

    // Find JSX comments
    const jsxCommentMatch = line.match(/\{[\s]*\/\*.*?\*\/[\s]*\}/);
    if (jsxCommentMatch) {
      res.push({
        uri,
        relativePath,
        line: lineNumber,
        endLine: lineNumber,
        column: jsxCommentMatch.index || 0,
        type: 'JSXComment',
        preview: line.trim(),
        rangeStart: undefined,
        rangeEnd: undefined,
      });
    }
  }

  // Find multi-line block comments
  const multiLineBlockComments = content.matchAll(/\/\*([\s\S]*?)\*\//g);
  for (const match of multiLineBlockComments) {
    const matchText = match[0];
    const matchIndex = match.index || 0;
    
    // Find line numbers for the match
    const beforeMatch = content.substring(0, matchIndex);
    const startLine = (beforeMatch.match(/\n/g) || []).length + 1;
    const matchLines = (matchText.match(/\n/g) || []).length;
    const endLine = startLine + matchLines;
    
    const preview = matchText.split('\n')[0].trim();
    
    res.push({
      uri,
      relativePath,
      line: startLine,
      endLine: endLine,
      column: 0,
      type: 'BlockComment',
      preview: preview.length > 60 ? `${preview.slice(0, 57)}...` : preview,
      rangeStart: undefined,
      rangeEnd: undefined,
    });
  }

  // Find multi-line JSX comments
  const multiLineJSXComments = content.matchAll(/\{[\s]*\/\*([\s\S]*?)\*\/[\s]*\}/g);
  for (const match of multiLineJSXComments) {
    const matchText = match[0];
    const matchIndex = match.index || 0;
    
    // Find line numbers for the match
    const beforeMatch = content.substring(0, matchIndex);
    const startLine = (beforeMatch.match(/\n/g) || []).length + 1;
    const matchLines = (matchText.match(/\n/g) || []).length;
    const endLine = startLine + matchLines;
    
    const preview = matchText.split('\n')[0].trim();
    
    res.push({
      uri,
      relativePath,
      line: startLine,
      endLine: endLine,
      column: 0,
      type: 'JSXComment',
      preview: preview.length > 60 ? `${preview.slice(0, 57)}...` : preview,
      rangeStart: undefined,
      rangeEnd: undefined,
    });
  }

  // Sort results by line number
  res.sort((a, b) => {
    if (a.relativePath < b.relativePath) {
      return -1;
    }
    if (a.relativePath > b.relativePath) {
      return 1;
    }
    return a.line - b.line || (a.column || 0) - (b.column || 0);
  });

  return res;
}