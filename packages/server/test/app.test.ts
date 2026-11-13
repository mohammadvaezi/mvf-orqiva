// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
// ── [PCODE-86 | S15 | v0.1.0] Write the HTTP server on Node built-ins: router, validation, error model, OpenAPI ──
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { listenFetchable } from './ports.js'; // [PCODE-365 | S15 | v0.1.0]

const app = createApp({ checkResponses: true });
let base = '';

beforeAll(async () => {
  await listenFetchable(app.server); // [PCODE-365 | S15 | v0.1.0]
  base = 'http://127.0.0.1:' + String((app.server.address() as AddressInfo).port);
});

afterAll(async () => {
  await app.close(100);
});

describe('server', () => {
  it('answers the health check', async () => {
    const res = await fetch(base + '/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', protocol: 1 });
  });

  it('answers an unknown route with the error shape', async () => {
    const res = await fetch(base + '/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('serves its own OpenAPI document, which lists itself', async () => {
    const doc = (await (await fetch(base + '/openapi.json')).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(doc.paths)).toEqual(['/health', '/openapi.json']);
  });
});

// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
//    The ownership rule as a failing test: our own packages and pg, nothing else at runtime.
describe('ownership rule', () => {
  it('has no runtime dependency except our own packages and pg', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const foreign = Object.keys(pkg.dependencies ?? {}).filter(
      (name) => name !== 'pg' && !name.startsWith('@orqiva/'),
    );
    expect(foreign).toEqual([]);
  });
});
