// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-195 | S15 | v0.1.0] B8.3 CLI parity: inbox, approvals, comments, time, agents and ideas from the terminal, offline queue ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-90 | S15 | v0.1.0] Build the web app shell with login and the ported design system ──
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { listenFetchable } from './ports.js'; // [PCODE-365 | S15 | v0.1.0]

const dir = mkdtempSync(join(tmpdir(), 'pe-web-'));
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Orqiva</title>');
writeFileSync(join(dir, 'main.js'), 'console.log(1)');
mkdirSync(join(dir, 'sub'));
writeFileSync(join(tmpdir(), 'pe-secret.txt'), 'outside the web folder');

const app = createApp({ webDir: dir, checkResponses: true });
let base = '';

beforeAll(async () => {
  await listenFetchable(app.server); // [PCODE-365 | S15 | v0.1.0]
  base = 'http://127.0.0.1:' + String((app.server.address() as AddressInfo).port);
});
afterAll(async () => {
  await app.close(100);
});

describe('web app delivery', () => {
  it('serves files with their type and the security headers', async () => {
    const res = await fetch(base + '/main.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('answers app routes with index.html, which always revalidates', async () => {
    for (const path of ['/', '/login', '/signup']) {
      const res = await fetch(base + path);
      expect(await res.text(), path).toContain('<title>Orqiva</title>');
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('keeps API routes and 404s for missing assets', async () => {
    expect((await fetch(base + '/health')).headers.get('content-type')).toContain(
      'application/json',
    );
    expect((await fetch(base + '/missing.js')).status).toBe(404);
  });

  // [PCODE-195 | S15 | v0.1.0] an older server must say it lacks a route, not hand the CLI the app
  it('answers an API path it does not have with a JSON 404', async () => {
    for (const path of ['/api/workspaces/x/nope', '/api', '/internal/nope', '/auth/nope']) {
      const res = await fetch(base + path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('content-type'), path).toContain('application/json');
    }
  });

  it('never serves a file from outside the web folder', async () => {
    for (const path of [
      '/../pe-secret.txt',
      '/%2e%2e/pe-secret.txt',
      '/sub/..%2f..%2fpe-secret.txt',
    ]) {
      const text = await (await fetch(base + path)).text();
      expect(text, path).not.toContain('outside the web folder');
    }
  });
});
