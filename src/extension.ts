import * as vscode from 'vscode';

const STATUS_BAR_COMMAND = 'kiroHooksInit.openSettings';
const CLEAR_ALL_COMMAND = 'kiroHooksInit.clearAllHooks';
const DISMISSED_KEY = 'kiroHooksInit.notificationDismissed';
const UNDO_WINDOW_MS = 5000;
// Lives in .kiro/ root, NOT .kiro/hooks/ — Kiro loads *.json in hooks/ as hook definitions
const MANIFEST_FILE = '.kiro-global-hook-manifest.json';

interface SyncManifest {
  version: number;
  syncedAt: string;
  files: string[];
}

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
  let existingEntries: [string, vscode.FileType][] = [];
  try {
    existingEntries = await vscode.workspace.fs.readDirectory(hooksDir);
  } catch {
    // Directory doesn't exist — all hooks are missing
  }
  const existingNames = existingEntries.map(([name]) => name);

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

  // Mirror mode: compute deletions (managed files that left the template)
  const syncMode = config.get<string>('syncMode', 'additive');
  let toDelete: string[] = [];
  let mirrorActive = false;
  let skipPrompt = false;

  if (syncMode === 'mirror') {
    const templateNames = new Set(templateFiles.map(([name]) => name));
    const candidates = existingEntries
      .filter(
        ([name, type]) =>
          type === vscode.FileType.File &&
          !templateNames.has(name) &&
          fileExtensions.some((ext) => name.endsWith(ext))
      )
      .map(([name]) => name);

    const manifest = await readManifest(folder);

    if (manifest) {
      // Steady state: only delete files this extension placed earlier.
      // Files the user added manually (not in manifest) are never touched.
      mirrorActive = true;
      toDelete = candidates.filter((name) => manifest.files.includes(name));
    } else if (candidates.length === 0) {
      // First mirror sync with nothing to delete — no risk, adopt silently
      mirrorActive = true;
    } else {
      // First mirror sync would delete files — require explicit confirmation
      const shown = candidates.slice(0, 10).join('\n');
      const more = candidates.length > 10 ? `\n…and ${candidates.length - 10} more` : '';
      const confirmLabel = `Delete ${candidates.length} & Enable Mirror`;
      const confirm = await vscode.window.showWarningMessage(
        `Kiro Global Hook — first mirror sync.\n\nThese ${candidates.length} file(s) in .kiro/hooks/ are NOT in your template and will be DELETED:\n\n${shown}${more}\n\nAfter this, the template directory is the source of truth for synced hooks. Hooks you add manually later will be preserved.`,
        { modal: true },
        confirmLabel
      );
      if (confirm === confirmLabel) {
        mirrorActive = true;
        toDelete = candidates;
        skipPrompt = true; // modal already confirmed this batch
      }
      // Declined → this run behaves like additive (no deletions, no manifest)
    }
  }

  if (missing.length === 0 && outdated.length === 0 && toDelete.length === 0) {
    if (mirrorActive) {
      await writeManifest(folder, templateFiles.map(([name]) => name));
    }
    hideStatusBar();
    return;
  }

  // Build message
  const parts: string[] = [];
  if (missing.length > 0) { parts.push(`${missing.length} missing`); }
  if (outdated.length > 0) { parts.push(`${outdated.length} outdated`); }
  if (toDelete.length > 0) { parts.push(`${toDelete.length} removed`); }

  const answer = skipPrompt
    ? 'Yes'
    : await vscode.window.showInformationMessage(
        `Kiro Hooks Init: ${parts.join(', ')} hook(s). Sync from templates?`,
        'Yes',
        'No'
      );

  if (answer !== 'Yes') { return; }

  // Create directory, copy missing + outdated, then remove orphans (mirror only)
  await vscode.workspace.fs.createDirectory(hooksDir);
  for (const name of [...missing, ...outdated]) {
    const src = vscode.Uri.joinPath(templateUri, name);
    const dest = vscode.Uri.joinPath(hooksDir, name);
    const content = await vscode.workspace.fs.readFile(src);
    await vscode.workspace.fs.writeFile(dest, content);
  }
  for (const name of toDelete) {
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(hooksDir, name));
  }
  if (mirrorActive) {
    await writeManifest(folder, templateFiles.map(([name]) => name));
  }

  hideStatusBar();
  const syncCount = missing.length + outdated.length;
  const deleteNote = toDelete.length > 0 ? `, ${toDelete.length} removed` : '';
  vscode.window.showInformationMessage(`Kiro Hooks Init: ${syncCount} hook(s) synced${deleteNote} ✓`);
}

function manifestUri(folder: vscode.WorkspaceFolder): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, '.kiro', MANIFEST_FILE);
}

async function readManifest(folder: vscode.WorkspaceFolder): Promise<SyncManifest | undefined> {
  try {
    const raw = await vscode.workspace.fs.readFile(manifestUri(folder));
    const parsed = JSON.parse(Buffer.from(raw).toString());
    if (parsed && Array.isArray(parsed.files)) {
      return parsed as SyncManifest;
    }
  } catch {
    // Missing or unparsable — treated as "no manifest"
  }
  return undefined;
}

async function writeManifest(folder: vscode.WorkspaceFolder, files: string[]): Promise<void> {
  const manifest: SyncManifest = {
    version: 1,
    syncedAt: new Date().toISOString(),
    files: [...files].sort(),
  };
  await vscode.workspace.fs.writeFile(
    manifestUri(folder),
    Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
  );
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
