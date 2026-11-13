// ── [PCODE-12 | S02 | v0.1.0] Add a read-only Plane REST client with SecretStorage key and 20 req/min throttle ──
//    Why:  guards for criticals #2 (read-only surface) and #11 (throttle), plus pagination and secrets.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PlaneClient, type FetchLike } from '../../src/plane/client';
import { PlaneSecrets, SECRET_PLANE_API_KEY } from '../../src/plane/secrets';
import { Throttle } from '../../src/plane/throttle';
import { clearRegisteredSecrets, redact } from '../../src/util/redact';
import { SecretStorageMock, recorded, resetRecorded } from '../mocks/vscode';

function fakeFetch(pages: Record<string, unknown>, calls: string[]): FetchLike {
  return (url) => {
    calls.push(url);
    const key = Object.keys(pages).find((k) => url.includes(k)) ?? '';
    return Promise.resolve({
      status: key ? 200 : 404,
      headers: {},
      text: () => Promise.resolve(JSON.stringify(pages[key] ?? { detail: 'nope' })),
    });
  };
}

describe('PlaneClient', () => {
  // ── [PCODE-12 | S02 | v0.1.0] read_only_surface (criticals #2) ──
  it('read_only_surface: exposes no write verbs and the source sends only GET', () => {
    const names = Object.getOwnPropertyNames(PlaneClient.prototype).filter(
      (n) => n !== 'constructor',
    );
    for (const n of names)
      expect(n).not.toMatch(/^(post|patch|put|delete|create|update|remove|set)/i);
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'plane', 'client.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/method:\s*'(POST|PATCH|PUT|DELETE)'/);
    expect(src).toMatch(/method: 'GET'/);
  });

  it('follows next_cursor across three pages in order', async () => {
    const calls: string[] = [];
    const client = new PlaneClient({
      baseUrl: 'https://plane.example.test/',
      workspace: 'ws',
      apiKey: () => Promise.resolve('plane_api_test_key_000'),
      fetch: (url) => {
        calls.push(url);
        const cursor = new URL(url).searchParams.get('cursor');
        const page =
          cursor === 'c2'
            ? { results: [{ id: 'i5' }, { id: 'i6' }], next_page_results: false, next_cursor: null }
            : cursor === 'c1'
              ? {
                  results: [{ id: 'i3' }, { id: 'i4' }],
                  next_page_results: true,
                  next_cursor: 'c2',
                }
              : {
                  results: [{ id: 'i1' }, { id: 'i2' }],
                  next_page_results: true,
                  next_cursor: 'c1',
                };
        return Promise.resolve({
          status: 200,
          headers: {},
          text: () => Promise.resolve(JSON.stringify(page)),
        });
      },
    });
    const issues = await client.getIssues('p1');
    expect(issues.map((i) => i.id)).toEqual(['i1', 'i2', 'i3', 'i4', 'i5', 'i6']);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe(
      'https://plane.example.test/api/v1/workspaces/ws/projects/p1/issues/?per_page=100',
    );
    expect(calls[2]).toContain('cursor=c2');
  });

  it('resolves refs workspace-wide and ids per project; errors carry no key', async () => {
    const calls: string[] = [];
    const client = new PlaneClient({
      baseUrl: 'https://plane.example.test',
      workspace: 'ws',
      apiKey: () => Promise.resolve('plane_api_test_key_000'),
      fetch: fakeFetch(
        {
          '/issues/PCODE-12/': { id: 'x', sequence_id: 12 },
          '/projects/p1/issues/uuid-1/': { id: 'uuid-1' },
        },
        calls,
      ),
    });
    expect((await client.getIssue('p1', 'PCODE-12')).sequence_id).toBe(12);
    expect((await client.getIssue('p1', 'uuid-1')).id).toBe('uuid-1');
    await expect(client.getIssue('p1', 'missing')).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringContaining('404') as string,
    });
    expect(client.webUrl('p1', 'uuid-1')).toBe(
      'https://plane.example.test/ws/projects/p1/issues/uuid-1/',
    );
  });

  it('refuses to call without a key', async () => {
    const client = new PlaneClient({
      baseUrl: 'https://x',
      workspace: 'ws',
      apiKey: () => Promise.resolve(undefined),
      fetch: fakeFetch({}, []),
    });
    await expect(client.getProjects()).rejects.toMatchObject({ kind: 'config' });
  });
});

// ── [PCODE-12 | S02 | v0.1.0] throttle (criticals #11) with an injected clock ──
describe('Throttle', () => {
  it('lets 20 calls through and makes the 21st wait for the window', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const t = new Throttle({
      perMinute: 20,
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });
    for (let i = 0; i < 20; i++) {
      await t.acquire();
      now += 100;
    }
    expect(sleeps).toEqual([]);
    await t.acquire();
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(55_000);
    expect(t.pending).toBeLessThanOrEqual(20);
  });

  it('a 429 with Retry-After: 5 delays the next call by 5 s', async () => {
    let now = 1_000_000;
    const sleeps: number[] = [];
    const t = new Throttle({
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });
    expect(t.backOff({ 'retry-after': '5' })).toBe(5000);
    await t.acquire();
    expect(sleeps).toEqual([5000]);
    expect(
      t.backOff({ 'x-ratelimit-reset': String(Math.floor((now + 7000) / 1000)) }),
    ).toBeGreaterThanOrEqual(6000);
    expect(t.backOff({})).toBe(15_000);
  });

  it('the client retries after a 429 using the throttle', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const t = new Throttle({
      now: () => 0,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    const client = new PlaneClient({
      baseUrl: 'https://x',
      workspace: 'ws',
      apiKey: () => Promise.resolve('plane_api_test_key_000'),
      throttle: t,
      fetch: () => {
        calls++;
        return Promise.resolve(
          calls === 1
            ? { status: 429, headers: { 'retry-after': '2' }, text: () => Promise.resolve('') }
            : { status: 200, headers: {}, text: () => Promise.resolve('[]') },
        );
      },
    });
    // the fake clock never advances, so after the back-off the throttle would sleep forever; advance it once
    let advanced = false;
    const t2 = new Throttle({
      now: () => (advanced ? 10_000 : 0),
      sleep: (ms) => {
        sleeps.push(ms);
        advanced = true;
        return Promise.resolve();
      },
    });
    const client2 = new PlaneClient({ ...clientOpts(client), throttle: t2 });
    expect(await client2.getProjects()).toEqual([]);
    expect(calls).toBe(2);
    expect(sleeps[0]).toBe(2000);
  });
});

function clientOpts(c: PlaneClient): {
  baseUrl: string;
  workspace: string;
  apiKey: () => Promise<string | undefined>;
  fetch: FetchLike;
} {
  const o = (
    c as unknown as {
      opts: {
        baseUrl: string;
        workspace: string;
        apiKey: () => Promise<string | undefined>;
        fetch?: FetchLike;
      };
    }
  ).opts;
  return {
    baseUrl: o.baseUrl,
    workspace: o.workspace,
    apiKey: o.apiKey,
    fetch: o.fetch ?? (() => Promise.reject(new Error('no fetch'))),
  };
}

// ── [PCODE-12 | S02 | v0.1.0] secrets: SecretStorage only, registered with redact, env for the engine ──
describe('PlaneSecrets', () => {
  beforeEach(() => {
    resetRecorded();
    clearRegisteredSecrets();
  });

  it('stores, registers for redaction, builds the engine env and forgets', async () => {
    const s = new PlaneSecrets(new SecretStorageMock(), () => ({
      baseUrl: 'https://plane.example.test',
      workspace: 'ws',
    }));
    expect(await s.hasApiKey()).toBe(false);
    await s.setApiKey(' plane_api_stored_key_123 ');
    expect(recorded.secrets.get(SECRET_PLANE_API_KEY)).toBe('plane_api_stored_key_123');
    expect(redact('token plane_api_stored_key_123 here')).toBe('token *** here');
    const env = await s.envForEngine();
    expect(env).toEqual({
      PLANE_BASE_URL: 'https://plane.example.test',
      PLANE_WORKSPACE_SLUG: 'ws',
      PLANE_API_KEY: 'plane_api_stored_key_123',
    });
    await s.deleteApiKey();
    expect(await s.getApiKey()).toBeUndefined();
    expect((await s.envForEngine())['PLANE_API_KEY']).toBeUndefined();
  });

  it('no setting named apiKey exists in package.json', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as {
      contributes: { configuration: { properties: Record<string, unknown> } };
    };
    for (const key of Object.keys(pkg.contributes.configuration.properties))
      expect(key.toLowerCase()).not.toContain('apikey');
  });
});
