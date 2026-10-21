import * as vscode from 'vscode';
import type { DriftCache } from './cache';
import { registerCommand } from './log';

const STATE_KEY = 'projectDrift.decorationsEnabled';

export function registerDecorations(context: vscode.ExtensionContext, cache: DriftCache): void {
  const type = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('projectDrift.driftBackground'),
    gutterIconPath: context.asAbsolutePath('media/gutter.svg'),
    gutterIconSize: 'contain',
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.warningForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  let enabled = context.workspaceState.get(STATE_KEY, true);

  const update = () => {
    for (const editor of vscode.window.visibleTextEditors) {
      const ranges = enabled
        ? cache
            .items(editor.document.uri)
            .map((i) => new vscode.Range(i.comment.startLine, 0, i.comment.endLine, 0))
        : [];
      editor.setDecorations(type, ranges);
    }
  };

  context.subscriptions.push(
    type,
    cache.onDidChange(update),
    vscode.window.onDidChangeVisibleTextEditors(update),
    registerCommand('projectDrift.toggleDecorations', async () => {
      enabled = !enabled;
      update();
      await context.workspaceState.update(STATE_KEY, enabled);
    }),
  );
  update();
}
