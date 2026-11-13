// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
// ── [PCODE-106 | S15 | v0.1.0] Add the team activity feed panel to VS Code ──
//    Why:  the exit check of PCODE-105 without a VS Code window: the extension's own store, board source
//          (our WebSocket client, the shared LiveClient) and loop commands against the real server, in a
//          folder linked with pe. The tree's board must follow changes made elsewhere, live and without a
//          timer, and a task started from VS Code must be the orq loop's active task.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnExec } from '../../../cli/src/install/exec.js';
import { run } from '../../../cli/src/run.js';
import { LoopCommands } from '../../../extension/src/server/loopCommands';
import { ActivityFeed } from '../../../extension/src/server/feed';
import { BoardSource } from '../../../extension/src/state/boardSource';
import { Store } from '../../../extension/src/state/store';
import { nodeBackend } from '../../../extension/src/state/watcher';
import { startTestApp, type Person, type TestApp } from '../db/apphelper.js';
import { hasDatabase } from '../db/testdb.js';

const until = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('not observed within ' + String(ms) + ' ms');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe.skipIf(!hasDatabase)(
  'the VS Code extension on Orqiva (PostgreSQL)',
  { timeout: 20_000 },
  () => {
    let t: TestApp;
    let ada: Person;
    let repo = '';
    let home = '';
    let project = '';
    let store: Store;
    let source: BoardSource;
    let engine: LoopCommands;
    const feed = new ActivityFeed();
    const refs: Record<string, string> = {};
    const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
    const itemOf = (ref: string) =>
      store.state.sprints.flatMap((s) => s.items).find((i) => i.ref === ref);

    beforeAll(async () => {
      t = await startTestApp({ live: true });
      ada = await t.signup('Ada');
      project = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'EXT', name: 'Extension' })
      ).body.id;
      const sprint = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
          name: 'Sprint one',
          startDate: '2026-10-01',
          endDate: '2026-10-14',
        })
      ).body.id;
      await t.call(ada, 'POST', W('/sprints/' + sprint + '/start'));
      for (const [key, title] of [
        ['a', 'Show the board live'],
        ['b', 'Remove the poller'],
      ] as const) {
        const r = await t.call<{ ref: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
          title,
          description:
            'What: ' + title + '. Why: the extension follows Orqiva. Check: the e2e test.',
          ...(key === 'a' ? { sprintId: sprint } : {}),
        });
        refs[key] = r.body.ref;
      }
      const token = (
        await t.call<{ token: string }>(ada, 'POST', '/auth/tokens', { name: 'vscode' })
      ).body.token;

      repo = mkdtempSync(join(tmpdir(), 'pe-ext-repo-'));
      home = mkdtempSync(join(tmpdir(), 'pe-ext-home-'));
      for (const args of [
        ['init', '-q', '-b', 'main'],
        ['config', 'user.email', 'ada@example.test'],
        ['config', 'user.name', 'Ada'],
        ['config', 'commit.gpgsign', 'false'],
        ['config', 'core.autocrlf', 'false'],
      ])
        execFileSync('git', args, { cwd: repo });
      const deps = { exec: spawnExec, loop: { cwd: repo, home, hostname: hostname(), env: {} } };
      expect((await run(['login', '--server', t.base, '--token', token], deps)).code).toBe(0);
      expect((await run(['link', 'EXT'], deps)).code).toBe(0);

      // what activate() builds, minus VS Code
      store = new Store();
      store.load(repo);
      store.watch(nodeBackend, 20);
      source = new BoardSource({
        store,
        home,
        fetchPlane: () => Promise.resolve(null),
        onEvent: (e) => {
          feed.add(e);
        },
        onHistory: (events) => {
          feed.reset(events);
        },
      });
      engine = new LoopCommands(
        () => Promise.reject(new Error('the engine is not used on Orqiva')),
        {
          root: () => store.state.root,
          deps: { home, hostname: hostname(), env: {} },
        },
      );
    }, 60_000);

    afterAll(async () => {
      source.dispose();
      store.dispose();
      await t.stop();
      rmSync(repo, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    });

    it('reads the folder as an Orqiva project and draws the board from the server', async () => {
      expect(store.state.link).toMatchObject({
        identifier: 'EXT',
        name: 'Extension',
        server: t.base,
      });
      source.start();
      await until(() => store.state.online && store.state.sprints.length > 0);
      expect(store.state.sprints.map((s) => [s.name, s.code, s.isToday])).toEqual([
        ['Sprint one', 'S01', true],
        ['Backlog', 'S00', false],
      ]);
      expect(itemOf(refs['a'] ?? '')?.state.name).toBe('Backlog');
    });

    it('follows a change made in the web app, live', async () => {
      const id = itemOf(refs['b'] ?? '')?.id ?? '';
      await t.call(ada, 'PATCH', W('/items/' + id), { title: 'Remove the poller for good' });
      await until(() => itemOf(refs['b'] ?? '')?.title === 'Remove the poller for good');
    });

    it('starts a task from VS Code as the orq loop’s active task, and the board shows it', async () => {
      const r = await engine.start(refs['a'] ?? '');
      expect(r).toMatchObject({
        ref: refs['a'],
        to: 'In Progress',
        fingerprint: '[' + String(refs['a']) + ' | S01 | v0.1.0] Show the board live',
      });
      await until(() => store.state.active?.task === refs['a']);
      await until(() => itemOf(refs['a'] ?? '')?.state.name === 'In Progress');
      const list = await engine.list();
      expect(list.active?.ref).toBe(refs['a']);
      expect(list.sprints.map((x) => [x.name, x.items.map((it) => it.ref)])).toEqual([
        ['Sprint one', [refs['a']]],
        ['Backlog', [refs['b']]],
      ]);
    });

    it('finishes it with fingerprints, and the board and the active task follow', async () => {
      mkdirSync(join(repo, 'src'));
      writeFileSync(
        join(repo, 'src', 'board.ts'),
        '// ── [' +
          String(refs['a']) +
          ' | S01 | v0.1.0] Show the board live ──\nexport const live = true;\n',
      );
      const done = await engine.done(refs['a'] ?? '');
      expect(done).toMatchObject({ ref: refs['a'], state: 'Review', files: 1 });
      expect(done.commit).toMatch(/^[0-9a-f]{9}$/);
      await until(() => store.state.active === null);
      await until(() => itemOf(refs['a'] ?? '')?.state.name === 'Review');
      const shown = await engine.show(refs['a'] ?? '');
      expect(shown.files).toEqual([{ file: 'src/board.ts', line: 1, kind: 'header' }]);
      expect(shown.comments.map((c) => c.text.split(' ')[0])).toContain('**Review**');
    });

    // [PCODE-106 | S15 | v0.1.0] the Activity view's feed: the history it opens with, then live
    it('feeds the activity view: the history, then a teammate’s work as it happens', async () => {
      const texts = (): string[] => feed.entries().map((e) => e.text);
      expect(texts()).toContain('Ada created ' + String(refs['a']) + ' Show the board live');
      const bob = await t.signup('Bob');
      await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
      const id = itemOf(refs['b'] ?? '')?.id ?? '';
      await t.call(bob, 'POST', W('/items/' + id + '/comments'), { body: 'On it' });
      await until(
        () =>
          texts()[0] === 'Bob commented on ' + String(refs['b']) + ' Remove the poller for good',
      );
      expect(feed.entries()[0]).toMatchObject({ actor: 'Bob', actorKind: 'user', itemId: id });
      const seqs = feed.entries().map((e) => e.sequence);
      expect(new Set(seqs).size).toBe(seqs.length);
    });

    it('passes the server’s refusal on as a readable error', async () => {
      await expect(engine.start('EXT-999')).rejects.toThrow(/not found|No task/i);
    });
  },
);
