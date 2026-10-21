// Generates demo-repo/: a git repo with fresh and drifted comments across JS, TS,
// and Python, with deterministic dates. Used for manual testing and the README GIF.
//
// Expected results with the default threshold (2):
//   src/cart.js   cartTotal      drifted, low    (3 newer commits)
//                 applyDiscount  fresh           (1 newer commit, below threshold)
//   src/user.ts   formatName     drifted, medium (4 newer commits)
//                 isAdult        fresh           (comment updated with the code)
//   app/utils.py  retry          drifted, high   (8 newer commits)
//                 to_fahrenheit  fresh           (never changed)

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../demo-repo', import.meta.url));
rmSync(root, { recursive: true, force: true });
mkdirSync(root);

const git = (args, env = {}) =>
  execFileSync('git', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'pipe' });
git(['init', '-q', '-b', 'main']);
git(['config', 'user.email', 'demo@example.com']);
git(['config', 'core.autocrlf', 'false']);

let day = 0;
function commit(author, message) {
  const date = new Date(Date.UTC(2024, 0, 5 + day++ * 3)).toISOString();
  git(['add', '-A']);
  git(['-c', `user.name=${author}`, 'commit', '-q', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

function write(file, lines) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join('\n') + '\n');
}

function edit(file, from, to) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  if (!text.includes(from)) throw new Error(`${file}: text not found: ${from}`);
  writeFileSync(path, text.replace(from, to));
}

// --- Initial versions -------------------------------------------------------

write('src/cart.js', [
  '// Returns the total price of all items in the cart.',
  'function cartTotal(items) {',
  '  return items.reduce((sum, item) => sum + item.price, 0);',
  '}',
  '',
  '// Applies a percentage discount to a price.',
  'function applyDiscount(price, percent) {',
  '  return price - price * (percent / 100);',
  '}',
  '',
  'module.exports = { cartTotal, applyDiscount };',
]);
commit('Alice', 'Add cart helpers');

write('src/user.ts', [
  'export interface User {',
  '  first: string;',
  '  middle?: string;',
  '  last: string;',
  '  age: number;',
  '}',
  '',
  '// Formats a user\'s full name as "First Last".',
  'export function formatName(user: User): string {',
  '  return `${user.first} ${user.last}`;',
  '}',
  '',
  '// Checks whether the user is an adult (18+).',
  'export function isAdult(user: User): boolean {',
  '  return user.age >= 18;',
  '}',
]);
commit('Alice', 'Add user helpers');

write('app/utils.py', [
  'import time',
  '',
  '',
  '# Retries the call up to 3 times, waiting 1 second between attempts.',
  'def retry(fn):',
  '    for attempt in range(3):',
  '        try:',
  '            return fn()',
  '        except Exception:',
  '            time.sleep(1)',
  '    raise RuntimeError("retry failed")',
  '',
  '',
  '# Converts Celsius to Fahrenheit.',
  'def to_fahrenheit(celsius):',
  '    return celsius * 9 / 5 + 32',
]);
commit('Alice', 'Add retry and temperature helpers');

// --- History ----------------------------------------------------------------
// Each edit touches a different line, so git blame keeps every commit visible.

edit('src/cart.js', 'function cartTotal(items) {', 'function cartTotal(items, taxRate = 0) {');
commit('Bob', 'Support tax rate in cart total');

edit('app/utils.py', 'def retry(fn):', 'def retry(fn, attempts=5):');
commit('Carol', 'Make retry attempts configurable');

edit(
  'src/user.ts',
  '  return `${user.first} ${user.last}`;',
  "  const middle = user.middle ? ` ${user.middle}` : '';\n  return `${user.first}${middle} ${user.last}`;",
);
commit('Bob', 'Include middle names');

edit('app/utils.py', 'for attempt in range(3):', 'for attempt in range(attempts):');
commit('Carol', 'Use attempts in retry loop');

edit(
  'src/cart.js',
  'sum + item.price, 0);',
  'sum + item.price * item.quantity, 0) * (1 + taxRate);',
);
commit('Carol', 'Account for quantity and tax');

edit('src/cart.js', '(percent / 100);', '(Math.min(percent, 100) / 100);');
commit('Dave', 'Clamp discount percent');

edit('app/utils.py', 'return fn()', 'return fn(*args, **kwargs)');
commit('Dave', 'Pass arguments through retry');

edit(
  'src/user.ts',
  '  return `${user.first}${middle} ${user.last}`;',
  '  const full = `${user.first}${middle} ${user.last}`;\n  return full.trim();',
);
commit('Carol', 'Trim formatted names');

edit('app/utils.py', 'except Exception:', 'except (TimeoutError, ConnectionError) as error:');
commit('Bob', 'Only retry network errors');

edit(
  'src/cart.js',
  'function cartTotal(items, taxRate = 0) {',
  'function cartTotal(items, taxRate = 0) {\n  if (items.length === 0) return 0;',
);
commit('Bob', 'Short-circuit empty carts');

edit('app/utils.py', 'time.sleep(1)', 'time.sleep(2 ** attempt)');
commit('Dave', 'Exponential backoff in retry');

edit(
  'src/user.ts',
  'export function formatName(user: User): string {',
  "export function formatName(user: User | null): string {\n  if (!user) return '';",
);
commit('Dave', 'Accept null users in formatName');

edit('app/utils.py', 'def retry(fn, attempts=5):', 'def retry(fn, *args, attempts=5, **kwargs):');
commit('Bob', 'Retry with arguments');

edit(
  'src/user.ts',
  '  const full = `${user.first}${middle} ${user.last}`;',
  '  const full = `${user.last}, ${user.first}${middle}`;',
);
commit('Bob', 'Sort-friendly name format');

edit(
  'src/user.ts',
  [
    '// Checks whether the user is an adult (18+).',
    'export function isAdult(user: User): boolean {',
    '  return user.age >= 18;',
  ].join('\n'),
  [
    '// Checks whether the user is at least `minAge` years old.',
    'export function isAdult(user: User, minAge = 18): boolean {',
    '  return user.age >= minAge;',
  ].join('\n'),
);
commit('Carol', 'Make adult age configurable');

edit(
  'app/utils.py',
  '    for attempt in range(attempts):',
  '    last_error = None\n    for attempt in range(attempts):',
);
commit('Alice', 'Track last retry error');

edit(
  'app/utils.py',
  '        except (TimeoutError, ConnectionError) as error:',
  '        except (TimeoutError, ConnectionError) as error:\n            last_error = error',
);
commit('Carol', 'Remember retry error');

edit(
  'app/utils.py',
  'raise RuntimeError("retry failed")',
  'raise RuntimeError(f"retry failed after {attempts} attempts") from last_error',
);
commit('Dave', 'Chain retry error');

console.log(`Demo repo created at ${root} (${day} commits)`);
