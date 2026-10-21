import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface Repo {
  dir: string;
  git(...args: string[]): string;
  write(file: string, content: string): void;
  /** Replaces text in a file; throws if it isn't there, so tests fail loudly. */
  edit(file: string, from: string, to: string): void;
  /** Stages everything and commits. Returns the new sha. */
  commit(message: string): string;
}

/**
 * Creates a git repo (in a new temp dir unless `dir` is given) with deterministic
 * history: the nth commit is dated 2024-01-01 plus n days, by a fixed author.
 */
export function makeRepo(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-'))): Repo {
  fs.mkdirSync(dir, { recursive: true });
  const run = (args: string[], env: Record<string, string> = {}) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  run(['init', '-q', '-b', 'main']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'core.autocrlf', 'false']);
  run(['config', 'commit.gpgsign', 'false']);

  let day = 0;
  const repo: Repo = {
    dir,
    git: (...args) => run(args),
    write(file, content) {
      const full = path.join(dir, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    },
    edit(file, from, to) {
      const full = path.join(dir, file);
      const text = fs.readFileSync(full, 'utf8');
      if (!text.includes(from)) throw new Error(`${file}: text not found: ${from}`);
      fs.writeFileSync(full, text.replace(from, to));
    },
    commit(message) {
      const date = new Date(Date.UTC(2024, 0, 1 + day++)).toISOString();
      run(['add', '-A']);
      run(['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
      return run(['rev-parse', 'HEAD']);
    },
  };
  return repo;
}
