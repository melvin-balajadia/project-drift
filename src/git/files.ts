import { git } from './exec';

/** Tracked files under `dir`, relative to it, with forward slashes. */
export async function listFiles(dir: string): Promise<string[]> {
  return (await git(dir, ['ls-files', '-z'])).split('\0').filter(Boolean);
}

/** A file's content at a commit. */
export function showFile(root: string, sha: string, relativePath: string): Promise<string> {
  return git(root, ['show', `${sha}:${relativePath}`]);
}
