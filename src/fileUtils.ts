import * as vscode from "vscode";
import * as path from "path";

export async function findWorkspaceScriptFiles(): Promise<vscode.Uri[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error("No workspace folder found");
  }

  const allFiles: vscode.Uri[] = [];

  const includePatterns = [
    "**/*.js",
    "**/*.jsx", 
    "**/*.ts",
    "**/*.tsx",
    "**/*.mjs",
    "**/*.cjs",
    "**/*.vue",
    "**/*.svelte"
  ];

  const excludePatterns = [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/.output/**",
    "**/coverage/**",
    "**/.git/**",
    "**/.vscode/**",
    "**/.idea/**",
    "**/bin/**",
    "**/obj/**",
    "**/*.min.js",
    "**/*.bundle.js",
    "**/vendor/**",
    "**/vendors/**",
    "**/public/assets/**",
    "**/static/js/**"
  ];

  try {
    for (const folder of workspaceFolders) {
      console.log(`Searching in workspace folder: ${folder.uri.fsPath}`);
      
      for (const includePattern of includePatterns) {
        try {
          const relativePattern = new vscode.RelativePattern(folder, includePattern);
          const excludeGlob = `{${excludePatterns.join(",")}}`;

          const foundFiles = await vscode.workspace.findFiles(relativePattern, excludeGlob);

          console.log(`Pattern ${includePattern} found ${foundFiles.length} files`);
          allFiles.push(...foundFiles);
        } catch (error) {
          console.error(`Error searching with pattern ${includePattern}:`, error);
        }
      }
    }

    const uniqueFiles = Array.from(new Set(allFiles.map(uri => uri.fsPath)))
      .map(fsPath => vscode.Uri.file(fsPath))
      .filter(uri => {
        const filePath = uri.fsPath;
        if (filePath.includes('.output')) return false;
        if (filePath.includes('node_modules')) return false;
        if (filePath.includes('.min.js')) return false;
        if (filePath.includes('.bundle.js')) return false;
        if (filePath.includes(`${path.sep}dist${path.sep}`)) return false;
        if (filePath.includes(`${path.sep}build${path.sep}`)) return false;
        return true;
      });

    console.log(`Total unique files found: ${uniqueFiles.length}`);
    
    if (uniqueFiles.length > 0) {
      console.log("Example files found:");
      uniqueFiles.slice(0, 5).forEach((uri, index) => {
        console.log(`  ${index + 1}. ${uri.fsPath}`);
      });
      if (uniqueFiles.length > 5) {
        console.log(`  ... and ${uniqueFiles.length - 5} more files`);
      }
    }

    return uniqueFiles;

  } catch (error) {
    console.error("Error in findWorkspaceScriptFiles:", error);
    throw new Error(`Failed to find workspace files: ${error}`);
  }
}

export function getRelativePath(uri: vscode.Uri): string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (workspaceFolder) {
    return path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  }
  return path.basename(uri.fsPath);
}
