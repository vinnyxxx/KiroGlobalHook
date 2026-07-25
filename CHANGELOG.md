# Changelog

## 0.8.0

- **Remote workspace support** — Extension now runs on the local machine (`extensionKind: ["ui"]`), so a template directory on your local disk syncs hooks into remote workspaces (SSH / cloud desktop) too. Fixes "Cannot read template directory" errors when connected to a remote host.

## 0.7.0

- **Configurable file types** — New `kiroHooksInit.fileExtensions` setting controls which files are synced from the template directory (default: `.kiro.hook`, `.json`, `.sh`)
- `.json` hook files (Kiro hooks v2 format) are now synced by default
- Template scan now skips subdirectories, only regular files are synced

## 0.6.0

- **Browse Folder notification** — "Configure" button replaced with "Browse Folder" that opens a native folder picker and saves the template directory automatically
- **Clear All Hooks command** — New Command Palette command to remove all hooks from `.kiro/hooks/` with a 5-second undo window
- Extracted shared `findFirstValidFolder()` helper for multi-root workspace support

## 0.5.0

- Also sync `.sh` scripts from template directory alongside `.kiro.hook` files

## 0.4.0

- Hook sync now compares file content, not just filenames — detects and updates outdated hooks
- Skips workspace folders that don't exist on disk, avoiding errors in multi-root workspaces with stale references

## 0.3.0

- Renamed to "Kiro Global Hook"
- Template directory setting is now global (application scope) — configure once, works across all workspaces

## 0.2.0

- Fixed template directory setting scope to application-level (global across workspaces)

## 0.1.0

- Initial release
- Auto-detect missing Kiro hooks on workspace open
- Configurable template directory via settings
- Status bar indicator when template directory not configured
- First-time notification with "Don't show again" option
