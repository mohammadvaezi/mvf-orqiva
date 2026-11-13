// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
// ── [PCODE-36 | S07 | v0.1.0] Add a fingerprint CodeLens provider showing task title and state above markers ──
//    Why:  refs on the board cost no request; an unknown ref is fetched once (batched) and cached for the TTL;
//          offline or without a key nothing is requested and the entry says so.
import { describe, expect, it } from 'vitest';
import { IssueCache, TTL_MS } from '../../src/plane/issueCache';
import { boardFromSprintsMd } from '../../src/state/board';
import { parseSprintsMd } from '../../src/state/sprintsMd';
import { Store } from '../../src/state/store';

const SPRINTS_MD =
  '## Sprint 01 - Foundation (2026-01-01) — 0/2 done\n- [ ] FIX-2 Add the greeting function — In Progress (medium)\n- [ ] FIX-3 Add a farewell function — Todo (low)\n';

function setup(opts: { online?: boolean; key?: boolean; fail?: string; server?: string } = {}) {
  const store = new Store();
  store.load(null);
  store.state.link = {
    project_id: 'p1',
    identifier: 'FIX',
    name: 'Fixture',
    workspace: 'ws',
    version: '0.1.0',
    ...(opts.server ? { server: opts.server } : {}), // [PCODE-193 | S15 | v0.1.0]
  };
  store.state.sprints = boardFromSprintsMd(parseSprintsMd(SPRINTS_MD), '2026-01-01');
  store.setOnline(opts.online ?? true);
  const calls: string[] = [];
  let now = 1_000_000;
  const cache = new IssueCache({
    store,
    hasApiKey: () => Promise.resolve(opts.key ?? true),
    now: () => now,
    batchMs: 1,
    client: {
      getStates: () => {
        calls.push('states');
        return Promise.resolve([
          { id: 's-todo', name: 'Todo', group: 'unstarted', color: '' },
          { id: 's-done', name: 'Done', group: 'completed', color: '' },
        ]);
      },
      getIssue: (_p, ref) => {
        calls.push(`issue:${ref}`);
        if (opts.fail) return Promise.reject(new Error(opts.fail));
        return Promise.resolve({
          id: `id-${ref}`,
          sequence_id: 9,
          name: `Fetched ${ref}`,
          state: 's-done',
          priority: 'low' as const,
          labels: [],
        });
      },
      webUrl: (p, id) => `https://plane.example.test/ws/projects/${p}/issues/${id ?? ''}/`,
    },
  });
  return { store, cache, calls, advance: (ms: number) => (now += ms) };
}

const tick = () => new Promise((r) => setTimeout(r, 15));

describe('IssueCache', () => {
  // [PCODE-193 | S15 | v0.1.0] the live board of Orqiva has the whole project: Plane is never asked
  it('never asks Plane for a folder linked to Orqiva', async () => {
    const { cache, calls } = setup({ server: 'http://localhost:8480' });
    expect(cache.get('FIX-99')).toEqual({ kind: 'pending' });
    await tick();
    expect(cache.get('FIX-99')).toEqual({ kind: 'missing' });
    expect(calls).toEqual([]);
  });

  // ── [PCODE-39 | S07 | v0.1.0] active.json makes its task In Progress without a request ──
  it('reports the active task as In Progress even when the board says Todo', async () => {
    const { store, cache, calls } = setup();
    expect(cache.get('FIX-3')).toMatchObject({ kind: 'known', info: { state: { name: 'Todo' } } });
    store.state.active = {
      task: 'FIX-3',
      issue_id: 'i3',
      title: 'Add a farewell function',
      sprint: 'S01',
      sprint_name: 'Sprint 01 - Foundation',
      version: '0.1.0',
      session_id: 's',
      host: 'h',
      started_at: '2026-01-01T00:00:00',
      files: [],
      url: 'https://plane.example.test/i/3/',
    };
    const e = cache.get('FIX-3');
    expect(e).toMatchObject({
      kind: 'known',
      info: {
        state: { name: 'In Progress', group: 'started' },
        url: 'https://plane.example.test/i/3/',
      },
    });
    await tick();
    expect(calls).toEqual([]);
  });

  // ── [PCODE-36 | S07 | v0.1.0] board refs: zero requests ──
  it('answers refs on the board from the store without a request', async () => {
    const { cache, calls } = setup();
    const e = cache.get('FIX-2');
    expect(e).toMatchObject({ kind: 'known', info: { title: 'Add the greeting function' } });
    expect(e.kind === 'known' && e.info.state.name).toBe('In Progress');
    await tick();
    expect(calls).toEqual([]);
    expect(cache.requests).toBe(0);
  });

  it('fetches an unknown ref once, batched, and caches it for the TTL', async () => {
    const { cache, calls, advance } = setup();
    let changed = 0;
    cache.onDidChange(() => {
      changed++;
    });
    expect(cache.get('FIX-9')).toEqual({ kind: 'pending' });
    expect(cache.get('FIX-9')).toEqual({ kind: 'pending' });
    expect(cache.get('FIX-10')).toEqual({ kind: 'pending' });
    await tick();
    expect(calls).toEqual(['states', 'issue:FIX-9', 'issue:FIX-10']);
    expect(changed).toBe(1);
    const e = cache.get('FIX-9');
    expect(e).toMatchObject({
      kind: 'known',
      info: { title: 'Fetched FIX-9', state: { name: 'Done', group: 'completed' } },
    });
    expect(e.kind === 'known' && e.info.url).toBe(
      'https://plane.example.test/ws/projects/p1/issues/id-FIX-9/',
    );
    cache.get('FIX-9');
    await tick();
    expect(calls).toHaveLength(3);
    advance(TTL_MS + 1);
    expect(cache.get('FIX-9').kind).toBe('known'); // stale answer served while the refresh is queued
    await tick();
    expect(calls).toEqual(['states', 'issue:FIX-9', 'issue:FIX-10', 'issue:FIX-9']);
  });

  it('marks a 404 as missing and other failures as offline', async () => {
    const a = setup({ fail: 'Plane GET /issues/FIX-9/ failed (404).' });
    a.cache.get('FIX-9');
    await tick();
    expect(a.cache.get('FIX-9')).toEqual({ kind: 'missing' });
    const b = setup({ fail: 'fetch failed' });
    b.cache.get('FIX-9');
    await tick();
    expect(b.cache.get('FIX-9')).toEqual({ kind: 'offline' });
  });

  it('requests nothing offline or without a key', async () => {
    const off = setup({ online: false });
    off.store.state.lastRefresh = new Date(); // has been online once, now offline
    off.store.setOnline(false, 'fetch failed');
    off.cache.get('FIX-9');
    await tick();
    expect(off.calls).toEqual([]);
    expect(off.cache.get('FIX-9')).toEqual({ kind: 'offline' });
    const noKey = setup({ key: false });
    noKey.cache.get('FIX-9');
    await tick();
    expect(noKey.calls).toEqual([]);
    expect(noKey.cache.get('FIX-9')).toEqual({ kind: 'offline' });
    off.cache.invalidate();
    expect(off.cache.get('FIX-9')).toEqual({ kind: 'pending' });
  });
});
