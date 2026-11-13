// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
//    Why:  one lint config for the platform packages; the extension keeps its own (packages/extension).
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  // [PCODE-223 | S15 | v0.1.0] dist-single: the built orq.mjs
  // [PCODE-226 | S15 | v0.1.0] the phone app has its own install and its own check (tsc, vitest)
  {
    ignores: [
      'packages/extension/**',
      'packages/mobile/**',
      '**/dist/**',
      '**/dist-single/**',
      '**/out/**',
      '**/node_modules/**',
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  // [PCODE-151 | S15 | v0.1.0] type declarations of plain build scripts are linted like the scripts
  { files: ['**/*.mjs', '**/*.d.mts'], ...tseslint.configs.disableTypeChecked },
  eslintConfigPrettier,
);
