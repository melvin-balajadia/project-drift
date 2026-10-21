import * as vscode from 'vscode';
import { SUPPORTED_LANGUAGES } from '../core/comments';
import { relativeTime } from '../core/format';
import type { DriftItem } from '../core/types';
import type { DriftCache } from './cache';
import { SHOW_DIFF } from './diffContentProvider';
import { MARK_ACCURATE } from './dismissals';

const MAX_COMMITS = 5;

export const DOCUMENT_SELECTOR = SUPPORTED_LANGUAGES.map((language) => ({
  language,
  scheme: 'file',
}));

/** Hover content, also used for tree item tooltips. */
export function driftMarkdown(item: DriftItem): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  // Only our two commands can run from links, even if a commit message contains one.
  md.isTrusted = { enabledCommands: [SHOW_DIFF, MARK_ACCURATE] };

  const n = item.score;
  const since = new Date(item.commentCommit.committerTime * 1000).toLocaleDateString();
  md.appendMarkdown('**Possibly outdated comment**\n\n');
  md.appendMarkdown(
    `The code below changed in ${n} commit${n === 1 ? '' : 's'} since this comment was last updated (${since}).\n\n`,
  );
  for (const c of item.newerCommits.slice(0, MAX_COMMITS)) {
    md.appendMarkdown(
      `- \`${c.sha.slice(0, 7)}\` ${escape(c.summary)} — ${escape(c.author)}, ${relativeTime(c.committerTime)}\n`,
    );
  }
  if (n > MAX_COMMITS) md.appendMarkdown(`- +${n - MAX_COMMITS} more\n`);

  md.appendMarkdown(
    `\n[Show changes since comment](${commandUri(SHOW_DIFF, item)}) · ` +
      `[Mark as still accurate](${commandUri(MARK_ACCURATE, item)})`,
  );
  return md;
}

// Commit messages are untrusted text; escape what can change rendering mid-line
// (emphasis, code, links/images, HTML). appendText would also turn spaces into &nbsp;.
function escape(text: string): string {
  return text.replace(/[\\`*_[\]<>~|]/g, '\\$&');
}

function commandUri(command: string, item: DriftItem): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify([item]))}`;
}

export function registerHover(context: vscode.ExtensionContext, cache: DriftCache): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(DOCUMENT_SELECTOR, {
      provideHover(doc, position) {
        const item = cache.itemAt(doc.uri, position.line);
        return item && new vscode.Hover(driftMarkdown(item));
      },
    }),
  );
}
