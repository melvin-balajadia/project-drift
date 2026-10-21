import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBlame } from '../../src/core/blameParser';

const fixture = readFileSync(join(__dirname, 'fixtures', 'math.porcelain'), 'utf8');

describe('parseBlame', () => {
  const blame = parseBlame(fixture);

  it('returns one entry per line, indexed by line number', () => {
    expect(blame).toHaveLength(9);
    blame.forEach((b, i) => expect(b.line).toBe(i));
  });

  it('reads commit info, including on boundary commits', () => {
    expect(blame[0]!.commit).toEqual({
      sha: '841176ae9f5325d2442f3dde8eb10532d8c6d2c3',
      committerTime: 1704067200,
      author: 'Alice',
      summary: 'Initial commit',
    });
    expect(blame[6]!.commit).toMatchObject({
      author: 'Bob',
      committerTime: 1709251200,
      summary: 'Default greet name',
    });
  });

  it('reuses commit info for shas seen earlier', () => {
    expect(blame[8]!.commit).toBe(blame[0]!.commit);
    expect(blame[8]!.commit.summary).toBe('Initial commit');
  });

  it('marks uncommitted lines', () => {
    expect(blame.map((b) => b.uncommitted)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('handles CRLF output', () => {
    expect(parseBlame(fixture.replace(/\n/g, '\r\n'))).toEqual(blame);
  });

  it('handles empty output', () => {
    expect(parseBlame('')).toEqual([]);
  });
});
