import { execFile } from 'node:child_process';

export type GitErrorKind = 'not-installed' | 'timeout' | 'failed';

export class GitError extends Error {
  constructor(
    message: string,
    readonly kind: GitErrorKind,
    readonly stderr = '',
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/** Runs git with an argument array (never a shell string), so paths can't inject commands. */
export function git(cwd: string, args: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout, maxBuffer: 50 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const command = `git ${args[0] ?? ''}`;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new GitError('git is not installed or not on PATH', 'not-installed'));
        } else if (error.killed) {
          reject(new GitError(`${command} timed out after ${timeout} ms`, 'timeout'));
        } else {
          reject(
            new GitError(`${command} failed: ${stderr.trim() || error.message}`, 'failed', stderr),
          );
        }
      },
    );
  });
}
