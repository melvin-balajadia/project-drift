import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DriftItem } from '../core/types';
import { showFile } from '../git/files';
import { log, registerCommand } from './log';

export const SHOW_DIFF = 'projectDrift.showDiff';
const SCHEME = 'project-drift-git';

// URI shape: project-drift-git:/<repo-relative path>?{"root":...,"sha":...}
// The path keeps the file extension so the diff gets syntax highlighting.
export function registerDiff(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      provideTextDocumentContent(uri) {
        const { root, sha } = JSON.parse(uri.query) as { root: string; sha: string };
        return showFile(root, sha, uri.path.slice(1));
      },
    }),
    registerCommand(SHOW_DIFF, showDiff),
  );
}

/** Diffs the file as of the comment's last commit against the current file. */
async function showDiff(item?: DriftItem): Promise<void> {
  if (!item) return;
  const { repoRoot: root, file } = item;
  const sha = item.commentCommit.sha;
  const short = sha.slice(0, 7);

  try {
    await showFile(root, sha, file); // fail here, with a message, rather than in the diff editor
  } catch (error) {
    log.info(`Can't show ${file} at ${short}: ${String(error)}`);
    void vscode.window.showInformationMessage(
      `Project Drift: Can't show ${file} as of ${short}. It may have been renamed or moved since.`,
    );
    return;
  }

  const left = vscode.Uri.from({
    scheme: SCHEME,
    path: '/' + file,
    query: JSON.stringify({ root, sha }),
  });
  const right = vscode.Uri.file(path.join(root, file));
  await vscode.commands.executeCommand(
    'vscode.diff',
    left,
    right,
    `${file} (since ${short}) ↔ Current`,
  );
}
