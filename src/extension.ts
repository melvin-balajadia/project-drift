import * as vscode from 'vscode';
import { analyzeDocument } from './vscode/analyzer';
import { log } from './vscode/log';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    log,
    vscode.commands.registerCommand('projectDrift.devAnalyze', devAnalyze),
  );
  log.info('Project Drift activated');
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
    const items = await analyzeDocument(doc);
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
