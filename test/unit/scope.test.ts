import { describe, expect, it } from 'vitest';
import { heuristicScope, selectSymbolScope } from '../../src/core/scope';
import type { CommentBlock } from '../../src/core/types';

const comment = (endLine: number, indent = 0): CommentBlock => ({
  startLine: endLine,
  endLine,
  indent,
  text: 'x',
});

describe('selectSymbolScope', () => {
  it('selects a symbol right after the comment', () => {
    expect(selectSymbolScope([{ startLine: 1, endLine: 5 }], comment(0), 20)).toEqual({
      startLine: 1,
      endLine: 5,
      source: 'symbol',
    });
  });

  it('allows up to two lines in between (decorators)', () => {
    expect(selectSymbolScope([{ startLine: 3, endLine: 5 }], comment(0), 20)).toBeDefined();
    expect(selectSymbolScope([{ startLine: 4, endLine: 5 }], comment(0), 20)).toBeUndefined();
  });

  it('ignores symbols that start at or before the comment', () => {
    const symbols = [
      { startLine: 0, endLine: 9 },
      { startLine: 2, endLine: 9 },
    ];
    expect(selectSymbolScope(symbols, comment(2), 20)).toBeUndefined();
  });

  it('prefers the nearest symbol, then the outer one on a tie', () => {
    const symbols = [
      { startLine: 3, endLine: 4 },
      { startLine: 2, endLine: 3 },
      { startLine: 2, endLine: 8 },
    ];
    expect(selectSymbolScope(symbols, comment(1), 20)).toMatchObject({
      startLine: 2,
      endLine: 8,
    });
  });

  it('caps the scope at maxScopeLines', () => {
    expect(selectSymbolScope([{ startLine: 1, endLine: 100 }], comment(0), 20)).toMatchObject({
      startLine: 1,
      endLine: 20,
    });
  });
});

describe('heuristicScope', () => {
  it('takes lines until a blank line', () => {
    const lines = ['// c', 'function f() {', '  return 1;', '}', '', 'g();'];
    expect(heuristicScope(lines, comment(0), 20)).toEqual({
      startLine: 1,
      endLine: 3,
      source: 'heuristic',
    });
  });

  it('skips blank lines between the comment and the code', () => {
    expect(heuristicScope(['// c', '', 'x();'], comment(0), 20)).toMatchObject({
      startLine: 2,
      endLine: 2,
    });
  });

  it('stops at a line indented less than the comment', () => {
    const lines = ['  // c', '  x();', '  y();', '}', 'z();'];
    expect(heuristicScope(lines, comment(0, 2), 20)).toMatchObject({ startLine: 1, endLine: 2 });
  });

  it('caps at maxScopeLines', () => {
    const lines = ['// c', 'a();', 'b();', 'c();', 'd();'];
    expect(heuristicScope(lines, comment(0), 2)).toMatchObject({ startLine: 1, endLine: 2 });
  });

  it('returns undefined when no code follows', () => {
    expect(heuristicScope(['  // c', '}'], comment(0, 2), 20)).toBeUndefined();
    expect(heuristicScope(['// c', ''], comment(0), 20)).toBeUndefined();
  });
});
