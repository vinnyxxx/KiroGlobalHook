# Kiro Global Hook

Automatically detects and initializes [Kiro](https://kiro.dev) hooks when you open a workspace.

## How it works

1. On workspace open, checks if `.kiro/hooks/` contains your hook templates
2. If hooks are missing, prompts you to initialize them from your template directory
3. If no template directory is configured, shows a non-intrusive status bar hint

## Setup

1. Create a directory with your `.kiro.hook` template files (e.g. `~/kiro-templates/`)
2. Open VS Code/Kiro Settings and set `kiroHooksInit.templateDir` to that directory path
3. Open any workspace — missing hooks will be detected and you'll be prompted to initialize

## Settings

| Setting | Description |
|---------|-------------|
| `kiroHooksInit.templateDir` | Absolute path to directory containing `.kiro.hook` template files |
