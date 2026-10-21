import * as path from 'node:path';
import * as vscode from 'vscode';
import { detectComments, SUPPORTED_LANGUAGES } from '../core/comments';
import { dismissalKey } from '../core/dismissalKey';
import { scoreDrift } from '../core/drift';
import { heuristicScope, type LineRange, selectSymbolScope } from '../core/scope';
import type { DriftItem } from '../core/types';
import { blameFile } from '../git/blame';
import { repoRoot } from '../git/repo';
import { getConfig } from './config';

const SYMBOL_TIMEOUT_MS = 1500;

/** Finds drifted comments in a saved document. Throws on git errors; callers log them. */
export async function analyzeDocument(
  doc: vscode.TextDocument,
  isDismissed: (id: string) => boolean = () => false,
): Promise<DriftItem[]> {
  if (doc.uri.scheme !== 'file' || !SUPPORTED_LANGUAGES.includes(doc.languageId)) return [];

  const text = doc.getText();
  const comments = detectComments(text, doc.languageId);
  if (comments.length === 0) return [];

  const root = await repoRoot(path.dirname(doc.uri.fsPath));
  if (!root) return [];
  const file = path.relative(root, doc.uri.fsPath).split(path.sep).join('/');

  const [blame, symbols] = await Promise.all([blameFile(root, file), documentSymbols(doc)]);
  const lines = text.split(/\r?\n/);
  const { threshold, maxScopeLines } = getConfig(doc.uri);

  const items: DriftItem[] = [];
  for (const comment of comments) {
    const scope =
      selectSymbolScope(symbols, comment, maxScopeLines) ??
      heuristicScope(lines, comment, maxScopeLines);
    if (!scope) continue;
    const drift = scoreDrift(blame, comment, scope, threshold);
    if (!drift) continue;
    const id = dismissalKey(file, comment.text, drift.newerCommits[0]!.sha);
    if (isDismissed(id)) continue;
    items.push({ id, file, repoRoot: root, comment, scope, ...drift });
  }
  return items;
}

/** Flattened symbol ranges, or [] if no provider answers in time (then the heuristic is used). */
async function documentSymbols(doc: vscode.TextDocument): Promise<LineRange[]> {
  const request = vscode.commands.executeCommand<
    (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined
  >('vscode.executeDocumentSymbolProvider', doc.uri);
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), SYMBOL_TIMEOUT_MS),
  );
  const symbols = await Promise.race([Promise.resolve(request).catch(() => undefined), timeout]);

  const ranges: LineRange[] = [];
  const walk = (s: vscode.DocumentSymbol | vscode.SymbolInformation): void => {
    const range = 'children' in s ? s.range : s.location.range;
    ranges.push({ startLine: range.start.line, endLine: range.end.line });
    if ('children' in s) s.children.forEach(walk);
  };
  symbols?.forEach(walk);
  return ranges;
}
