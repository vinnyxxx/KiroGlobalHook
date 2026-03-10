import * as vscode from 'vscode';

const STATUS_BAR_COMMAND = 'kiroHooksInit.openSettings';
const DISMISSED_KEY = 'kiroHooksInit.notificationDismissed';

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

  initHooks(context);
}

async function initHooks(context: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return; }

  const config = vscode.workspace.getConfiguration('kiroHooksInit');
  const templateDir = config.get<string>('templateDir', '').trim();

  // No templateDir configured — show status bar + first-time notification
  if (!templateDir) {
    showStatusBar(context, '$(warning) Kiro Hooks: No template configured');

    const dismissed = context.globalState.get<boolean>(DISMISSED_KEY, false);
    if (!dismissed) {
      const answer = await vscode.window.showInformationMessage(
        'Kiro Hooks Init: No template directory configured. Set one to auto-initialize hooks for new projects.',
        'Configure',
        "Don't show again"
      );
      if (answer === 'Configure') {
        vscode.commands.executeCommand(STATUS_BAR_COMMAND);
      } else if (answer === "Don't show again") {
        context.globalState.update(DISMISSED_KEY, true);
      }
    }
    return;
  }

  // templateDir is configured — read templates and copy to .kiro/hooks/
  const templateUri = vscode.Uri.file(templateDir);
  const hooksDir = vscode.Uri.joinPath(folder.uri, '.kiro', 'hooks');

  // Read template files
  let templateFiles: [string, vscode.FileType][];
  try {
    const allEntries = await vscode.workspace.fs.readDirectory(templateUri);
    templateFiles = allEntries.filter(([name]) => name.endsWith('.kiro.hook'));
  } catch {
    vscode.window.showErrorMessage(
      `Kiro Hooks Init: Cannot read template directory "${templateDir}". Check the path in settings.`
    );
    return;
  }

  if (templateFiles.length === 0) {
    vscode.window.showWarningMessage(
      `Kiro Hooks Init: No .kiro.hook files found in "${templateDir}".`
    );
    return;
  }

  // Check which hooks are missing
  let existingNames: string[] = [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(hooksDir);
    existingNames = entries.map(([name]) => name);
  } catch {
    // Directory doesn't exist — all hooks are missing
  }

  const missing = templateFiles.filter(([name]) => !existingNames.includes(name));
  if (missing.length === 0) {
    // All hooks already exist — hide status bar if shown
    hideStatusBar();
    return;
  }

  // Ask user to initialize
  const answer = await vscode.window.showInformationMessage(
    `Kiro Hooks Init: ${missing.length} hook(s) missing. Initialize from templates?`,
    'Yes',
    'No'
  );

  if (answer !== 'Yes') { return; }

  // Create directory and copy missing hooks
  await vscode.workspace.fs.createDirectory(hooksDir);
  for (const [name] of missing) {
    const src = vscode.Uri.joinPath(templateUri, name);
    const dest = vscode.Uri.joinPath(hooksDir, name);
    const content = await vscode.workspace.fs.readFile(src);
    await vscode.workspace.fs.writeFile(dest, content);
  }

  hideStatusBar();
  vscode.window.showInformationMessage(`Kiro Hooks Init: ${missing.length} hook(s) initialized ✓`);
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
