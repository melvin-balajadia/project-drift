import * as vscode from 'vscode';
import type { DriftItem } from '../core/types';
import type { DriftCache } from './cache';

export const MARK_ACCURATE = 'projectDrift.markAccurate';
const STATE_KEY = 'projectDrift.dismissals';

/**
 * Dismissal keys in workspaceState.
 *
 * ponytail: keys are never pruned, so stale ones accumulate (a few bytes each).
 * Prune against the cache if that ever matters.
 */
export class Dismissals implements vscode.Disposable {
  private readonly ids: Set<string>;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly state: vscode.Memento) {
    this.ids = new Set(state.get<string[]>(STATE_KEY, []));
  }

  get size(): number {
    return this.ids.size;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  async add(id: string): Promise<void> {
    this.ids.add(id);
    this.changed.fire();
    await this.state.update(STATE_KEY, [...this.ids]);
  }

  async clear(): Promise<void> {
    this.ids.clear();
    this.changed.fire();
    await this.state.update(STATE_KEY, []);
  }

  dispose(): void {
    this.changed.dispose();
  }
}

export function registerDismissalCommands(
  context: vscode.ExtensionContext,
  cache: DriftCache,
  dismissals: Dismissals,
): void {
  context.subscriptions.push(
    // Called with an item from hovers, code actions, and the tree; without one from the palette.
    vscode.commands.registerCommand(MARK_ACCURATE, async (item?: DriftItem) => {
      const editor = vscode.window.activeTextEditor;
      item ??= editor && cache.itemAt(editor.document.uri, editor.selection.active.line);
      if (!item) {
        void vscode.window.showInformationMessage(
          'Project Drift: No drifted comment at the cursor.',
        );
        return;
      }
      await dismissals.add(item.id);
    }),

    vscode.commands.registerCommand('projectDrift.clearDismissals', async () => {
      if (dismissals.size === 0) {
        void vscode.window.showInformationMessage(
          'Project Drift: There are no dismissals to clear.',
        );
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        `Clear ${dismissals.size} dismissal(s)? Those comments will be flagged again if they are still drifted.`,
        { modal: true },
        'Clear',
      );
      if (choice === 'Clear') await dismissals.clear();
    }),
  );
}
