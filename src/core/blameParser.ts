import type { BlameLine, CommitInfo } from './types';

const UNCOMMITTED_SHA = '0'.repeat(40);
const HEADER = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/;

/**
 * Parses `git blame --porcelain` output. The result is indexed by 0-based line
 * number, so `result[n]?.line === n`.
 *
 * Commit details appear only the first time a sha is seen, so they are cached
 * by sha and every line of the same commit shares one CommitInfo object.
 */
export function parseBlame(output: string): BlameLine[] {
  const commits = new Map<string, CommitInfo>();
  const result: BlameLine[] = [];
  let current: { commit: CommitInfo; line: number } | undefined;

  for (const raw of output.split('\n')) {
    if (raw.startsWith('\t')) {
      // Line content ends the group.
      if (current) {
        const { commit, line } = current;
        result[line] = { line, commit, uncommitted: commit.sha === UNCOMMITTED_SHA };
      }
      current = undefined;
      continue;
    }

    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const header = HEADER.exec(text);
    if (header) {
      const sha = header[1]!;
      let commit = commits.get(sha);
      if (!commit) {
        commit = { sha, committerTime: 0, author: '', summary: '' };
        commits.set(sha, commit);
      }
      current = { commit, line: Number(header[2]) - 1 };
      continue;
    }
    if (!current) continue;

    const space = text.indexOf(' ');
    const key = space === -1 ? text : text.slice(0, space);
    const value = space === -1 ? '' : text.slice(space + 1);
    if (key === 'committer-time') current.commit.committerTime = Number(value);
    else if (key === 'author') current.commit.author = value;
    else if (key === 'summary') current.commit.summary = value;
  }
  return result;
}
