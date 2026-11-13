// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
//    Why:  the app's logic without React Native: the client and the feed rows run in Node.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
