// ── [PCODE-227 | S15 | v0.1.0] T21.4 Mobile docs, end-to-end check and sprint close ──
//    Why:  the T21 exit, end to end against a real server: a phone pairs, opens the live feed with its
//          device token (the shared feed core, as the app runs it), sees a change made elsewhere as it
//          happens, is closed, misses a change, opens again from its cache and receives exactly the
//          missed event; and once the token is revoked in the web app, the open connection ends at once and
//          the server refuses the phone.
import {
  Feed,
  type ActivityEvent,
  type FeedState,
  type KeyValueStore,
  type SocketLike,
} from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

class MemoryStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  getItem(k: string): Promise<string | null> {
    return Promise.resolve(this.map.get(k) ?? null);
  }
  setItem(k: string, v: string): Promise<void> {
    this.map.set(k, v);
    return Promise.resolve();
  }
  removeItem(k: string): Promise<void> {
    this.map.delete(k);
    return Promise.resolve();
  }
}

/** Node's WebSocket takes headers, as React Native's does: the device token goes on the socket. */
type HeaderWebSocket = new (url: string, init: { headers: Record<string, string> }) => SocketLike;

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe.skipIf(!hasDatabase)('the phone’s live feed, end to end (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let token = '';
  let tokenId = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const store = new MemoryStore();
  const titles = (s: FeedState | undefined): string[] =>
    (s?.events ?? [])
      .filter((e) => e.type.endsWith('.item.created'))
      .map((e) => e.data.object.label ?? '');

  const phoneFeed = (states: FeedState[]): Feed =>
    new Feed({
      server: t.base,
      workspaceId: ada.workspaceId,
      store,
      open: (path) => {
        const WS = WebSocket as unknown as HeaderWebSocket;
        return new WS(t.base.replace(/^http/, 'ws') + path, {
          headers: { Authorization: 'Bearer ' + token },
        });
      },
      fetchPage: async () => {
        const r = await fetch(t.base + W('/activity?limit=100'), {
          headers: { authorization: 'Bearer ' + token },
        });
        if (!r.ok) throw new Error('status ' + String(r.status));
        return (await r.json()) as { sequence: number; events: ActivityEvent[] };
      },
      onChange: (s) => states.push(s),
      saveDelayMs: 0,
    });
  const item = (title: string) =>
    t.call(ada, 'POST', W('/projects/' + project + '/items'), { title });

  beforeAll(async () => {
    t = await startTestApp({ live: true });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await item('Sign-in with email');
    const code = (await t.call<{ code: string }>(ada, 'POST', W('/devices/pairing'))).body.code;
    const paired = await t.call<{ token: string; tokenId: string }>(
      null,
      'POST',
      '/auth/devices/pair',
      { code, device: 'Test phone' },
    );
    token = paired.body.token;
    tokenId = paired.body.tokenId;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('follows the workspace live, then resumes from its cache with exactly what it missed', async () => {
    const first: FeedState[] = [];
    const feed = phoneFeed(first);
    await feed.open();
    await until(() => first.at(-1)?.status === 'live');
    expect(titles(first.at(-1))).toEqual(['APP-1 Sign-in with email']);

    // a change made in the web app reaches the phone as it happens
    await item('Appointment list');
    await until(() => titles(first.at(-1)).includes('APP-2 Appointment list'));
    await feed.close();

    // the phone is closed; something happens meanwhile
    await item('Reminder settings');

    // opened again: the cache shows at once, then exactly the missed event arrives
    const second: FeedState[] = [];
    const again = phoneFeed(second);
    await again.open();
    expect(second[0]?.cachedAt).not.toBeNull();
    expect(titles(second[0])).toEqual(['APP-2 Appointment list', 'APP-1 Sign-in with email']);
    await until(() => titles(second.at(-1)).includes('APP-3 Reminder settings'));
    const seqs = (second.at(-1)?.events ?? []).map((e) => e.sequence);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(titles(second.at(-1))).toEqual([
      'APP-3 Reminder settings',
      'APP-2 Appointment list',
      'APP-1 Sign-in with email',
    ]);

    // signed out in the web app: the server refuses the phone from then on
    expect((await t.call(ada, 'POST', W('/access-tokens/' + tokenId + '/revoke'))).status).toBe(
      200,
    );
    // the open connection ends at once, and nothing more reaches the phone
    await until(() => second.at(-1)?.status === 'offline');
    await item('After sign-out');
    await new Promise((r) => setTimeout(r, 300));
    expect(titles(second.at(-1))).not.toContain('APP-4 After sign-out');
    await again.refresh();
    expect(second.at(-1)?.error).toBe('status 401');
    await again.forget();
    expect(store.map.size).toBe(0);
  });
});
