import * as vscode from 'vscode';

const STATUS_BAR_COMMAND = 'kiroHooksInit.openSettings';
const CLEAR_ALL_COMMAND = 'kiroHooksInit.clearAllHooks';
const DISMISSED_KEY = 'kiroHooksInit.notificationDismissed';
const UNDO_WINDOW_MS = 5000;

let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Register command to open settings
  context.subscriptions.push(
    vscode.commands.registerCommand(STATUS_BAR_COMMAND, () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'kiroHooksInit.templateDir'
      );
    })
  );

  // Register Clear All Hooks command
  context.subscriptions.push(
    vscode.commands.registerCommand(CLEAR_ALL_COMMAND, () => clearAllHooks())
  );

  initHooks(context);
}

async function initHooks(context: vscode.ExtensionContext) {
  const folder = await findFirstValidFolder();
  if (!folder) { return; }

  const config = vscode.workspace.getConfiguration('kiroHooksInit');
  const templateDir = config.get<string>('templateDir', '').trim();

  // No templateDir configured — show status bar + first-time notification
  if (!templateDir) {
    showStatusBar(context, '$(warning) Kiro Hooks: No template configured');

    const dismissed = context.globalState.get<boolean>(DISMISSED_KEY, false);
    if (!dismissed) {
      const answer = await vscode.window.showInformationMessage(
        'Kiro Global Hook: No shared hook folder configured. Set one to auto-sync hooks across workspaces.',
        'Browse Folder',
        "Don't show again"
      );
      if (answer === 'Browse Folder') {
        console.log('[KiroGlobalHook] user clicked Browse Folder');
        const uris = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: 'Select Hook Template Folder',
        });
        if (uris && uris.length > 0) {
          const selectedPath = uris[0].fsPath;
          console.log(`[KiroGlobalHook] folder selected: ${selectedPath}`);
          await vscode.workspace.getConfiguration('kiroHooksInit').update(
            'templateDir',
            selectedPath,
            vscode.ConfigurationTarget.Global
          );
          vscode.window.showInformationMessage(`Kiro Global Hook: Template folder set to "${selectedPath}" ✓`);
          console.log('[KiroGlobalHook] setting saved, re-running initHooks');
          // Re-run with new config
          initHooks(context);
          return;
        }
      } else if (answer === "Don't show again") {
        context.globalState.update(DISMISSED_KEY, true);
      }
    }
    return;
  }

  // templateDir is configured — read templates and copy to .kiro/hooks/
  const templateUri = vscode.Uri.file(templateDir);
  const hooksDir = vscode.Uri.joinPath(folder.uri, '.kiro', 'hooks');

  // Read template files (file types configurable via kiroHooksInit.fileExtensions)
  const fileExtensions = config.get<string[]>('fileExtensions', ['.kiro.hook', '.json', '.sh']);
  let templateFiles: [string, vscode.FileType][];
  try {
    const allEntries = await vscode.workspace.fs.readDirectory(templateUri);
    templateFiles = allEntries.filter(
      ([name, type]) => type === vscode.FileType.File && fileExtensions.some((ext) => name.endsWith(ext))
    );
  } catch {
    vscode.window.showErrorMessage(
      `Kiro Hooks Init: Cannot read template directory "${templateDir}". Check the path in settings.`
    );
    return;
  }

  if (templateFiles.length === 0) {
    vscode.window.showWarningMessage(
      `Kiro Hooks Init: No template files matching [${fileExtensions.join(', ')}] found in "${templateDir}".`
    );
    return;
  }

  // Check which hooks are missing or outdated
  let existingNames: string[] = [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(hooksDir);
    existingNames = entries.map(([name]) => name);
  } catch {
    // Directory doesn't exist — all hooks are missing
  }

  const missing: string[] = [];
  const outdated: string[] = [];

  for (const [name] of templateFiles) {
    if (!existingNames.includes(name)) {
      missing.push(name);
    } else {
      // Compare content
      const srcContent = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(templateUri, name));
      const destContent = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(hooksDir, name));
      if (Buffer.from(srcContent).toString() !== Buffer.from(destContent).toString()) {
        outdated.push(name);
      }
    }
  }

  if (missing.length === 0 && outdated.length === 0) {
    hideStatusBar();
    return;
  }

  // Build message
  const parts: string[] = [];
  if (missing.length > 0) { parts.push(`${missing.length} missing`); }
  if (outdated.length > 0) { parts.push(`${outdated.length} outdated`); }

  const answer = await vscode.window.showInformationMessage(
    `Kiro Hooks Init: ${parts.join(', ')} hook(s). Sync from templates?`,
    'Yes',
    'No'
  );

  if (answer !== 'Yes') { return; }

  // Create directory and copy missing + outdated hooks
  await vscode.workspace.fs.createDirectory(hooksDir);
  for (const name of [...missing, ...outdated]) {
    const src = vscode.Uri.joinPath(templateUri, name);
    const dest = vscode.Uri.joinPath(hooksDir, name);
    const content = await vscode.workspace.fs.readFile(src);
    await vscode.workspace.fs.writeFile(dest, content);
  }

  hideStatusBar();
  const syncCount = missing.length + outdated.length;
  vscode.window.showInformationMessage(`Kiro Hooks Init: ${syncCount} hook(s) synced ✓`);
}

async function findFirstValidFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return undefined; }
  for (const f of folders) {
    try {
      await vscode.workspace.fs.stat(f.uri);
      return f;
    } catch {
      // skip non-existent
    }
  }
  return undefined;
}

async function clearAllHooks(): Promise<void> {
  console.log('[KiroGlobalHook] clearAllHooks invoked');

  const folder = await findFirstValidFolder();
  if (!folder) {
    vscode.window.showWarningMessage('Kiro Hooks: No workspace folder found.');
    return;
  }

  const hooksDir = vscode.Uri.joinPath(folder.uri, '.kiro', 'hooks');

  // Read all hook files
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(hooksDir);
  } catch {
    vscode.window.showInformationMessage('Kiro Hooks: No .kiro/hooks/ directory found — nothing to clear.');
    return;
  }

  const hookFiles = entries.filter(([, type]) => type === vscode.FileType.File);
  if (hookFiles.length === 0) {
    vscode.window.showInformationMessage('Kiro Hooks: .kiro/hooks/ is already empty.');
    return;
  }

  // Confirm before destructive action
  const confirm = await vscode.window.showWarningMessage(
    `Clear all ${hookFiles.length} file(s) from .kiro/hooks/?`,
    { modal: true },
    'Clear All'
  );
  if (confirm !== 'Clear All') { return; }

  // Backup all files to memory
  const backup = new Map<string, Uint8Array>();
  for (const [name] of hookFiles) {
    const uri = vscode.Uri.joinPath(hooksDir, name);
    const content = await vscode.workspace.fs.readFile(uri);
    backup.set(name, content);
  }
  console.log(`[KiroGlobalHook] backup created: ${backup.size} file(s)`);

  // Delete all files
  for (const [name] of hookFiles) {
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(hooksDir, name));
  }
  console.log(`[KiroGlobalHook] deleted ${hookFiles.length} file(s)`);

  // 5s undo window
  let revertExpired = false;
  const timer = setTimeout(() => {
    revertExpired = true;
    console.log('[KiroGlobalHook] undo window expired — clear finalized');
  }, UNDO_WINDOW_MS);

  const undo = await vscode.window.showInformationMessage(
    `Cleared ${hookFiles.length} hook(s). You have 5 seconds to undo.`,
    'Undo'
  );

  if (undo === 'Undo' && !revertExpired) {
    clearTimeout(timer);
    for (const [name, content] of backup) {
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(hooksDir, name), content);
    }
    console.log('[KiroGlobalHook] undo: restored all files');
    vscode.window.showInformationMessage(`Kiro Hooks: Restored ${backup.size} hook(s) ✓`);
  } else if (undo === 'Undo' && revertExpired) {
    vscode.window.showWarningMessage('Kiro Hooks: Undo window expired — files already cleared.');
  }
}

function showStatusBar(context: vscode.ExtensionContext, text: string) {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);
  }
  statusBarItem.text = text;
  statusBarItem.command = STATUS_BAR_COMMAND;
  statusBarItem.tooltip = 'Click to configure Kiro Hooks template directory';
  statusBarItem.show();
}

function hideStatusBar() {
  if (statusBarItem) {
    statusBarItem.hide();
  }
}

export function deactivate() {}
