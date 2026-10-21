import * as vscode from 'vscode';
import type { DriftCache } from './cache';

export function registerStatusBar(context: vscode.ExtensionContext, cache: DriftCache): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.name = 'Project Drift';

  const update = () => {
    const editor = vscode.window.activeTextEditor;
    const n = editor ? cache.items(editor.document.uri).length : 0;
    if (n === 0) {
      item.hide();
      return;
    }
    item.text = `$(history) Drift: ${n}`;
    item.tooltip = `${n} possibly outdated comment${n === 1 ? '' : 's'} in this file`;
    item.show();
  };

  context.subscriptions.push(
    item,
    cache.onDidChange(update),
    vscode.window.onDidChangeActiveTextEditor(update),
  );
  update();
}
