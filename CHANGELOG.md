# Changelog

All notable changes to the "No-Logs" extension will be documented in this file.

## [2.0.0] - 2025-09-30

### 🎉 Major Features

#### Rollback System
- **NEW:** Complete rollback functionality - undo any cleanup with one command
- Automatic backup creation before every cleanup
- Rollback command: `No Logs: Rollback Last Cleanup`
- Keyboard shortcut: `Ctrl/Cmd + Shift + Z`
- Backup persists for the current VSCode session

#### Detailed Reports
- **NEW:** Git-diff style reports showing exactly what was removed
- Report saved to `.no-logs-report.md` in workspace root
- Shows line numbers, original code, and replacements
- Includes summary statistics
- Option to open report immediately after cleanup

#### Enhanced User Experience
- **NEW:** Keyboard shortcuts for all commands
  - Clean: `Ctrl/Cmd + Shift + L`
  - Preview: `Ctrl/Cmd + Shift + Alt + L`
  - Rollback: `Ctrl/Cmd + Shift + Z`
- **NEW:** Context menu integration (right-click in editor)
- **NEW:** Simplified workflow - single command does scan + preview + clean
- **NEW:** Better progress notifications with file names
- **NEW:** Interactive preview with jump-to-location

### ✨ Improvements

#### Smart Removal
- Improved detection of complex expressions
- Better handling of arrow functions
- Enhanced ternary operator support
- Safer comma operator handling
- Better JSX expression handling

#### Configuration
- **NEW:** `noLogs.excludePatterns` - Custom exclude patterns
- **NEW:** `noLogs.autoGenerateReport` - Toggle report generation
- **NEW:** `noLogs.createBackup` - Toggle backup creation
- **NEW:** `noLogs.consoleMethodsToRemove` - Choose which methods to remove

#### Performance
- Faster file scanning
- Better memory management for large workspaces
- Improved error handling

### 🔧 Changes
- Removed separate "Scan" command (now integrated into "Clean")
- Changed command names for clarity
- Updated icons for better visibility

### 📊 Statistics
- Now shows "X replaced" count separately from removals
- Better failure reporting
- Summary includes skipped files count

---

## [1.0.0] - 2025-09-15

### Initial Release

#### Features
- Scan workspace for console statements
- Preview console statements before removal
- Clean console statements from multiple files
- Support for JavaScript, TypeScript, React, Vue, Svelte
- Smart removal that preserves code structure
- Progress notifications

#### Supported Console Methods
- log, error, warn, info, debug, trace
- assert, dir, dirxml
- group, groupEnd, groupCollapsed
- profile, profileEnd
- time, timeEnd, timeLog, timeStamp
- table, count, countReset, clear

#### Safety Features
- Confirmation dialog before removal
- Preview with file and line numbers
- Handles complex expressions
- Skips minified files
- Excludes common build directories