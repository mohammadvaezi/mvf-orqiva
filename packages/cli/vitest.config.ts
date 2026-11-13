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
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
