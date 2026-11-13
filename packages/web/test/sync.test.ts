// ── [PCODE-250 | S15 | v0.1.0] T25.5 Profiles, GDPR export and erasure, version check on task edits ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-96 | S15 | v0.1.0] Build our own local-first sync for items: client cache, optimistic writes, reconnect ──
import type { ActivityEvent } from '@orqiva/shared';
import { describe, expect, it } from 'vitest';
import { ItemStore, type Item, type QueueStorage } from '../src/sync/items.js';
import { LiveClient, type SocketLike } from '../src/sync/live.js';

const WS = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';

/** An in-memory stand-in for the item API: it can go offline and can refuse a field. */
class FakeServer {
  items = new Map<string, Item>();
  offline = false;
  refuseStateId: string | null = null;
  calls: string[] = [];
  private seq = 0;
  private gate: Promise<void> = Promise.resolve();
  private release: () => void = () => undefined;

  hold(): void {
    this.gate = new Promise((r) => (this.release = r));
  }
  go(): void {
    this.release();
  }

  add(title: string): Item {
    this.seq++;
    const it: Item = {
      id: 'i' + String(this.seq),
      ref: 'APP-' + String(this.seq),
      projectId: P,
      sequence: this.seq,
      title,
      description: '',
      stateId: 'backlog',
      assigneeId: null,
      estimate: null,
      parentId: null,
      labelIds: [],
      sprintId: null,
      rank: 0,
      version: 1,
      commentCount: 0,
      createdAt: '',
      updatedAt: '',
    };
    this.items.set(it.id, it);
    return it;
  }

  /** someone else changes an item on the server */
  remoteEdit(id: string, fields: Partial<Item>): void {
    const it = this.items.get(id);
    if (it) this.items.set(id, { ...it, ...fields, version: it.version + 1 });
  }

  fetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    this.calls.push(method + ' ' + url.replace('/api/workspaces/' + WS, ''));
    await this.gate;
    if (this.offline) throw new TypeError('fetch failed');
    const json = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), { status });
    // the store always sends JSON text
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Partial<Item>) : {};
    const list = /\/projects\/[^/]+\/items$/.exec(url);
    if (list && method === 'GET') return json(200, [...this.items.values()]);
    if (list && method === 'POST') {
      const it = this.add(body.title ?? '');
      return json(201, { ...it, ...body, version: 1 });
    }
    const one = /\/items\/([^/]+)$/.exec(url);
    const id = one?.[1] ?? '';
    const it = this.items.get(id);
    if (!it) return json(404, { error: { code: 'not_found', message: 'Item not found' } });
    if (method === 'GET') return json(200, it);
    if (body.stateId && body.stateId === this.refuseStateId) {
      return json(400, {
        error: {
          code: 'invalid_request',
          message: 'The request is not valid',
          details: [{ path: 'body.stateId', message: 'is not a state of this project' }],
        },
      });
    }
    // [PCODE-250 | S15 | v0.1.0] an edit made on an older version is refused, as the server does
    const sent = body as Partial<Item> & { version?: number };
    if (sent.version !== undefined && sent.version !== it.version)
      return json(409, {
        error: { code: 'conflict', message: it.ref + ' changed since you opened it' },
      });
    const next = { ...it, ...sent, version: it.version + 1 };
    this.items.set(id, next);
    return json(200, next);
  };
}

const memoryStorage = (): QueueStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, load: (k) => data.get(k) ?? null, save: (k, v) => void data.set(k, v) };
};

const itemEvent = (
  id: string,
  sequence: number,
  verb: 'updated' | 'deleted' = 'updated',
): ActivityEvent => ({
  specversion: '1.0',
  id: 'e' + String(sequence),
  source: '',
  type: 'orqiva.item.' + verb,
  time: '',
  subject: id,
  datacontenttype: 'application/json',
  workspaceid: WS,
  sequence,
  projectid: P,
  data: { actor: { kind: 'user', id: 'someone' }, verb, object: { type: 'item', id } },
});

describe('item store', () => {
  // [PCODE-255 | S15 | v0.1.0]
  it('undoes the last edit, and a bulk edit as one', async () => {
    const server = new FakeServer();
    const a = server.add('One');
    const b = server.add('Two');
    const store = new ItemStore({ workspaceId: WS, fetchImpl: server.fetch });
    await store.loadProject(P);
    store.update(a.id, { title: 'One, renamed', estimate: 3 });
    await store.flush();
    expect(store.canUndo()).toBe(true);
    expect(store.undo()).toBe(1);
    await store.flush();
    expect(store.item(a.id)).toMatchObject({ title: 'One', estimate: null });
    store.remember(
      new Map([
        [a.id, { stateId: 'backlog' }],
        [b.id, { stateId: 'backlog' }],
      ]),
    );
    server.remoteEdit(a.id, { stateId: 'doing' });
    server.remoteEdit(b.id, { stateId: 'doing' });
    expect(store.undo()).toBe(2);
    await store.flush();
    expect([server.items.get(a.id)?.stateId, server.items.get(b.id)?.stateId]).toEqual([
      'backlog',
      'backlog',
    ]);
    expect(store.undo()).toBe(0);
  });

  // [PCODE-250 | S15 | v0.1.0]
  it('refuses a text edit made on an older version, reloads the task, and never conflicts with itself', async () => {
    const server = new FakeServer();
    const a = server.add('Export');
    const rejected: string[] = [];
    const store = new ItemStore({
      workspaceId: WS,
      fetchImpl: server.fetch,
      onRejected: (e) => rejected.push(e.message),
    });
    await store.loadProject(P);
    // two edits of my own in a row: the second is made on the version the first produces
    server.hold();
    store.update(a.id, { description: 'First' });
    store.update(a.id, { description: 'First, then more' });
    server.go();
    await store.flush();
    expect(rejected).toEqual([]);
    expect(store.item(a.id)).toMatchObject({ description: 'First, then more', version: 3 });
    // someone else changes it; my edit on the old version is refused and theirs shows
    server.remoteEdit(a.id, { description: 'Their words' });
    store.update(a.id, { description: 'Mine' });
    await store.flush();
    expect(rejected).toEqual(['APP-1 changed since you opened it']);
    expect(store.item(a.id)).toMatchObject({ description: 'Their words', version: 4 });
    // a move is not text: it carries no version and the last write wins
    server.remoteEdit(a.id, { estimate: 3 });
    store.update(a.id, { stateId: 'doing' });
    await store.flush();
    expect(store.item(a.id)).toMatchObject({ stateId: 'doing', estimate: 3 });
  });

  it('shows an edit at once, then the server’s confirmed copy', async () => {
    const server = new FakeServer();
    const a = server.add('Write the router');
    const store = new ItemStore({ workspaceId: WS, fetchImpl: server.fetch });
    await store.loadProject(P);
    server.hold();
    store.update(a.id, { title: 'Write the router on node:http' });
    expect(store.item(a.id)?.title).toBe('Write the router on node:http');
    expect(store.isPending(a.id)).toBe(true);
    server.go();
    await store.flush();
    expect(store.isPending(a.id)).toBe(false);
    expect(store.item(a.id)).toMatchObject({ title: 'Write the router on node:http', version: 2 });
  });

  it('rolls a refused edit back and says why', async () => {
    const server = new FakeServer();
    const a = server.add('Task');
    server.refuseStateId = 'gone';
    const rejected: string[] = [];
    const store = new ItemStore({
      workspaceId: WS,
      fetchImpl: server.fetch,
      onRejected: (e) => rejected.push(e.details[0]?.path ?? ''),
    });
    await store.loadProject(P);
    store.update(a.id, { stateId: 'gone' });
    expect(store.item(a.id)?.stateId).toBe('gone');
    await store.flush();
    expect(store.item(a.id)?.stateId).toBe('backlog');
    expect(rejected).toEqual(['body.stateId']);
  });

  it('keeps edits made offline, across a reload, and sends them in order on reconnect', async () => {
    const server = new FakeServer();
    const a = server.add('Task');
    const storage = memoryStorage();
    const store = new ItemStore({ workspaceId: WS, fetchImpl: server.fetch, storage });
    await store.loadProject(P);
    server.offline = true;
    store.update(a.id, { title: 'Offline edit 1' });
    store.update(a.id, { estimate: 5 });
    await store.flush();
    expect(store.pendingCount).toBe(2);
    // the page reloads: the queue comes back from storage
    const reloaded = new ItemStore({ workspaceId: WS, fetchImpl: server.fetch, storage });
    await reloaded.loadProject(P).catch(() => undefined);
    expect(reloaded.pendingCount).toBe(2);
    server.offline = false;
    server.calls.length = 0;
    reloaded.setOnline(true);
    await reloaded.flush();
    expect(server.calls.filter((c) => c.startsWith('PATCH'))).toHaveLength(2);
    expect(server.items.get(a.id)).toMatchObject({
      title: 'Offline edit 1',
      estimate: 5,
      version: 3,
    });
    expect(reloaded.pendingCount).toBe(0);
  });

  it('applies someone else’s change from the live stream', async () => {
    const server = new FakeServer();
    const a = server.add('Task');
    const store = new ItemStore({ workspaceId: WS, fetchImpl: server.fetch });
    await store.loadProject(P);
    server.remoteEdit(a.id, { stateId: 'review' });
    await store.applyEvent(itemEvent(a.id, 7));
    expect(store.item(a.id)?.stateId).toBe('review');
    server.items.delete(a.id);
    await store.applyEvent(itemEvent(a.id, 8, 'deleted'));
    expect(store.item(a.id)).toBeUndefined();
  });

  it('conflict rule: my pending field stays on screen over a remote change, other fields update, my write lands last', async () => {
    const server = new FakeServer();
    const a = server.add('Task');
    const store = new ItemStore({ workspaceId: WS, fetchImpl: server.fetch });
    await store.loadProject(P);
    // [PCODE-250 | S15 | v0.1.0] a field other than text: titles and descriptions are checked by version
    server.offline = true;
    store.update(a.id, { estimate: 5 });
    await store.flush();
    server.offline = false;
    server.remoteEdit(a.id, { title: 'Their title', estimate: 8 });
    await store.applyEvent(itemEvent(a.id, 9));
    expect(store.item(a.id)).toMatchObject({ title: 'Their title', estimate: 5 });
    store.setOnline(true);
    await store.flush();
    expect(server.items.get(a.id)?.estimate).toBe(5);
    expect(store.item(a.id)).toMatchObject({ title: 'Their title', estimate: 5 });
  });

  it('shows a new item at once and moves later edits onto the real item', async () => {
    const server = new FakeServer();
    const store = new ItemStore({ workspaceId: WS, fetchImpl: server.fetch });
    await store.loadProject(P);
    server.hold();
    const local = store.create(P, 'Brand new');
    store.update(local, { estimate: 2 });
    expect(store.items(P).map((i) => i.title)).toEqual(['Brand new']);
    server.go();
    await store.flush();
    const real = store.items(P)[0];
    expect(real).toMatchObject({ ref: 'APP-1', title: 'Brand new', estimate: 2 });
  });
});

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

describe('live client', () => {
  it('resumes from the last sequence it saw after a reconnect, and reports the network state', async () => {
    const sockets: FakeSocket[] = [];
    const got: number[] = [];
    const status: boolean[] = [];
    const live = new LiveClient({
      workspaceId: WS,
      open: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      onEvent: (e) => got.push(e.sequence),
      onResync: () => undefined,
      onStatus: (o) => status.push(o),
    });
    live.start();
    sockets[0]?.onopen?.();
    expect(sockets[0]?.sent[0]).toEqual({ type: 'subscribe', workspaceId: WS });
    sockets[0]?.receive({ type: 'subscribed', workspaceId: WS, sequence: 4 });
    sockets[0]?.receive({ type: 'event', event: itemEvent('i1', 5) });
    sockets[0]?.receive({ type: 'event', event: itemEvent('i1', 5) });
    sockets[0]?.close();
    await new Promise((r) => setTimeout(r, 1100));
    sockets[1]?.onopen?.();
    expect(sockets[1]?.sent[0]).toEqual({ type: 'subscribe', workspaceId: WS, after: 5 });
    expect(got).toEqual([5]);
    expect(status).toEqual([true, false]);
    live.stop();
  });
});
