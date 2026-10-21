import type { CommentBlock } from './types';

const SLASH = /^(\s*)\/\/+(.*)$/;
const HASH = /^(\s*)#+(.*)$/;

const MARKERS: Record<string, RegExp> = {
  javascript: SLASH,
  javascriptreact: SLASH,
  typescript: SLASH,
  typescriptreact: SLASH,
  python: HASH,
};

export const SUPPORTED_LANGUAGES = Object.keys(MARKERS);

// Matched against the comment body (marker stripped, trimmed).
const PRAGMA =
  /^(eslint-|@ts-(ignore|expect-error|nocheck|check)\b|prettier-ignore|(istanbul|c8) ignore|type:\s*ignore|noqa\b|pylint:|pragma:|fmt:\s*(off|on|skip)\b|<reference\b|#?(end)?region\b)/i;
const ENCODING = /coding[:=]\s*[-\w.]+/;
const LICENSE = /copyright|licen[cs]e/i;

function isDirective(index: number, line: string, body: string): boolean {
  if (index === 0 && line.startsWith('#!')) return true; // shebang
  if (index <= 1 && ENCODING.test(body)) return true; // PEP 263 encoding line
  return PRAGMA.test(body);
}

/**
 * Finds full-line comment blocks that are drift candidates. Consecutive comment
 * lines with the same indentation form one block. Pragmas, shebangs, encoding
 * lines, a license header, and blocks with no code after them are skipped.
 *
 * ponytail: line-based, so `//` or `#` lines inside multi-line strings are
 * treated as comments. Needs a tokenizer if that shows up in practice.
 */
export function detectComments(text: string, languageId: string): CommentBlock[] {
  const marker = MARKERS[languageId];
  if (!marker) return [];

  const blocks: CommentBlock[] = [];
  let firstCode = -1;
  let lastCode = -1;

  text.split(/\r?\n/).forEach((line, i) => {
    const match = marker.exec(line);
    if (!match) {
      const isShebang = i === 0 && line.startsWith('#!');
      if (line.trim() !== '' && !isShebang) {
        if (firstCode === -1) firstCode = i;
        lastCode = i;
      }
      return;
    }

    const indent = match[1]!.length;
    const body = match[2]!.trim();
    if (isDirective(i, line, body)) return;

    const prev = blocks.at(-1);
    if (prev && prev.endLine === i - 1 && prev.indent === indent) {
      prev.endLine = i;
      prev.text += '\n' + body;
    } else {
      blocks.push({ startLine: i, endLine: i, indent, text: body });
    }
  });

  return blocks.filter(
    (b) => b.endLine < lastCode && !(b.startLine < firstCode && LICENSE.test(b.text)),
  );
}
