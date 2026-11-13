// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  the extension's logic is tested in Node: it is written against small interfaces, not the
//          browser's own objects.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
