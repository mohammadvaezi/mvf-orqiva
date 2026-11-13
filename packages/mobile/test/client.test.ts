// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
import { describe, expect, it } from 'vitest';
import {
  fetchPage,
  insecureServer,
  pair,
  readSession,
  revoke,
  SignedOutError,
  socketUrl,
  type Session,
} from '../src/client';

const SESSION: Session = {
  server: 'https://orqiva.example.test',
  token: 'orq_pat_' + 'x'.repeat(43),
  tokenId: 't1',
  expiresAt: '2027-01-08T10:00:00.000Z',
  workspace: { id: 'w1', name: 'Ada Co' },
  user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.test' },
};

/** A fetch that records the request and answers with `status` and `body`. */
function fake(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const f = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { f: f as typeof fetch, calls };
}

describe('the app’s client', () => {
  it('redeems a pairing code and keeps the session it gets', async () => {
    const { server: _server, ...answer } = SESSION;
    const { f, calls } = fake(200, answer);
    const s = await pair('https://orqiva.example.test', 'AB3K7MQX', 'Pixel 9', f);
    expect(s).toEqual(SESSION);
    expect(calls[0]?.url).toBe('https://orqiva.example.test/auth/devices/pair');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      code: 'AB3K7MQX',
      device: 'Pixel 9',
    });
  });

  it('says why a pairing failed', async () => {
    const { f } = fake(400, { error: { message: 'This code is not valid' } });
    await expect(pair('https://x.test', 'AB3K7MQX', 'P', f)).rejects.toThrow(
      'This code is not valid',
    );
    const down = (() => Promise.reject(new TypeError('Network request failed'))) as typeof fetch;
    await expect(pair('https://x.test', 'AB3K7MQX', 'P', down)).rejects.toThrow(
      /Cannot reach https:\/\/x.test/,
    );
  });

  it('sends the device token and reads a 401 as signed out', async () => {
    const ok = fake(200, { sequence: 3, events: [] });
    expect(await fetchPage(SESSION, 50, ok.f)).toEqual({ sequence: 3, events: [] });
    expect(ok.calls[0]?.url).toBe(
      'https://orqiva.example.test/api/workspaces/w1/activity?limit=50',
    );
    expect((ok.calls[0]?.init?.headers as Record<string, string>)['authorization']).toBe(
      'Bearer ' + SESSION.token,
    );
    await expect(fetchPage(SESSION, 50, fake(401, {}).f)).rejects.toBeInstanceOf(SignedOutError);
  });

  it('revokes its own token, and a token already gone counts as done', async () => {
    const r = fake(200, {});
    expect(await revoke(SESSION, r.f)).toBe(true);
    expect(r.calls[0]?.url).toBe(
      'https://orqiva.example.test/api/workspaces/w1/access-tokens/t1/revoke',
    );
    expect(await revoke(SESSION, fake(401, {}).f)).toBe(true);
    expect(
      await revoke(SESSION, (() => Promise.reject(new Error('offline'))) as typeof fetch),
    ).toBe(false);
  });

  it('reads only a complete stored session', () => {
    expect(readSession(JSON.stringify(SESSION))).toEqual(SESSION);
    expect(readSession(JSON.stringify({ ...SESSION, token: 1 }))).toBeNull();
    expect(readSession(JSON.stringify({ ...SESSION, workspace: null }))).toBeNull();
    expect(readSession('{')).toBeNull();
    expect(readSession(null)).toBeNull();
  });

  it('opens the socket on the server’s host and path', () => {
    expect(socketUrl('https://orqiva.example.test')).toBe('wss://orqiva.example.test/live');
    expect(socketUrl('http://192.168.1.20:8480/orqiva', '/live')).toBe(
      'ws://192.168.1.20:8480/orqiva/live',
    );
  });

  it('calls out plain HTTP outside the local network', () => {
    expect(insecureServer('https://orqiva.example.test')).toBe(false);
    expect(insecureServer('http://192.168.1.20:8480')).toBe(false);
    expect(insecureServer('http://nas.local:8480')).toBe(false);
    expect(insecureServer('http://orqiva.example.test')).toBe(true);
  });
});
