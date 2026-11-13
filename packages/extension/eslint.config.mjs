// ── [PCODE-1 | S01 | v0.1.0] Scaffold the extension repo: manifest, esbuild bundle, tsconfig, lint and format ──
//    Why:  typescript-eslint strict; the floating-promise and any rules are the ones that catch real bugs in an extension.
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'out/**',
      'node_modules/**',
      'test/fixtures/**',
      '.vscode-test/**',
      '*.vsix',
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // ── [PCODE-62 | S12 | v0.1.0] every error the user sees goes through showError ──
      //    A bare showErrorMessage(String(e)) shows a stack trace and no next step, and it cannot take
      //    part in the 30-second deduplication - a dead network then stacks identical toasts.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='showErrorMessage']",
          message:
            'Use showError(action, err, log) from src/commands/notify.ts instead of window.showErrorMessage.',
        },
      ],
    },
  },
  // the one module allowed to raise the notification, and the tests that assert what it does
  {
    files: ['src/commands/notify.ts', 'test/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  { files: ['**/*.mjs'], ...tseslint.configs.disableTypeChecked },
  eslintConfigPrettier,
);
