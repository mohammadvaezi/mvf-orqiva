// ── [PCODE-225 | S15 | v0.1.0] T21.2 Live feed core and offline cache for the phone, in shared ──
//    Why:  the exit of T21.2: a feed opened offline shows the cached events at once and, once online,
//          receives exactly the missed ones; a gap too large to replay reloads the newest page.
import { describe, expect, it } from 'vitest';
import {
  Feed,
  feedCacheKey,
  mergeEvents,
  readFeedCache,
  type ActivityEvent,
  type FeedState,
  type KeyValueStore,
  type SocketLike,
} from '../src/index.js';

const WS = '11111111-1111-4111-8111-111111111111';
const SERVER = 'https://orqiva.example.test';

const ev = (sequence: number): ActivityEvent => ({
  specversion: '1.0',
  id: 'e' + String(sequence),
  source: '/workspaces/' + WS,
  type: 'orqiva.item.updated',
  time: new Date(Date.UTC(2026, 9, 10, 9, sequence)).toISOString(),
  subject: 'i1',
  datacontenttype: 'application/json',
  workspaceid: WS,
  sequence,
  data: {
    actor: { kind: 'user', id: 'u1', name: 'Ada' },
    verb: 'updated',
    object: { type: 'item', id: 'i1', label: 'APP-1 Sign in' },
  },
});
const seqs = (s: FeedState): number[] => s.events.map((e) => e.sequence);

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

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: unknown[] = [];
  send(text: string): void {
    this.sent.push(JSON.parse(text));
  }
  close(): void {
    this.onclose?.();
  }
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(
  store: MemoryStore,
  page: () => Promise<{ sequence: number; events: ActivityEvent[] }>,
) {
  const sockets: FakeSocket[] = [];
  const states: FeedState[] = [];
  let pages = 0;
  const feed = new Feed({
    server: SERVER,
    workspaceId: WS,
    store,
    open: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    fetchPage: () => {
      pages++;
      return page();
    },
    onChange: (s) => states.push(s),
    saveDelayMs: 0,
    now: () => new Date('2026-10-10T10:00:00Z'),
  });
  return { feed, sockets, states, pages: () => pages, last: () => states[states.length - 1] };
}

const offline = () => Promise.reject(new Error('Network request failed'));

describe('the phone feed', () => {
  it('opens offline from the cache, then receives exactly the missed events', async () => {
    const store = new MemoryStore();
    await store.setItem(
      feedCacheKey(SERVER, WS),
      JSON.stringify({
        v: 1,
        server: SERVER,
        workspaceId: WS,
        sequence: 3,
        events: [ev(1), ev(2), ev(3)],
        savedAt: '2026-10-09T18:00:00.000Z',
      }),
    );
    const f = setup(store, offline);
    await f.feed.open();
    // the cache shows at once, without asking the network
    expect(seqs(f.states[0] as FeedState)).toEqual([3, 2, 1]);
    expect(f.last()?.cachedAt).toBe('2026-10-09T18:00:00.000Z');
    expect(f.pages()).toBe(0);

    // no network: the socket closes without opening
    f.sockets[0]?.close();
    expect(f.last()?.status).toBe('offline');
    expect(seqs(f.last() as FeedState)).toEqual([3, 2, 1]);

    // the app comes to the front with the network back: it connects now, from the cache's cursor
    f.feed.wake();
    const s = f.sockets[1];
    s?.onopen?.();
    expect(s?.sent[0]).toEqual({ type: 'subscribe', workspaceId: WS, after: 3 });
    s?.receive({ type: 'subscribed', workspaceId: WS, sequence: 5 });
    s?.receive({ type: 'event', event: ev(4) });
    s?.receive({ type: 'event', event: ev(5) });
    expect(f.last()).toMatchObject({ status: 'live', cachedAt: null });
    expect(seqs(f.last() as FeedState)).toEqual([5, 4, 3, 2, 1]);

    // and saves where it is, for the next start
    await f.feed.close();
    const saved = readFeedCache(store.map.get(feedCacheKey(SERVER, WS)) ?? null, SERVER, WS);
    expect(saved).toMatchObject({ sequence: 5, savedAt: '2026-10-10T10:00:00.000Z' });
    expect(saved?.events.map((e) => e.sequence)).toEqual([5, 4, 3, 2, 1]);
  });

  it('without a cache, loads the newest page and follows on from it', async () => {
    const f = setup(new MemoryStore(), () =>
      Promise.resolve({ sequence: 12, events: [ev(10), ev(11), ev(12)] }),
    );
    await f.feed.open();
    expect(seqs(f.last() as FeedState)).toEqual([12, 11, 10]);
    f.sockets[0]?.onopen?.();
    expect(f.sockets[0]?.sent[0]).toEqual({ type: 'subscribe', workspaceId: WS, after: 12 });
    // an event that was on the page and in the stream shows once
    f.sockets[0]?.receive({ type: 'subscribed', workspaceId: WS, sequence: 12 });
    f.sockets[0]?.receive({ type: 'event', event: ev(13) });
    expect(seqs(f.last() as FeedState)).toEqual([13, 12, 11, 10]);
    await f.feed.close();
  });

  it('started offline without a cache, loads the page once the stream is live', async () => {
    let online = false;
    const f = setup(new MemoryStore(), () =>
      online ? Promise.resolve({ sequence: 2, events: [ev(1), ev(2)] }) : offline(),
    );
    await f.feed.open();
    expect(f.last()?.error).toBe('Network request failed');
    online = true;
    f.sockets[0]?.onopen?.();
    expect(f.sockets[0]?.sent[0]).toEqual({ type: 'subscribe', workspaceId: WS });
    f.sockets[0]?.receive({ type: 'subscribed', workspaceId: WS, sequence: 2 });
    await tick();
    expect(seqs(f.last() as FeedState)).toEqual([2, 1]);
    expect(f.last()?.error).toBeNull();
    expect(f.pages()).toBe(2);
    await f.feed.close();
  });

  it('reloads the newest page when the gap is too large to replay', async () => {
    const store = new MemoryStore();
    await store.setItem(
      feedCacheKey(SERVER, WS),
      JSON.stringify({
        v: 1,
        server: SERVER,
        workspaceId: WS,
        sequence: 2,
        events: [ev(1), ev(2)],
        savedAt: '',
      }),
    );
    const f = setup(store, () => Promise.resolve({ sequence: 900, events: [ev(899), ev(900)] }));
    await f.feed.open();
    f.sockets[0]?.onopen?.();
    f.sockets[0]?.receive({ type: 'resync', workspaceId: WS, sequence: 900 });
    await tick();
    expect(seqs(f.last() as FeedState)).toEqual([900, 899]);
    await f.feed.close();
  });

  it('forgets the cache on sign-out', async () => {
    const store = new MemoryStore();
    const f = setup(store, () => Promise.resolve({ sequence: 1, events: [ev(1)] }));
    await f.feed.open();
    expect(store.map.size).toBe(1);
    await f.feed.forget();
    expect(store.map.size).toBe(0);
  });
});

describe('the feed cache', () => {
  it('reads only its own, readable cache', () => {
    const ok = JSON.stringify({
      v: 1,
      server: SERVER,
      workspaceId: WS,
      sequence: 2,
      events: [ev(2), { broken: true }, ev(1)],
      savedAt: 'x',
    });
    expect(readFeedCache(ok, SERVER, WS)?.events.map((e) => e.sequence)).toEqual([2, 1]);
    expect(readFeedCache(ok, 'https://other.example.test', WS)).toBeNull();
    expect(readFeedCache(ok, SERVER, 'other')).toBeNull();
    expect(readFeedCache(ok.replace('"v":1', '"v":0'), SERVER, WS)).toBeNull();
    expect(readFeedCache('{not json', SERVER, WS)).toBeNull();
    expect(readFeedCache(null, SERVER, WS)).toBeNull();
  });

  it('keeps events newest first, once each, capped', () => {
    expect(mergeEvents([ev(1), ev(3)], [ev(3), ev(2), ev(4)], 3).map((e) => e.sequence)).toEqual([
      4, 3, 2,
    ]);
  });
});
