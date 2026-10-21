import * as vscode from 'vscode';
import type { DriftCache } from './cache';
import { SHOW_DIFF } from './diffContentProvider';
import { MARK_ACCURATE } from './dismissals';
import { DOCUMENT_SELECTOR } from './hover';

const QUICK_FIX = vscode.CodeActionKind.QuickFix;

export function registerCodeActions(context: vscode.ExtensionContext, cache: DriftCache): void {
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      DOCUMENT_SELECTOR,
      {
        provideCodeActions(doc, range) {
          const item = cache.itemAt(doc.uri, range.start.line);
          if (!item) return [];
          const action = (title: string, command: string) => {
            const a = new vscode.CodeAction(title, QUICK_FIX);
            a.command = { title, command, arguments: [item] };
            return a;
          };
          return [
            action('Project Drift: Mark comment as still accurate', MARK_ACCURATE),
            action('Project Drift: Show changes since comment', SHOW_DIFF),
          ];
        },
      },
      { providedCodeActionKinds: [QUICK_FIX] },
    ),
  );
}
