// ── [PCODE-354 | S15 | v0.1.0] T35.4b Offline beyond tasks: comments, messages and time written offline; reads kept for offline ──
//    Why:  a write that cannot reach the server waits, survives a reload, goes out in order, stays when the
//          server is still away and is dropped by name when the server refuses it; and the service worker
//          keeps only the pages' data for reading offline.
import { describe, expect, it } from 'vitest';
import type { ApiResult } from '../src/core/api.js';
import { offlineReadable, passThrough } from '../src/pwa.js';
import { Outbox, sendOrQueue, type Queued } from '../src/sync/outbox.js';

const memory = (): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
};
const ok: ApiResult<unknown> = { ok: true, data: {} };
const fail = (status: number, message = 'x'): ApiResult<unknown> => ({
  ok: false,
  error: { status, code: 'x', message, details: [] },
});

describe('the outbox', () => {
  it('keeps a write the server cannot get, and survives a reload', async () => {
    const store = memory();
    const box = new Outbox(store, 'k');
    const r = await sendOrQueue(box, 'POST', '/api/x', { body: 'hi' }, 'Comment on APP-1', () =>
      Promise.resolve(fail(0)),
    );
    expect(r).toEqual({ queued: true });
    expect(new Outbox(store, 'k').list().map((q) => q.label)).toEqual(['Comment on APP-1']);
    expect(
      await sendOrQueue(box, 'POST', '/api/x', {}, 'x', () => Promise.resolve(fail(403, 'No'))),
    ).toEqual({ error: 'No' });
    expect(box.count).toBe(1);
  });
  it('sends in order, waits while the server is away, and drops what it refuses', async () => {
    const box = new Outbox(memory(), 'k');
    for (const l of ['one', 'two', 'three'])
      box.add({ method: 'POST', path: '/api/' + l, body: {}, label: l });
    const seen: string[] = [];
    let away = true;
    const send = (q: Queued): Promise<ApiResult<unknown>> => {
      seen.push(q.label);
      if (q.label === 'one') return Promise.resolve(away ? fail(0) : ok);
      return Promise.resolve(q.label === 'two' ? fail(409, 'Archived') : ok);
    };
    expect(await box.flush(send)).toBe(0);
    expect(box.count).toBe(3);
    away = false;
    expect(await box.flush(send)).toBe(2);
    expect(seen).toEqual(['one', 'one', 'two', 'three']);
    expect(box.count).toBe(0);
    expect(box.dropped).toEqual([{ label: 'two', message: 'Archived' }]);
  });
});

describe('what the service worker keeps', () => {
  const o = 'https://orqiva.example.test';
  const ws = '/api/workspaces/0f0e0d0c-0b0a-4900-8000-000000000001';
  const u = (p: string): URL => new URL(o + p);
  it('keeps the pages’ data for reading offline, nothing else', () => {
    expect(offlineReadable(u(ws + '/my-work'), o)).toBe(true);
    expect(offlineReadable(u(ws + '/time/week'), o)).toBe(true);
    expect(
      offlineReadable(u(ws + '/channels/0f0e0d0c-0b0a-4900-8000-000000000002/messages'), o),
    ).toBe(true);
    expect(offlineReadable(u(ws + '/items/0f0e0d0c-0b0a-4900-8000-000000000003/comments'), o)).toBe(
      true,
    );
    expect(offlineReadable(u(ws + '/system/health'), o)).toBe(false);
    expect(offlineReadable(u(ws + '/members'), o)).toBe(false);
    // who is signed in, so the app opens offline; signing out empties the kept data
    expect(offlineReadable(u('/auth/me'), o)).toBe(true);
    expect(offlineReadable(u('/auth/login'), o)).toBe(false);
    expect(offlineReadable(new URL('https://other.test' + ws + '/my-work'), o)).toBe(false);
    // everything else under /api still goes straight to the server
    expect(passThrough(u(ws + '/members'), o)).toBe(true);
  });
});
