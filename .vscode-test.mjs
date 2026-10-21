import { mkdirSync, rmSync } from 'node:fs';
import { defineConfig } from '@vscode/test-cli';

// Start every run clean: an empty workspace folder (the tests turn it into a git
// repo) and fresh user data, so workspaceState such as dismissals can't leak
// between runs. Deterministic test repos produce the same shas every time.
const workspaceFolder = '.vscode-test/workspace';
for (const dir of [workspaceFolder, '.vscode-test/user-data']) {
  rmSync(dir, { recursive: true, force: true });
}
mkdirSync(workspaceFolder, { recursive: true });

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  workspaceFolder,
  mocha: { timeout: 20_000 },
});
