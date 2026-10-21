import type { CommentBlock, Scope } from './types';

/** A plain line range, so callers can pass flattened document symbols without `vscode` types. */
export interface LineRange {
  startLine: number;
  endLine: number;
}

/** Lines allowed between a comment and its symbol, e.g. decorators or a blank line. */
const MAX_SYMBOL_GAP = 2;

/**
 * Picks the symbol the comment documents: the nearest one starting within
 * MAX_SYMBOL_GAP lines after the comment. On a tie, the larger (outer) symbol wins.
 */
export function selectSymbolScope(
  symbols: readonly LineRange[],
  comment: CommentBlock,
  maxScopeLines: number,
): Scope | undefined {
  let best: LineRange | undefined;
  for (const s of symbols) {
    const gap = s.startLine - comment.endLine - 1;
    if (gap < 0 || gap > MAX_SYMBOL_GAP) continue;
    if (
      !best ||
      s.startLine < best.startLine ||
      (s.startLine === best.startLine && s.endLine > best.endLine)
    ) {
      best = s;
    }
  }
  if (!best) return undefined;
  return {
    startLine: best.startLine,
    endLine: Math.min(best.endLine, best.startLine + maxScopeLines - 1),
    source: 'symbol',
  };
}

/**
 * Fallback scope: from the first non-blank line after the comment, take lines
 * until a blank line, a line indented less than the comment, or the cap.
 */
export function heuristicScope(
  lines: readonly string[],
  comment: CommentBlock,
  maxScopeLines: number,
): Scope | undefined {
  let start = comment.endLine + 1;
  while (start < lines.length && lines[start]!.trim() === '') start++;

  let end = start - 1;
  for (let i = start; i < lines.length && i - start < maxScopeLines; i++) {
    const line = lines[i]!;
    if (line.trim() === '' || line.length - line.trimStart().length < comment.indent) break;
    end = i;
  }
  return end >= start ? { startLine: start, endLine: end, source: 'heuristic' } : undefined;
}
