# 🧹 No-Logs - Console Statement Cleaner

A powerful VSCode extension to automatically find and remove console statements from your JavaScript/TypeScript projects with **rollback support** and detailed reports.

## ✨ Features

- 🔍 **Smart Detection** - Finds all console statements across your workspace
- 🛡️ **Safe Removal** - Handles complex expressions without breaking your code
- ↩️ **Rollback Support** - Undo cleanups anytime with one command
- 📊 **Detailed Reports** - Git-diff style reports showing exactly what was removed
- ⚡ **Multiple Ways to Execute** - Keyboard shortcuts, context menu, or command palette
- 🎯 **Intelligent Replacements** - Replaces console statements in expressions with safe alternatives

## 🚀 Quick Start

### Method 1: Keyboard Shortcut (Fastest)
- **Windows/Linux:** `Ctrl + Shift + L`
- **Mac:** `Cmd + Shift + L`

### Method 2: Command Palette
1. Press `Ctrl/Cmd + Shift + P`
2. Type "No Logs: Clean Console Statements"
3. Press Enter

### Method 3: Right-Click Menu
1. Right-click anywhere in a JS/TS file
2. Select "No Logs: Clean Console Statements"

## 📋 Available Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `No Logs: Clean Console Statements` | `Ctrl/Cmd + Shift + L` | Scan and remove console statements |
| `No Logs: Preview Console Statements` | `Ctrl/Cmd + Shift + Alt + L` | Preview without removing |
| `No Logs: Rollback Last Cleanup` | `Ctrl/Cmd + Shift + Z` | Undo last cleanup operation |

## 🔄 Workflow

1. **Scan** - Extension scans your workspace for console statements
2. **Preview** - Shows what will be removed with file/line details
3. **Confirm** - You approve the removal
4. **Backup** - Automatic backup is created
5. **Remove** - Console statements are removed/replaced
6. **Report** - Detailed `.no-logs-report.md` is generated

## 📊 Report Example

After cleanup, a report is generated:

```markdown
# 🧹 No-Logs Cleanup Report

**Date:** 9/30/2025, 2:30:45 PM

## Summary

- **Files Modified:** 5
- **Total Removals:** 23
- **Total Replacements:** 3

---

## Changes by File

### 📄 src/components/Button.tsx

**Line 23** _(Standalone statement)_

```diff
- console.log('Button clicked', event);
```

**Line 45** _(Return statement)_

```diff
- return console.log(x) || x;
+ return undefined || x;
```
```

## 🛡️ Smart Removal Examples

The extension intelligently handles complex code patterns:

### Arrow Functions
```javascript
// Before
const handler = () => console.log('test');

// After
const handler = () => {};
```

### Ternary Operators
```javascript
// Before
const result = condition ? console.log('yes') : 'no';

// After
const result = condition ? undefined : 'no';
```

### Return Statements
```javascript
// Before
return console.log(data) || data;

// After
return undefined || data;
```

### JSX Expressions
```javascript
// Before
<div>{console.log('render')}</div>

// After
<div>{null}</div>
```

## ↩️ Rollback Feature

Made a mistake? No problem!

1. Run `No Logs: Rollback Last Cleanup`
2. All files are restored to their previous state
3. Rollback info is shown in the report

**Note:** Rollback is available until you close VSCode or run another cleanup.

## ⚙️ Configuration

Access settings via `File > Preferences > Settings` and search for "No Logs":

### `noLogs.excludePatterns`
Additional patterns to exclude from scanning:
```json
{
  "noLogs.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**"
  ]
}
```

### `noLogs.autoGenerateReport`
Enable/disable automatic report generation:
```json
{
  "noLogs.autoGenerateReport": true
}
```

### `noLogs.consoleMethodsToRemove`
Choose which console methods to remove:
```json
{
  "noLogs.consoleMethodsToRemove": [
    "log",
    "debug",
    "info"
  ]
}
```

**Tip:** Remove "error" and "warn" from the list to keep error logging!

## 📁 Supported File Types

- JavaScript (`.js`, `.mjs`, `.cjs`)
- TypeScript (`.ts`, `.tsx`)
- React/JSX (`.jsx`)
- Vue (`.vue`)
- Svelte (`.svelte`)

## 🎯 Best Practices

1. **Always commit your changes** before running cleanup
2. **Review the preview** before confirming removal
3. **Check the report** after cleanup to verify changes
4. **Keep error/warn statements** for production debugging
5. **Use rollback** if something goes wrong

## ⚠️ Safety Features

- ✅ Automatic backup before any changes
- ✅ Confirmation dialog with warnings
- ✅ Detailed preview of what will be removed
- ✅ One-click rollback
- ✅ Skips minified and bundled files
- ✅ Handles complex expressions safely

## 🐛 Common Issues

### "No workspace folder found"
**Solution:** Open a folder or workspace in VSCode before running the extension.

### "Rollback not available"
**Solution:** Rollback is only available for the last cleanup in the current session. If you've closed VSCode, the backup is lost.

### Console statements not detected
**Solution:** Check if the file is in an excluded directory (node_modules, dist, etc.)

## 📝 Changelog

### Version 2.0.0
- ✨ Added rollback functionality
- ✨ Git-diff style reports
- ✨ Keyboard shortcuts
- ✨ Context menu integration
- ✨ Improved smart removal algorithms
- ✨ Configuration options

## 🤝 Contributing

Found a bug or have a feature request? Please open an issue on GitHub!

## 📄 License

MIT License - feel free to use in your projects!

---

**Made with ❤️ for developers who forget to remove their console.logs**