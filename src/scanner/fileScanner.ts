import * as vscode from 'vscode';

export async function findSourceFiles(): Promise<vscode.Uri[]> {
  const config = vscode.workspace.getConfiguration('no-logs');
  const include = config.get<string>('filePatterns') || '**/*.{js,jsx,ts,tsx,mjs,cjs}';
  const exclude = config.get<string>('excludePatterns') || '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/build/**,**/.vscode/**}';
  const maxResults = 20000;
  const uris = await vscode.workspace.findFiles(include, exclude, maxResults);
  return uris;
}