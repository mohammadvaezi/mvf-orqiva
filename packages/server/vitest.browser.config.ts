// ── [PCODE-366 | S15 | v0.1.0] T36.2 End-to-end journeys for every role in a real browser ──
//    Why:  the journeys in a real browser run on their own after the web app is built:
//          `npm run e2e --workspace packages/server`. Each file starts its own server and browser.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (pkg: string): string =>
  fileURLToPath(new URL('../' + pkg + '/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@orqiva/shared': source('shared') } },
  test: {
    include: ['test/browser/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup-env.ts'],
    maxWorkers: 2,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
