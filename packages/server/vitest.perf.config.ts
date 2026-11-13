// ── [PCODE-409 | S15 | v0.1.0] T36.4 Load and scale ──
// ── [PCODE-211 | S15 | v0.1.0] T18.3 Scale test (20 projects, 50 live users, under 1 s event-to-screen) and orq portfolio ──
//    Why:  the timing tests (event-to-screen latency, the command center at scale) measure the server, so
//          they run alone and one after the other: `npm run perf --workspace packages/server`.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (pkg: string): string =>
  fileURLToPath(new URL('../' + pkg + '/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@orqiva/shared': source('shared') } },
  test: {
    include: ['test/db/latency.test.ts', 'test/db/scale.test.ts', 'test/db/activityload.test.ts'], // [PCODE-409 | S15 | v0.1.0]
    environment: 'node',
    setupFiles: ['test/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 1_200_000,
    hookTimeout: 300_000,
  },
});
