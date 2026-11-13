// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-3 | S01 | v0.1.0] Add the vitest unit runner with a vscode API mock ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Why:  modules that import 'vscode' must load under vitest; the alias points them at the mock.
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    // vitest runs from the project root (npm scripts), so cwd-relative is stable and tsc-friendly
    alias: {
      vscode: resolve(process.cwd(), 'test/mocks/vscode.ts'),
      // [PCODE-105 | S15 | v0.1.0] the shared package from its TypeScript source, as in every package
      '@orqiva/shared': resolve(process.cwd(), '../shared/src/index.ts'),
    },
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/webviews/**/main.ts'],
      reporter: ['text', 'html'],
      reportsDirectory: 'out/coverage',
    },
  },
});
