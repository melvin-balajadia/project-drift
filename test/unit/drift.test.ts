import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBlame } from '../../src/core/blameParser';
import { detectComments } from '../../src/core/comments';
import { scoreDrift, severityFor } from '../../src/core/drift';
import { heuristicScope } from '../../src/core/scope';
import type { BlameLine, CommentBlock, CommitInfo, Scope } from '../../src/core/types';

const commit = (sha: string, committerTime: number): CommitInfo => ({
  sha,
  committerTime,
  author: 'a',
  summary: sha,
});
const line = (c: CommitInfo, uncommitted = false) => ({ commit: c, uncommitted });
const blameOf = (...lines: { commit: CommitInfo; uncommitted: boolean }[]): BlameLine[] =>
  lines.map((l, i) => ({ line: i, ...l }));

const c1 = commit('c1', 100);
const c2 = commit('c2', 200);
const c3 = commit('c3', 300);
const c4 = commit('c4', 400);
const wip = commit('0'.repeat(40), 999);

// Comment on line 0, scope on lines 1..n.
const comment: CommentBlock = { startLine: 0, endLine: 0, indent: 0, text: 'x' };
const scopeTo = (endLine: number): Scope => ({ startLine: 1, endLine, source: 'heuristic' });

describe('severityFor', () => {
  it.each([
    [1, undefined],
    [2, 'low'],
    [3, 'low'],
    [4, 'medium'],
    [7, 'medium'],
    [8, 'high'],
    [20, 'high'],
  ])('score %i with threshold 2 -> %s', (score, expected) => {
    expect(severityFor(score, 2)).toBe(expected);
  });
});

describe('scoreDrift', () => {
  it('flags only when the score reaches the threshold', () => {
    const blame = blameOf(line(c1), line(c2), line(c3));
    expect(scoreDrift(blame, comment, scopeTo(1), 2)).toBeUndefined();
    expect(scoreDrift(blame, comment, scopeTo(2), 2)).toMatchObject({ score: 2, severity: 'low' });
  });

  it('counts each commit once and sorts newest first', () => {
    const blame = blameOf(line(c1), line(c2), line(c3), line(c2), line(c3));
    expect(scoreDrift(blame, comment, scopeTo(4), 1)).toEqual({
      commentCommit: c1,
      newerCommits: [c3, c2],
      score: 2,
      severity: 'medium',
    });
  });

  it('does not count commits at or before the comment time', () => {
    const same = commit('same', 100);
    const blame = blameOf(line(c1), line(same), line(commit('old', 50)), line(c2));
    expect(scoreDrift(blame, comment, scopeTo(3), 1)).toMatchObject({ newerCommits: [c2] });
  });

  it('uses the newest comment line as the comment time', () => {
    const twoLine: CommentBlock = { ...comment, endLine: 1 };
    const blame = blameOf(line(c1), line(c3), line(c2), line(c4));
    const scope: Scope = { startLine: 2, endLine: 3, source: 'heuristic' };
    expect(scoreDrift(blame, twoLine, scope, 1)).toMatchObject({
      commentCommit: c3,
      newerCommits: [c4],
    });
  });

  it('skips the block when a comment line is uncommitted', () => {
    const blame = blameOf(line(wip, true), line(c2), line(c3));
    expect(scoreDrift(blame, comment, scopeTo(2), 1)).toBeUndefined();
  });

  it('never counts uncommitted scope lines', () => {
    const blame = blameOf(line(c1), line(wip, true), line(c2));
    expect(scoreDrift(blame, comment, scopeTo(2), 1)).toMatchObject({ score: 1 });
    expect(scoreDrift(blame, comment, scopeTo(2), 2)).toBeUndefined();
  });

  it('skips the block when blame is missing for a comment line', () => {
    expect(scoreDrift([], comment, scopeTo(2), 1)).toBeUndefined();
  });

  it('scores real git output end to end', () => {
    // math.js: "// Greets a user." (line 5) predates two commits to greet();
    // "// Adds two numbers." (line 0) only has an uncommitted change below it.
    const blame = parseBlame(readFileSync(join(__dirname, 'fixtures', 'math.porcelain'), 'utf8'));
    const lines = [
      '// Adds two numbers.',
      'function add(a, b) {',
      '  return a + b + 0;',
      '}',
      '',
      '// Greets a user.',
      "function greet(name = 'world') {",
      '  return `Hello ${name}`;',
      '}',
    ];
    expect(blame).toHaveLength(lines.length);

    const results = detectComments(lines.join('\n'), 'javascript').map((c) =>
      scoreDrift(blame, c, heuristicScope(lines, c, 20)!, 2),
    );
    expect(results[0]).toBeUndefined();
    expect(results[1]).toMatchObject({
      score: 2,
      severity: 'low',
      commentCommit: { summary: 'Initial commit' },
      newerCommits: [{ summary: 'Default greet name' }, { summary: 'Use template literal' }],
    });
  });
});
