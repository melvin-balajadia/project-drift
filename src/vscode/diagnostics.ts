import * as vscode from 'vscode';
import type { DriftCache } from './cache';
import { getConfig } from './config';

/** Mirrors drift into the Problems panel when projectDrift.showInProblems is on. */
export function registerDiagnostics(context: vscode.ExtensionContext, cache: DriftCache): void {
  const collection = vscode.languages.createDiagnosticCollection('projectDrift');

  const update = () => {
    collection.clear();
    if (!getConfig().showInProblems) return;
    for (const uri of cache.documents()) {
      collection.set(
        uri,
        cache.items(uri).map((item) => {
          const n = item.score;
          const diagnostic = new vscode.Diagnostic(
            new vscode.Range(
              item.comment.startLine,
              0,
              item.comment.endLine,
              Number.MAX_SAFE_INTEGER,
            ),
            `Possibly outdated comment: the code below changed in ${n} commit${n === 1 ? '' : 's'} since it was last updated.`,
            vscode.DiagnosticSeverity.Information,
          );
          diagnostic.source = 'Project Drift';
          return diagnostic;
        }),
      );
    }
  };

  context.subscriptions.push(
    collection,
    cache.onDidChange(update),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('projectDrift.showInProblems')) update();
    }),
  );
  update();
}
