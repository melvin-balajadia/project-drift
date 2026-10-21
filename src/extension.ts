import * as vscode from 'vscode';
import { analyzeDocument, resolveFile } from './vscode/analyzer';
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
  context.subscriptions.push(
    log,
    dismissals,
    cache,
    vscode.commands.registerCommand('projectDrift.devAnalyze', devAnalyze),
  );

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

// ponytail: temporary dev command, removed in Phase 5.
async function devAnalyze(): Promise<void> {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc) {
    log.info('No active editor.');
    return;
  }
  try {
    const file = await resolveFile(doc);
    const items = file ? await analyzeDocument(doc, file) : [];
    log.info(`${vscode.workspace.asRelativePath(doc.uri)}: ${items.length} drifted comment(s)`);
    for (const item of items) {
      const { comment, scope } = item;
      log.info(
        `  L${comment.startLine + 1} ${item.severity} (score ${item.score}, ${scope.source} scope ` +
          `L${scope.startLine + 1}-${scope.endLine + 1}): ${comment.text.split('\n')[0]}`,
      );
      for (const c of item.newerCommits) {
        log.info(`    ${c.sha.slice(0, 7)} ${c.summary} (${c.author})`);
      }
    }
  } catch (error) {
    log.error(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  log.show(true);
}
