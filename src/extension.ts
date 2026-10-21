import * as vscode from 'vscode';
import { DriftCache, registerTriggers } from './vscode/cache';
import { registerCodeActions } from './vscode/codeActions';
import { registerDecorations } from './vscode/decorations';
import { registerDiagnostics } from './vscode/diagnostics';
import { registerDiff } from './vscode/diffContentProvider';
import { DriftTree, registerDriftTree } from './vscode/driftTree';
import { Dismissals, registerDismissalCommands } from './vscode/dismissals';
import { registerHover } from './vscode/hover';
import { log } from './vscode/log';
import { registerStatusBar } from './vscode/statusBar';
import { registerWorkspaceScan } from './vscode/workspaceScan';

/** Returned from activate so integration tests can inspect results. */
export interface DriftApi {
  cache: DriftCache;
  tree: DriftTree;
}

export function activate(context: vscode.ExtensionContext): DriftApi {
  const dismissals = new Dismissals(context.workspaceState);
  const cache = new DriftCache(dismissals);
  context.subscriptions.push(log, dismissals, cache);

  registerDecorations(context, cache);
  registerHover(context, cache);
  registerCodeActions(context, cache);
  registerDiff(context);
  registerDismissalCommands(context, cache, dismissals);
  registerStatusBar(context, cache);
  registerDiagnostics(context, cache);
  const tree = registerDriftTree(context, cache);
  registerWorkspaceScan(context, cache);
  registerTriggers(context, cache);

  log.info('Project Drift activated');
  return { cache, tree };
}

export function deactivate(): void {}
