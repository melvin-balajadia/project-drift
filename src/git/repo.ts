import { git, GitError } from './exec';

// ponytail: cached for the session, so a folder that becomes a repo later needs a reload.
const roots = new Map<string, Promise<string | undefined>>();

/** The repo root containing `dir`, or undefined if it isn't inside a git repo. */
export function repoRoot(dir: string): Promise<string | undefined> {
  let root = roots.get(dir);
  if (!root) {
    root = git(dir, ['rev-parse', '--show-toplevel']).then(
      (out) => out.trim(),
      (error: unknown) => {
        if (error instanceof GitError && error.kind === 'failed') return undefined;
        throw error;
      },
    );
    roots.set(dir, root);
  }
  return root;
}

export async function isShallow(root: string): Promise<boolean> {
  return (await git(root, ['rev-parse', '--is-shallow-repository'])).trim() === 'true';
}

/** HEAD's sha, or undefined in a repo with no commits yet. */
export async function headSha(root: string): Promise<string | undefined> {
  try {
    return (await git(root, ['rev-parse', 'HEAD'])).trim();
  } catch (error) {
    if (error instanceof GitError && error.kind === 'failed') return undefined;
    throw error;
  }
}
