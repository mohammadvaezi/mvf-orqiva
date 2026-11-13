// ── [PCODE-27 | S05 | v0.1.0] Build the setup panel: environment checks, Plane connection and key storage ──
//    Why:  guard for criticals #1: the connect flow tests before it stores, a wrong key stores nothing, and
//          nothing the host posts back to the webview ever contains the key.
import { describe, expect, it } from 'vitest';
import { connectPlane, normalizeUrl } from '../../src/setup/connect';
import { connectionState } from '../../src/webviews/setup/panel';
import { isWebviewMessage } from '../../src/webviews/protocol';
import type { Services } from '../../src/services';

const KEY = 'plane_api_test_key_abcdef0123';

function deps(status: number | 'ok') {
  const settings: Record<string, string> = {};
  let stored: string | null = null;
  const calls: string[] = [];
  return {
    settings,
    get stored() {
      return stored;
    },
    calls,
    d: {
      writeSetting: (k: string, v: string) => {
        calls.push(`setting:${k}`);
        settings[k] = v;
        return Promise.resolve();
      },
      storeKey: (k: string) => {
        calls.push('store');
        stored = k;
        return Promise.resolve();
      },
      testClient: () => ({
        getProjects: () => {
          calls.push('test');
          return status === 'ok'
            ? Promise.resolve([{ identifier: 'PCODE' }, { identifier: 'LTR' }])
            : Promise.reject(new Error(`Plane GET /projects/ failed (${status}).`));
        },
      }),
    },
  };
}

describe('connectPlane', () => {
  // ── [PCODE-27 | S05 | v0.1.0] test first, then store settings and the key ──
  it('tests the key, then stores address and workspace in settings and the key separately', async () => {
    const x = deps('ok');
    const r = await connectPlane(x.d, {
      baseUrl: 'plan.broszio.com/',
      workspace: '/prodsystem/',
      apiKey: ` ${KEY} `,
    });
    expect(r.projects).toEqual(['PCODE', 'LTR']);
    expect(x.calls).toEqual(['test', 'setting:plane.baseUrl', 'setting:plane.workspace', 'store']);
    expect(x.settings).toEqual({
      'plane.baseUrl': 'https://plan.broszio.com',
      'plane.workspace': 'prodsystem',
    });
    expect(JSON.stringify(x.settings)).not.toContain('plane_api');
    expect(x.stored).toBe(KEY);
    expect(normalizeUrl('http://localhost:8091/')).toBe('http://localhost:8091');
  });

  it('a wrong key gives the 401 message and stores nothing', async () => {
    const x = deps(401);
    await expect(
      connectPlane(x.d, { baseUrl: 'https://p', workspace: 'ws', apiKey: KEY }),
    ).rejects.toThrow(
      'Connection failed. 401 Unauthorized. Check the key in the tracker: Profile > Personal Access Tokens.',
    );
    expect(x.stored).toBeNull();
    expect(x.settings).toEqual({});
    await expect(
      connectPlane(deps(404).d, { baseUrl: 'https://p', workspace: 'nope', apiKey: KEY }),
    ).rejects.toThrow(/404 Not Found.*"nope"/);
    await expect(
      connectPlane(deps('ok').d, { baseUrl: 'https://p', workspace: 'ws', apiKey: '  ' }),
    ).rejects.toThrow(/Paste an API key/);
  });

  it('the connection state posted to the webview never carries the key', async () => {
    const services = {
      connection: () => ({ baseUrl: 'https://p', workspace: 'ws' }),
      secrets: { hasApiKey: () => Promise.resolve(true) },
    } as unknown as Services;
    const state = await connectionState(services);
    expect(state).toEqual({
      type: 'setup/connection',
      baseUrl: 'https://p',
      workspace: 'ws',
      hasKey: true,
    });
    expect(JSON.stringify(state)).not.toMatch(/apiKey|plane_api/);
  });

  it('protocol accepts the setup messages and rejects a malformed connect', () => {
    expect(
      isWebviewMessage({
        type: 'setup/connect',
        baseUrl: 'https://p',
        workspace: 'ws',
        apiKey: KEY,
      }),
    ).toBe(true);
    expect(isWebviewMessage({ type: 'setup/refresh' })).toBe(true);
    expect(isWebviewMessage({ type: 'setup/openFix', fix: 'https://nodejs.org/' })).toBe(true);
    expect(isWebviewMessage({ type: 'setup/connect', baseUrl: 'https://p' })).toBe(false);
  });
});
