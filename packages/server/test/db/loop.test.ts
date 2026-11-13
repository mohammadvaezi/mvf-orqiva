// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-464 | S15 | v0.1.0] The active task follows its state: moved out of In Progress in the portal, it is no longer active in VS Code ──
// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-102 | S15 | v0.1.0] Port the engine's loop to the server: sync, start, status, note, done ──
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const LONG =
  'Port the loop: start, progress, status and done keep the engine rules. Check: the loop tests pass.';

describe.skipIf(!hasDatabase)('the development loop (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ws = '';
  let project = '';
  let token = '';
  const W = (p: string): string => '/api/workspaces/' + ws + p;
  const CLIENT = 'laptop-7:/home/ada/app';

  /** Calls the API the way the CLI does: with a Bearer token, no cookie. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T names the shape of the answer
  const cli = async <T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> => {
    const res = await fetch(t.base + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
  };
  const item = async (title: string, description = LONG): Promise<string> =>
    (
      await t.call<{ ref: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title,
        description,
      })
    ).body.ref;
  const stateOf = async (ref: string): Promise<string> =>
    (await cli<{ task: { state: string } }>('GET', W('/loop/tasks/' + ref))).body.task.state;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    ws = ada.workspaceId;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  describe('personal API tokens', () => {
    it('are traded once for email and password, then work instead of a cookie', async () => {
      const bad = await fetch(t.base + '/auth/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'cli', email: ada.email, password: 'wrong password' }),
      });
      expect(bad.status).toBe(401);
      const res = await fetch(t.base + '/auth/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'laptop cli',
          email: ada.email,
          password: 'a test password 1',
        }),
      });
      const body = (await res.json()) as { token: string; id: string };
      expect(res.status).toBe(201);
      // [PCODE-181 | S15 | v0.1.0] personal tokens carry the prefix of their kind
      expect(body.token).toMatch(/^orq_pat_[\w-]{43}$/);
      token = body.token;
      expect((await cli<{ user: { name: string } }>('GET', '/auth/me')).body.user.name).toBe('Ada');
      const stored = await inSystem(t.db.pool, async (c) =>
        (await c.query<{ token_hash: string }>('SELECT token_hash FROM api_tokens')).rows.map(
          (r) => r.token_hash,
        ),
      );
      expect(stored.join()).not.toContain(token);
    });

    it('stop working once revoked', async () => {
      const extra = (
        await cli<{ id: string; token: string }>('POST', '/auth/tokens', { name: 'throwaway' })
      ).body;
      const listed = (await cli<{ name: string }[]>('GET', '/auth/tokens')).body.map((x) => x.name);
      expect(listed).toEqual(['laptop cli', 'throwaway']);
      expect((await cli('DELETE', '/auth/tokens/' + extra.id)).status).toBe(200);
      const res = await fetch(t.base + '/auth/me', {
        headers: { authorization: 'Bearer ' + extra.token },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('start', () => {
    it('refuses a task without a real description', async () => {
      const ref = await item('Thin', 'too short');
      const r = await cli<{ error: { message: string } }>('POST', W('/loop/start'), {
        ref,
        client: CLIENT,
      });
      expect(r.status).toBe(409);
      expect(r.body.error.message).toContain('has no usable description');
    });

    it('moves the task to In Progress, assigns it, puts it into the active sprint and gives the fingerprint', async () => {
      const sp = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
          name: 'Sprint 1',
        })
      ).body;
      await t.call(ada, 'POST', W('/sprints/' + sp.id + '/start'));
      const ref = await item('Write the loop');
      const r = await cli<{
        fingerprint: { marker: string; sprint: string };
        task: { state: string };
        resumed: boolean;
      }>('POST', W('/loop/start'), { ref, client: CLIENT, clientSession: 'abcdef1234' });
      expect(r.status).toBe(200);
      expect(r.body.task.state).toBe('In Progress');
      expect(r.body.fingerprint.marker).toBe('[' + ref + ' | S01 | v0.1.0] Write the loop');
      expect(r.body.resumed).toBe(false);
      const items = (
        await t.call<{ ref: string; assigneeId: string; sprintId: string }[]>(
          ada,
          'GET',
          W('/projects/' + project + '/items'),
        )
      ).body;
      expect(items.find((i) => i.ref === ref)).toMatchObject({
        assigneeId: ada.id,
        sprintId: sp.id,
      });
      const comments = (
        await t.call<{ body: string }[]>(
          ada,
          'GET',
          W(
            '/items/' +
              (await cli<{ task: { id: string } }>('GET', W('/loop/tasks/' + ref))).body.task.id +
              '/comments',
          ),
        )
      ).body;
      expect(comments[0]?.body).toContain(
        '**Started** by Ada on ' + CLIENT + ' (session abcdef12)',
      );
    });

    it('resumes the same task, and refuses another while one is active on this client', async () => {
      const active = (
        await cli<{ active: { task: { ref: string } } }>(
          'GET',
          W('/loop/active?client=' + encodeURIComponent(CLIENT)),
        )
      ).body.active;
      const again = await cli<{ resumed: boolean }>('POST', W('/loop/start'), {
        ref: active.task.ref,
        client: CLIENT,
      });
      expect(again.body.resumed).toBe(true);
      const other = await item('Something else');
      const r = await cli<{ error: { message: string } }>('POST', W('/loop/start'), {
        ref: other,
        client: CLIENT,
      });
      expect(r.status).toBe(409);
      expect(r.body.error.message).toContain(active.task.ref + ' is still active');
      // another client (another machine or repository) may work on something else
      expect(
        (await cli('POST', W('/loop/start'), { ref: other, client: 'desktop:/repo' })).status,
      ).toBe(200);
      await cli('POST', W('/loop/status'), { ref: other, state: 'todo', note: 'parked' });
    });
  });

  describe('progress, status and done', () => {
    it('records edits and commits, and moves to Test when tests turn green', async () => {
      const active = (
        await cli<{ active: { task: { ref: string; id: string } } }>(
          'GET',
          W('/loop/active?client=' + encodeURIComponent(CLIENT)),
        )
      ).body.active;
      expect(
        (
          await cli('POST', W('/loop/progress'), {
            client: CLIENT,
            kind: 'edit',
            files: ['src/loop.ts', 'test/loop.test.ts'],
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await cli('POST', W('/loop/progress'), {
            client: CLIENT,
            kind: 'commit',
            commit: 'a1b2c3d',
          })
        ).status,
      ).toBe(200);
      await cli('POST', W('/loop/progress'), {
        client: CLIENT,
        kind: 'tests',
        command: 'npm test',
        green: false,
      });
      expect(await stateOf(active.task.ref)).toBe('In Progress');
      await cli('POST', W('/loop/progress'), {
        client: CLIENT,
        kind: 'tests',
        command: 'npm test',
        green: true,
      });
      expect(await stateOf(active.task.ref)).toBe('Test');
      const bodies = (
        await t.call<{ body: string }[]>(ada, 'GET', W('/items/' + active.task.id + '/comments'))
      ).body.map((c) => c.body);
      expect(bodies).toEqual(
        expect.arrayContaining([
          '**Working** — edited: `src/loop.ts`, `test/loop.test.ts`',
          '**Commit** `a1b2c3d` (' + active.task.ref + ')',
          '**Tests failed** — `npm test`',
          '**Tests green** — `npm test`',
        ]),
      );
    });

    it('refuses done without fingerprinted files, then finishes to Review and ends the session', async () => {
      const active = (
        await cli<{ active: { task: { ref: string } } }>(
          'GET',
          W('/loop/active?client=' + encodeURIComponent(CLIENT)),
        )
      ).body.active;
      const ref = active.task.ref;
      const bare = await cli<{ error: { message: string } }>('POST', W('/loop/done'), {
        ref,
        files: [],
      });
      expect(bare.status).toBe(409);
      expect(bare.body.error.message).toContain('No file carries the fingerprint [' + ref);
      const r = await cli<{ state: string; files: number }>('POST', W('/loop/done'), {
        ref,
        commit: 'b2c3d4e',
        files: [
          { path: 'src/loop.ts', line: 1, kind: 'header' },
          { path: 'src/loop.ts', line: 40, kind: 'block' },
        ],
      });
      expect(r.body).toEqual({ state: 'Review', files: 1 });
      expect(
        (
          await cli<{ active: unknown }>(
            'GET',
            W('/loop/active?client=' + encodeURIComponent(CLIENT)),
          )
        ).body.active,
      ).toBeNull();
    });

    it('finishes to Done when the project does not review, and a forced done needs no files', async () => {
      const rules = await t.call<{
        loopRules: { reviewBeforeDone: boolean; autoTestState: boolean };
      }>(ada, 'PATCH', W('/projects/' + project), {
        loopRules: { reviewBeforeDone: false },
      });
      expect(rules.body.loopRules).toMatchObject({ reviewBeforeDone: false, autoTestState: true });
      const ref = await item('A check, no code');
      await cli('POST', W('/loop/start'), { ref, client: CLIENT });
      const r = await cli<{ state: string }>('POST', W('/loop/done'), {
        ref,
        files: [],
        force: true,
      });
      expect(r.body.state).toBe('Done');
      expect(
        (
          await cli<{ error: { message: string } }>('POST', W('/loop/start'), {
            ref,
            client: CLIENT,
          })
        ).body.error.message,
      ).toContain('is Done');
    });

    it('lists open tasks, active sprint first', async () => {
      const open = (
        await cli<{ ref: string; sprintStatus: string | null }[]>(
          'GET',
          W('/loop/open?project=app'),
        )
      ).body;
      expect(open.length).toBeGreaterThan(0);
      expect(open.every((o) => o.ref.startsWith('APP-'))).toBe(true);
      const firstBacklog = open.findIndex((o) => o.sprintStatus === null);
      const lastActive = open.map((o) => o.sprintStatus).lastIndexOf('active');
      if (firstBacklog >= 0 && lastActive >= 0) expect(lastActive).toBeLessThan(firstBacklog);
    });

    it('answers a reference it does not know with 404, and a guest may not start work', async () => {
      expect((await cli('GET', W('/loop/tasks/APP-999'))).status).toBe(404);
      const gus = await t.signup('Gus');
      await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
      await t.call(ada, 'POST', W('/projects/' + project + '/guests'), { userId: gus.id });
      expect(
        (await t.call(gus, 'POST', W('/loop/start'), { ref: 'APP-1', client: 'x' })).status,
      ).toBe(403);
    });
  });

  // ── [PCODE-462 | S15 | v0.1.0] tasks in plan order; the sprint follows its first task ──
  describe('plan order and sprints', () => {
    it('waits for the task before, and starts and completes the sprints with the work', async () => {
      const ord = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'ORD', name: 'Order' })
      ).body.id;
      const sprint = async (name: string): Promise<string> =>
        (await t.call<{ id: string }>(ada, 'POST', W('/projects/' + ord + '/sprints'), { name }))
          .body.id;
      const s1 = await sprint('Sprint 01 - Foundation');
      const s2 = await sprint('Sprint 02 - Data');
      const task = async (title: string, sprintId: string): Promise<{ id: string; ref: string }> =>
        (
          await t.call<{ id: string; ref: string }>(ada, 'POST', W('/projects/' + ord + '/items'), {
            title,
            description: LONG,
            sprintId,
          })
        ).body;
      const a = await task('Scaffold the repo', s1);
      const b = await task('Scaffold the API', s1);
      const c = await task('Add the database', s2);
      for (const [x, y] of [
        [a, b],
        [b, c],
      ] as const)
        await t.call(ada, 'POST', W('/projects/' + ord + '/dependencies'), {
          predecessorId: x.id,
          successorId: y.id,
        });
      const statusOf = async (id: string): Promise<string> =>
        (
          await t.call<{ id: string; status: string }[]>(
            ada,
            'GET',
            W('/projects/' + ord + '/sprints'),
          )
        ).body.find((x) => x.id === id)?.status ?? '';

      const early = await cli<{ error: { message: string } }>('POST', W('/loop/start'), {
        ref: b.ref,
        client: 'ord:/repo',
      });
      expect(early.status).toBe(409);
      expect(early.body.error.message).toBe(
        b.ref + ' waits for ' + a.ref + ' (Scaffold the repo). Finish ' + a.ref + ' first.',
      );

      expect(await statusOf(s1)).toBe('planned');
      expect(
        (await cli('POST', W('/loop/start'), { ref: a.ref, client: 'ord:/repo' })).status,
      ).toBe(200);
      expect(await statusOf(s1)).toBe('active');
      // handed on for checking counts as finished: the next one may start
      await cli('POST', W('/loop/status'), { ref: a.ref, state: 'review' });
      expect(
        (await cli('POST', W('/loop/start'), { ref: b.ref, client: 'ord:/repo' })).status,
      ).toBe(200);
      await cli('POST', W('/loop/status'), { ref: b.ref, state: 'review' });
      // the first task of the next sprint: Sprint 01 has nothing open, so it completes and Sprint 02 starts
      expect(
        (await cli('POST', W('/loop/start'), { ref: c.ref, client: 'ord:/repo' })).status,
      ).toBe(200);
      expect(await statusOf(s1)).toBe('completed');
      expect(await statusOf(s2)).toBe('active');
      await cli('POST', W('/loop/status'), { ref: c.ref, state: 'todo' });
    });
  });

  // ── [PCODE-464 | S15 | v0.1.0] a task moved on in the portal is no longer the active one ──
  describe('the session follows the task', () => {
    it('ends when the task is moved out of In Progress on the board, so the next one can start', async () => {
      const proj = (
        await t.call<{ id: string; states: { id: string; name: string }[] }>(
          ada,
          'POST',
          W('/projects'),
          { key: 'SES', name: 'Sessions' },
        )
      ).body;
      const states = (
        await t.call<{ states: { id: string; name: string }[] }>(
          ada,
          'GET',
          W('/projects/' + proj.id),
        )
      ).body.states;
      const mk = async (title: string) =>
        (
          await t.call<{ id: string; ref: string }>(
            ada,
            'POST',
            W('/projects/' + proj.id + '/items'),
            { title, description: LONG },
          )
        ).body;
      const one = await mk('First');
      const two = await mk('Second');
      expect((await cli('POST', W('/loop/start'), { ref: one.ref, client: 'pc:/s' })).status).toBe(
        200,
      );
      expect((await cli('POST', W('/loop/start'), { ref: two.ref, client: 'pc:/s' })).status).toBe(
        409,
      );
      const review = states.find((x) => x.name === 'Review')?.id;
      await t.call(ada, 'PATCH', W('/items/' + one.id), { stateId: review });
      expect((await cli('POST', W('/loop/start'), { ref: two.ref, client: 'pc:/s' })).status).toBe(
        200,
      );
      await cli('POST', W('/loop/status'), { ref: two.ref, state: 'todo' });
    });
  });

  // ── [PCODE-466 | S15 | v0.1.0] the work record: Claude Code's tokens on the task, priced, with the time ──
  describe('the work record of a task', () => {
    it('prices the usage of the session, keeps what arrives after done, and shows time and version', async () => {
      const proj = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'WRK', name: 'Work' })
      ).body;
      const task = (
        await t.call<{ id: string; ref: string }>(
          ada,
          'POST',
          W('/projects/' + proj.id + '/items'),
          {
            title: 'Scaffold the API',
            description: LONG,
          },
        )
      ).body;
      const c = 'pc:/work';
      expect((await cli('POST', W('/loop/start'), { ref: task.ref, client: c })).status).toBe(200);
      const use = (n: number) =>
        cli('POST', W('/loop/progress'), {
          client: c,
          kind: 'usage',
          model: 'claude-opus-5-5[1m]',
          tokensIn: 1000 * n,
          tokensOut: 500 * n,
          cacheRead: 10000 * n,
          cacheWrite: 2000 * n,
        });
      expect((await use(1)).status).toBe(200);
      await cli('POST', W('/loop/status'), { ref: task.ref, state: 'review' });
      // the turn that ran orq done reports afterwards: it still counts, on the same run
      expect((await use(1)).status).toBe(200);
      type Work = {
        versions: string[];
        time: {
          minutes: number;
          running: boolean;
          sessions: { by: string; ended: string | null }[];
        };
        ai: {
          runs: {
            agent: string;
            source: string;
            model: string;
            status: string;
            tokensIn: number;
            costUsd: number;
          }[];
          tokensIn: number;
          tokensOut: number;
          cacheRead: number;
          cacheWrite: number;
          costUsd: number;
          costEur: number;
          models: string[];
        };
      };
      const w = (await t.call<Work>(ada, 'GET', W('/items/' + task.id + '/work'))).body;
      // 1000 in at $4, 500 out at $20, 10000 cache reads at $0.20, 2000 cache writes at $5 per million: $0.026, twice
      expect(w.ai).toMatchObject({
        tokensIn: 2000,
        tokensOut: 1000,
        cacheRead: 20000,
        cacheWrite: 4000,
        models: ['claude-opus-5-5'],
      });
      expect(w.ai.costUsd).toBeCloseTo(0.052, 6);
      expect(w.ai.costEur).toBeGreaterThan(0);
      expect(w.ai.runs).toEqual([
        expect.objectContaining({
          agent: 'Developer agent',
          source: 'local',
          model: 'claude-opus-5-5',
          status: 'succeeded',
          tokensIn: 2000,
        }),
      ]);
      expect(w.versions).toEqual(['0.1.0']);
      expect(w.time.running).toBe(false);
      expect(w.time.sessions).toEqual([expect.objectContaining({ by: 'Ada', ended: 'Review' })]);
    });
  });
});
