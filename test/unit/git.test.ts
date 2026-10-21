import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { blameFile } from '../../src/git/blame';
import { git } from '../../src/git/exec';
import { listFiles, showFile } from '../../src/git/files';
import { headSha, isShallow, repoRoot } from '../../src/git/repo';
import { makeRepo } from '../integration/helpers/makeRepo';

// The git layer is plain Node, so its Section 10 edge cases run against real repos here.
const repo = makeRepo();
repo.write('src/a.js', '// Adds.\nfunction add(a, b) {\n  return a + b;\n}\n');
repo.write('src/with space.js', '// Hi.\nhi();\n');
const first = repo.commit('Initial');
repo.edit('src/a.js', 'return a + b;', 'return a + b + 0;');
const second = repo.commit('Add zero');

const empty = makeRepo();
const notARepo = mkdtempSync(join(tmpdir(), 'drift-plain-'));

afterAll(() => {
  for (const dir of [repo.dir, empty.dir, notARepo]) rmSync(dir, { recursive: true, force: true });
});

const samePath = (a: string, b: string) =>
  realpathSync.native(resolve(a)).toLowerCase() === realpathSync.native(resolve(b)).toLowerCase();

describe('git exec', () => {
  it('returns stdout', async () => {
    expect(await git(repo.dir, ['rev-parse', '--is-inside-work-tree'])).toBe('true\n');
  });

  it('reports failures as typed errors with stderr', async () => {
    await expect(git(repo.dir, ['not-a-command'])).rejects.toMatchObject({
      name: 'GitError',
      kind: 'failed',
    });
  });

  it('reports a missing git binary as not-installed', async () => {
    const saved = process.env.PATH;
    process.env.PATH = '';
    try {
      await expect(git(repo.dir, ['--version'])).rejects.toMatchObject({ kind: 'not-installed' });
    } finally {
      process.env.PATH = saved;
    }
  });

  it('reports timeouts', async () => {
    // Waits on stdin forever, so the timeout always wins.
    await expect(git(repo.dir, ['hash-object', '--stdin'], 200)).rejects.toMatchObject({
      kind: 'timeout',
    });
  });
});

describe('git repo', () => {
  it('finds the repo root from a subdirectory', async () => {
    expect(samePath((await repoRoot(join(repo.dir, 'src')))!, repo.dir)).toBe(true);
  });

  it('spells the root the same way as the directory it was asked about', async () => {
    // On Windows, os.tmpdir() is often an 8.3 short path (C:\Users\ABCDEF~1\...), while
    // git reports the long one; mixing the two breaks repo-relative paths.
    expect(await repoRoot(join(repo.dir, 'src'))).toBe(resolve(repo.dir));
  });

  it('returns undefined outside a repo', async () => {
    expect(await repoRoot(notARepo)).toBeUndefined();
  });

  it('reads HEAD, or undefined before the first commit', async () => {
    expect(await headSha(repo.dir)).toBe(second);
    expect(await headSha(empty.dir)).toBeUndefined();
  });

  it('detects non-shallow repos', async () => {
    expect(await isShallow(repo.dir)).toBe(false);
  });
});

describe('git blame', () => {
  it('blames tracked files', async () => {
    const blame = await blameFile(repo.dir, 'src/a.js');
    expect(blame.map((b) => b.commit.sha)).toEqual([first, first, second, first]);
  });

  it('returns nothing for untracked files and empty repos', async () => {
    repo.write('src/new.js', '// New.\nnew();\n');
    expect(await blameFile(repo.dir, 'src/new.js')).toEqual([]);
    rmSync(join(repo.dir, 'src/new.js'));

    empty.write('a.js', '// A.\na();\n');
    expect(await blameFile(empty.dir, 'a.js')).toEqual([]);
  });

  it('honors .git-blame-ignore-revs', async () => {
    repo.write('.git-blame-ignore-revs', `${second}\n`);
    try {
      const blame = await blameFile(repo.dir, 'src/a.js');
      expect(blame[2]!.commit.sha).toBe(first);
    } finally {
      rmSync(join(repo.dir, '.git-blame-ignore-revs'));
    }
  });
});

describe('git files', () => {
  it('lists tracked files, including names with spaces', async () => {
    expect(await listFiles(repo.dir)).toEqual(['src/a.js', 'src/with space.js']);
    expect(await listFiles(join(repo.dir, 'src'))).toEqual(['a.js', 'with space.js']);
  });

  it('shows a file at a commit', async () => {
    expect(await showFile(repo.dir, first, 'src/a.js')).toContain('return a + b;\n');
  });
});
