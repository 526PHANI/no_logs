# Migration Guide: v1.x to v2.0

## Quick Summary

Version 2.0 simplifies the workflow and adds powerful new features:
- ✅ Automatic rollback support
- ✅ Detailed reports
- ✅ Keyboard shortcuts
- ✅ Simplified commands

## Breaking Changes

### Command Changes

| Old Command | New Command | Notes |
|-------------|-------------|-------|
| `noLogs.scan` | Removed | Now integrated into `noLogs.clean` |
| `noLogs.clean` | `noLogs.clean` | Now does scan + preview + clean in one flow |
| N/A | `noLogs.preview` | NEW - Preview only, no cleanup |
| N/A | `noLogs.rollback` | NEW - Rollback last cleanup |

### Workflow Changes

**Old Workflow (v1.x):**
```
1. Run "No Logs: Scan"
2. Review results
3. Run "No Logs: Clean"
4. Confirm
```

**New Workflow (v2.0):**
```
1. Run "No Logs: Clean" (or press Ctrl+Shift+L)
2. Automatic scan + preview
3. Confirm
4. Cleanup + Report generated
5. (Optional) Rollback if needed
```

## New Features You Should Try

### 1. Keyboard Shortcuts
Instead of opening command palette every time:

```
Ctrl/Cmd + Shift + L  →  Clean console statements
Ctrl/Cmd + Shift + Alt + L  →  Preview only
Ctrl/Cmd + Shift + Z  →  Rollback
```

### 2. Right-Click Menu
Right-click in any JS/TS file → "No Logs: Clean Console Statements"

### 3. Rollback Safety Net
Made a mistake? Just run:
```
Command Palette → "No Logs: Rollback Last Cleanup"
```

### 4. Detailed Reports
After every cleanup, check `.no-logs-report.md` in your workspace:
- See exactly what was removed
- Line-by-line diff format
- Summary statistics
- Easy to review and share

## Code Changes Required

### Update package.json

Replace your old `contributes` section with:

```json
{
  "contributes": {
    "commands": [
      {
        "command": "noLogs.clean",
        "title": "No Logs: Clean Console Statements",
        "icon": "$(trash)"
      },
      {
        "command": "noLogs.preview",
        "title": "No Logs: Preview Console Statements",
        "icon": "$(search)"
      },
      {
        "command": "noLogs.rollback",
        "title": "No Logs: Rollback Last Cleanup",
        "icon": "$(discard)"
      }
    ],
    "keybindings": [
      {
        "command": "noLogs.clean",
        "key": "ctrl+shift+l",
        "mac": "cmd+shift+l"
      }
    ],
    "menus": {
      "editor/context": [
        {
          "command": "noLogs.clean",
          "group": "1_modification",
          "when": "editorLangId =~ /javascript|typescript|javascriptreact|typescriptreact/"
        }
      ]
    }
  }
}
```

### Update types.ts

Add the `BackupData` interface:

```typescript
export interface BackupData {
  timestamp: string;
  files: Array<{
    filePath: string;
    originalContent: string;
  }>;
}
```

### Replace extension.ts

Use the new `extension.ts` file provided. Key changes:
- New `runCleanupWorkflow()` function
- Added `performRollback()` function
- Added `generateReport()` function
- Enhanced `processFileWithDetails()` for detailed reporting

## Testing the Migration

1. **Backup your current version** (just in case)
   ```bash
   git commit -am "Backup before v2.0 migration"
   ```

2. **Replace the files:**
   - `extension.ts` - Complete replacement
   - `types.ts` - Add BackupData interface
   - `package.json` - Update contributes section
   - Add `README.md` and `CHANGELOG.md`

3. **Test the new commands:**
   ```bash
   # In your extension development host:
   1. Press F5 to launch extension
   2. Open a test project
   3. Press Ctrl+Shift+L
   4. Verify preview appears
   5. Confirm cleanup
   6. Check .no-logs-report.md
   7. Run rollback
   8. Verify files restored
   ```

4. **Verify keyboard shortcuts work**
5. **Test right-click context menu**
6. **Verify report generation**

## Configuration Options

Add to your workspace settings:

```json
{
  "noLogs.autoGenerateReport": true,
  "noLogs.createBackup": true,
  "noLogs.consoleMethodsToRemove": [
    "log",
    "debug",
    "info"
  ],
  "noLogs.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**"
  ]
}
```

## Publishing Checklist

- [ ] Update `package.json` version to `2.0.0`
- [ ] Update `CHANGELOG.md`
- [ ] Test all commands work
- [ ] Test keyboard shortcuts
- [ ] Test rollback functionality
- [ ] Test report generation
- [ ] Update README with new features
- [ ] Add screenshots/GIFs to README (recommended)
- [ ] Test on different file types (JS, TS, JSX, Vue)
- [ ] Test on large projects
- [ ] Verify exclusion patterns work

## Common Migration Issues

### Issue: "Command not found"
**Solution:** Make sure you updated the command IDs in `package.json` and reloaded the window.

### Issue: "Rollback not working"
**Solution:** Ensure `noLogs.createBackup` is set to `true` in settings.

### Issue: "Report not generated"
**Solution:** Check `noLogs.autoGenerateReport` setting and verify write permissions in workspace.

### Issue: "Keyboard shortcut conflicts"
**Solution:** Customize shortcuts in `File > Preferences > Keyboard Shortcuts`.

## Support

If you encounter issues during migration:
1. Check the console output (Help > Toggle Developer Tools)
2. Verify all files were updated correctly
3. Try reloading the VSCode window
4. Check the extension host output

---

**Need help?** Open an issue on GitHub with:
- Your current version
- Error messages
- Steps to reproduce