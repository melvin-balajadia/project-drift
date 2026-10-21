import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseBlame } from '../core/blameParser';
import type { BlameLine } from '../core/types';
import { git, GitError } from './exec';

/**
 * Blames a file. `relativePath` is repo-relative with forward slashes. Returns []
 * for files git doesn't know about yet (untracked, or a repo with no commits).
 */
export async function blameFile(root: string, relativePath: string): Promise<BlameLine[]> {
  const args = ['blame', '--porcelain', '-w'];
  // git errors if --ignore-revs-file points at a missing file, so only pass it when present.
  const ignoreRevs = join(root, '.git-blame-ignore-revs');
  if (existsSync(ignoreRevs)) args.push('--ignore-revs-file', ignoreRevs);
  args.push('--', relativePath);
  try {
    return parseBlame(await git(root, args));
  } catch (error) {
    if (error instanceof GitError && /no such path|no such ref/.test(error.stderr)) return [];
    throw error;
  }
}
