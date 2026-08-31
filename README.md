# Kiro Global Hook

Automatically detects and initializes [Kiro](https://kiro.dev) hooks when you open a workspace. Keep your agent hooks consistent across all projects.

## Features

- **Auto-sync hooks** — On workspace open, detects missing or outdated hooks in `.kiro/hooks/` and prompts to sync from your template directory
- **Browse Folder setup** — First-time users get a friendly notification with a "Browse Folder" button to pick their template directory via native file picker — no need to dig through settings
- **Content-based comparison** — Compares file content, not just filenames, to detect outdated hooks
- **Mirror mode (optional)** — Set `syncMode` to `mirror` to also delete managed hooks that were removed or renamed in the template. Manually added hooks are preserved via a manifest, and the first sync asks for confirmation before deleting anything
- **Clear All Hooks** — One command to remove all hooks from the current workspace (with 5-second undo window)
- **Global config** — Template directory is configured once and works across all workspaces

## Setup

1. Open any workspace in Kiro
2. If no template directory is configured, a notification appears — click **"Browse Folder"** and select your hooks directory
3. That's it! Future workspaces will auto-detect and sync hooks from that directory

Or manually: set `kiroHooksInit.templateDir` in Settings to the absolute path of your hooks directory.

## Commands

| Command | Description |
|---------|-------------|
| `Kiro Hooks: Clear All Hooks` | Remove all hook files from `.kiro/hooks/` with 5-second undo |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `kiroHooksInit.templateDir` | — | Absolute path to the directory containing hook template files |
| `kiroHooksInit.fileExtensions` | `.kiro.hook`, `.json`, `.sh` | File suffixes to sync from the template directory |
| `kiroHooksInit.syncMode` | `additive` | `additive`: add/update only, never delete. `mirror`: also delete managed hooks removed from the template (manual hooks preserved, first sync requires confirmation). Workspace-overridable — set per project in `.vscode/settings.json` |
