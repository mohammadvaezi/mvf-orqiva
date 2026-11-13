// ── [PCODE-409 | S15 | v0.1.0] T36.4 Load and scale ──
// ── [PCODE-366 | S15 | v0.1.0] T36.2 End-to-end journeys for every role in a real browser ──
// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-211 | S15 | v0.1.0] T18.3 Scale test (20 projects, 50 live users, under 1 s event-to-screen) and orq portfolio ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
//    Why:  tests import workspace packages from their TypeScript source, so no package has to be built
//          before another one's tests run. An alias, because Vitest hands workspace packages to Node,
//          which never sees a custom export condition.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (pkg: string): string =>
  fileURLToPath(new URL('../' + pkg + '/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@orqiva/shared': source('shared') } },
  test: {
    include: ['test/**/*.test.ts'],
    // [PCODE-211 | S15 | v0.1.0] the timing tests run on their own (vitest.perf.config.ts): beside 70
    // other files their numbers say more about the machine than about the server
    // [PCODE-366 | S15 | v0.1.0] and the browser journeys run with npm run e2e
    exclude: [
      'test/db/latency.test.ts',
      'test/db/scale.test.ts',
      'test/db/activityload.test.ts', // [PCODE-409 | S15 | v0.1.0]
      'test/browser/**',
      'node_modules/**',
    ],
    environment: 'node',
    setupFiles: ['test/setup-env.ts'],
    // [PCODE-365 | S15 | v0.1.0] starting and stopping a server with its database takes longer than
    // 10 s now and then when the whole suite runs at once
    hookTimeout: 30_000,
  },
});
