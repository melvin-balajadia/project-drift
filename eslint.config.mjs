import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'out/', 'coverage/', '.vscode-test/', 'demo-repo/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // The core must stay pure so it can be unit-tested without VS Code.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'vscode', message: 'src/core must not depend on vscode.' }] },
      ],
    },
  },
);
