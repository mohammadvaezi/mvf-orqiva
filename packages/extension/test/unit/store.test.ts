// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-11 | S02 | v0.1.0] Add the state store with a .plane file watcher and change events ──
//    Why:  the store reacts to engine writes within 500 ms, never writes itself, and loads without network.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSprintsMd, sprintCode } from '../../src/state/sprintsMd';
import { Store } from '../../src/state/store';
import { nodeBackend } from '../../src/state/watcher';

const FIXTURE = path.resolve(__dirname, '..', 'fixtures', 'workspace');

function waitFor<T>(fn: () => T | undefined, ms = 500): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      const v = fn();
      if (v !== undefined) resolve(v);
      else if (Date.now() - started > ms) reject(new Error(`not observed within ${ms} ms`));
      else setTimeout(tick, 10);
    };
    tick();
  });
}

describe('Store', () => {
  let root: string;
  let store: Store;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-store-'));
    fs.mkdirSync(path.join(root, '.plane', 'state'), { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURE, '.plane', 'project.json'),
      path.join(root, '.plane', 'project.json'),
    );
    fs.copyFileSync(
      path.join(FIXTURE, '.plane', 'sprints.md'),
      path.join(root, '.plane', 'sprints.md'),
    );
    store = new Store();
  });
  afterEach(() => {
    store.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ── [PCODE-11 | S02 | v0.1.0] load() populates from files without any client ──
  it('loads link, sprints and active from files with zero network calls', () => {
    const keys = store.load(root);
    expect(keys).toContain('link');
    expect(store.state.link?.identifier).toBe('FIX');
    expect(store.state.active).toBeNull();
    expect(store.state.sprints).toHaveLength(2);
    expect(store.state.sprints[0]?.isToday).toBe(true);
    expect(store.state.sprints[0]?.items[1]).toMatchObject({
      ref: 'FIX-2',
      state: { name: 'In Progress', group: 'started' },
      done: false,
    });
    expect(store.state.sprints[0]?.source).toBe('file');
    expect(store.state.online).toBe(false);
  });

  it('fires onDidChange(["active"]) within 500 ms of a new active.json, and null on delete', async () => {
    store.load(root);
    store.watch(nodeBackend, 50);
    const seen: string[][] = [];
    store.onDidChange((k) => seen.push(k));
    fs.copyFileSync(
      path.join(FIXTURE, '.plane', 'state', 'active.json'),
      path.join(root, '.plane', 'state', 'active.json'),
    );
    await waitFor(() => (seen.some((k) => k.includes('active')) ? true : undefined));
    expect(store.state.active?.task).toBe('FIX-2');
    seen.length = 0;
    fs.unlinkSync(path.join(root, '.plane', 'state', 'active.json'));
    await waitFor(() => (seen.some((k) => k.includes('active')) ? true : undefined));
    expect(store.state.active).toBeNull();
  });

  // ── [PCODE-11 | S02 | v0.1.0] watcher_never_writes (criticals #3) ──
  it('watcher_never_writes: the tree is unchanged by load, watch and events; sources call no fs writer', async () => {
    const snapshot = (): string =>
      JSON.stringify(
        fs
          .readdirSync(root, { recursive: true })
          .map((f) => {
            const full = path.join(root, String(f));
            return [String(f), fs.statSync(full).isFile() ? fs.readFileSync(full, 'utf8') : 'dir'];
          })
          .sort(),
      );
    store.load(root);
    store.watch(nodeBackend, 50);
    store.onDidChange(() => undefined);
    // the "engine" writes one file; the store must only read
    fs.writeFileSync(
      path.join(root, '.plane', 'state', 'queue.jsonl'),
      '{"id":"a","method":"POST","path":"/x"}\n',
    );
    const after = snapshot();
    await waitFor(() => (store.state.queueLength === 1 ? true : undefined));
    await new Promise((r) => setTimeout(r, 120));
    expect(snapshot()).toBe(after);
    for (const f of ['store.ts', 'watcher.ts', 'sprintsMd.ts']) {
      const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'state', f), 'utf8');
      expect(src, f).not.toMatch(/writeFile|appendFile|unlink|rmSync|renameSync|mkdir/);
    }
  });
});

describe('parseSprintsMd', () => {
  it('parses headers, goals, items and sprint codes', () => {
    const s = parseSprintsMd(fs.readFileSync(path.join(FIXTURE, '.plane', 'sprints.md'), 'utf8'));
    expect(s.map((x) => x.code)).toEqual(['S01', 'S02']);
    expect(s[0]).toMatchObject({
      name: 'Sprint 01 - Foundation',
      date: '2026-01-01',
      done: 1,
      total: 2,
      isToday: true,
    });
    expect(s[0]?.goal).toBe('The fixture app starts and one test passes.');
    expect(s[0]?.items[0]).toEqual({
      ref: 'FIX-1',
      title: 'Create the sample module',
      state: 'Done',
      priority: 'high',
      done: true,
    });
    expect(s[1]?.isToday).toBe(false);
    expect(sprintCode('Test Sprint 3 - x')).toBe('S03');
    expect(parseSprintsMd('# nothing')).toEqual([]);
  });
});
