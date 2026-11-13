// ── [PCODE-459 | S15 | v0.1.0] Planning in VS Code locks the project in the portal: banner on every tab, conflicting AI planning refused both ways ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
// ── [PCODE-456 | S15 | v0.1.0] Planning in VS Code shows live in the portal: local AI runs, hook steps, plan documents synced ──
//    Why:  against a fake server: the planning run is opened for the hooks and ended with what Claude left
//          (a valid plan, a plan with errors, no plan); the plan documents land under "Project plan" and
//          are updated in place, a page changed in the portal is kept; the hooks of a folder are brought
//          up to date so that they report every tool.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { endPlanningRun, PlanningConflict, startPlanningRun } from '../../src/plan/portal';
import {
  PLAN_FOLDER,
  openRunId,
  planMarkdown,
  refreshHooks,
  syncPlanDocs,
  type PlanTarget,
} from '../../src/server/planSync';
import { RUN_TOOLS } from '../../../cli/src/loop/hooks';

const SERVER = 'http://orqiva.test:8490';
const W = '/api/workspaces/w1';

interface Page {
  id: string;
  parentId: string | null;
  kind: string;
  title: string;
  version: number;
  body: string;
}

function fakeServer() {
  const pages: Page[] = [];
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const runs: Record<string, { status: string; summary?: string; steps: string[] }> = {};
  let n = 0;
  const fetchImpl = ((url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const p = url.slice(SERVER.length);
    const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    calls.push({ method, path: p, body });
    const json = (status: number, v: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(v), { status }));
    const full = (x: Page) => ({ page: x, body: x.body });
    if (p === W + '/projects/p1/docs' && method === 'GET') return json(200, pages);
    if (p === W + '/projects/p1/docs' && method === 'POST') {
      const x: Page = {
        id: 'pg' + String(++n),
        parentId: (body['parentId'] as string | undefined) ?? null,
        kind: (body['kind'] as string | undefined) ?? 'page',
        title: body['title'] as string,
        version: 1,
        body: (body['body'] as string | undefined) ?? '',
      };
      pages.push(x);
      return json(201, full(x));
    }
    const page = /\/docs\/([^/]+)$/.exec(p)?.[1];
    const x = pages.find((y) => y.id === page);
    if (x && method === 'GET') return json(200, full(x));
    if (x && method === 'PUT') {
      if (body['baseVersion'] !== x.version) return json(409, { error: { message: 'stale' } });
      x.body = body['body'] as string;
      x.version++;
      return json(200, full(x));
    }
    if (p === W + '/projects/p1' && method === 'PATCH') return json(200, {});
    if (p === W + '/projects/p1/local-runs') {
      const id = 'run' + String(++n);
      runs[id] = { status: 'running', steps: [] };
      return json(201, { id });
    }
    const run = /\/agent-runs\/([^/]+)\/(steps|finish)$/.exec(p);
    const r = run?.[1] ? runs[run[1]] : undefined;
    if (r) {
      if (run?.[2] === 'steps') r.steps.push(body['text'] as string);
      else Object.assign(r, { status: body['status'], summary: body['summary'] });
      return json(201, {});
    }
    return json(404, { error: { message: 'no route ' + p } });
  }) as unknown as typeof fetch;
  return { pages, calls, runs, fetchImpl };
}

let root = '';
let home = '';
const put = (rel: string, text: string): void => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const PLAN = {
  version: '0.1.0',
  sprints: [
    {
      name: 'Sprint 01 - Foundation',
      date: day(3),
      goal: 'The app runs.',
      items: [
        {
          title: 'Scaffold the repo',
          label: 'chore',
          priority: 'high',
          description_md: 'Set up the repository layout, the toolchain and the test runner.',
          acceptance: ['npm test passes', 'the app starts'],
        },
      ],
    },
  ],
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-sync-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-home-'));
  put(
    '.orqiva/project.json',
    JSON.stringify({
      server: SERVER,
      workspaceId: 'w1',
      projectId: 'p1',
      projectKey: 'MARK',
      projectName: 'Marketspider',
    }),
  );
  fs.mkdirSync(path.join(home, '.orqiva'));
  fs.writeFileSync(
    path.join(home, '.orqiva', 'credentials.json'),
    JSON.stringify({ servers: { [SERVER]: { token: 'orq_t', email: 'a@x.test' } } }),
  );
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

const target = (): PlanTarget => ({
  root,
  server: SERVER,
  token: 'orq_t',
  workspaceId: 'w1',
  projectId: 'p1',
});

describe('the plan documents in the portal', () => {
  it('go under Project plan, as the project description too, and are updated in place', async () => {
    const s = fakeServer();
    put('.orqiva/description/description.md', '# Project description\n\nA PIM system.\n');
    put('.orqiva/architecture.md', '# Architecture\n\nFastAPI.\n');
    const first = await syncPlanDocs(target(), s.fetchImpl);
    expect(first.created).toEqual(['Description', 'Architecture']);
    const folder = s.pages.find((p) => p.title === PLAN_FOLDER);
    expect(folder).toMatchObject({ kind: 'folder', parentId: null });
    expect(s.pages.filter((p) => p.parentId === folder?.id).map((p) => p.title)).toEqual([
      'Description',
      'Architecture',
    ]);
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      description: '# Project description\n\nA PIM system.\n',
    });

    put('.orqiva/architecture.md', '# Architecture\n\nFastAPI and Celery.\n');
    put('.orqiva/plan.json', JSON.stringify(PLAN));
    const second = await syncPlanDocs(target(), s.fetchImpl);
    expect(second).toMatchObject({ created: ['Sprint plan'], updated: ['Architecture'], kept: [] });
    expect(s.pages.filter((p) => p.title === 'Architecture')).toHaveLength(1);
    expect(s.pages.find((p) => p.title === 'Sprint plan')?.body).toBe(planMarkdown(PLAN as never));
    // nothing changed: nothing is written
    const writes = s.calls.filter((c) => c.method === 'PUT' || c.method === 'POST').length;
    expect(await syncPlanDocs(target(), s.fetchImpl)).toMatchObject({ created: [], updated: [] });
    expect(s.calls.filter((c) => c.method === 'PUT' || c.method === 'POST')).toHaveLength(writes);
  });

  it('keeps a page someone changed in the portal', async () => {
    const s = fakeServer();
    put('.orqiva/rules.md', 'Use ruff.');
    await syncPlanDocs(target(), s.fetchImpl);
    const page = s.pages.find((p) => p.title === 'Rules');
    if (!page) throw new Error('no page');
    page.body = 'Use ruff. And black, says the team lead.';
    page.version++;
    put('.orqiva/rules.md', 'Use ruff and mypy.');
    const r = await syncPlanDocs(target(), s.fetchImpl);
    expect(r.kept).toEqual(['Rules']);
    expect(page.body).toBe('Use ruff. And black, says the team lead.');
  });
});

describe('the planning run in the portal', () => {
  it('opens a live run the hooks find, and ends it with the plan it found', async () => {
    const s = fakeServer();
    const log = { info: (): void => undefined, warn: (): void => undefined };
    const deps = { log, home: () => home, fetchImpl: s.fetchImpl, installedOrq: null };
    const t = await startPlanningRun(root, deps);
    if (!t) throw new Error('not on Orqiva');
    const id = openRunId(root);
    expect(id).toMatch(/^run/);
    expect(s.runs[id ?? '']?.steps).toEqual([expect.stringContaining('Claude Code is starting')]);
    put('.orqiva/plan.json', JSON.stringify(PLAN));
    await endPlanningRun(t, deps);
    expect(openRunId(root)).toBeNull();
    expect(s.runs[id ?? '']?.status).toBe('succeeded');
    expect(s.runs[id ?? '']?.summary).toContain('Plan written: 1 sprints, 1 tasks');
    expect(s.pages.map((p) => p.title)).toContain('Sprint plan');

    // closed before a plan: the run failed; a plan with errors: failed and says how many
    fs.rmSync(path.join(root, '.orqiva', 'plan.json'));
    await startPlanningRun(root, deps);
    const second = openRunId(root) ?? '';
    await endPlanningRun(t, deps);
    expect(s.runs[second]).toMatchObject({ status: 'failed', summary: 'No plan was written' });
    put('.orqiva/plan.json', JSON.stringify({ version: '0.1.0', sprints: [{ name: 'x' }] }));
    await startPlanningRun(root, deps);
    const third = openRunId(root) ?? '';
    await endPlanningRun(t, deps);
    expect(s.runs[third]?.summary).toMatch(/^The plan has \d+ error\(s\)$/);
  });

  // [PCODE-459 | S15 | v0.1.0] planned elsewhere: the round stops with who plans where
  it('stops when the project is being planned on another computer or in the portal', async () => {
    const said =
      'Claude is planning this project in VS Code on PC-2 (Cy, since 10:00 UTC). Wait until it is done, or stop it there.';
    const s = fakeServer();
    const fetchImpl = ((url: string, init: RequestInit) =>
      url.endsWith('/local-runs')
        ? Promise.resolve(
            new Response(JSON.stringify({ error: { message: said } }), { status: 409 }),
          )
        : s.fetchImpl(url, init)) as unknown as typeof fetch;
    const log = { info: (): void => undefined, warn: (): void => undefined };
    const run = startPlanningRun(root, { log, home: () => home, fetchImpl, installedOrq: null });
    await expect(run).rejects.toBeInstanceOf(PlanningConflict);
    await expect(run).rejects.toThrow('PC-2 (Cy');
    expect(openRunId(root)).toBeNull();
  });

  it('does nothing on a folder that is not on Orqiva', async () => {
    fs.rmSync(path.join(root, '.orqiva'), { recursive: true });
    const log = { info: (): void => undefined, warn: (): void => undefined };
    expect(await startPlanningRun(root, { log, home: () => home })).toBeNull();
  });
});

describe('the Claude Code hooks for the live run', () => {
  const settings = (): {
    hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
  } => JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8')) as never;

  it("are rewritten with the folder's own orq when they are older, and left when current", () => {
    put(
      '.claude/settings.json',
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
              hooks: [
                { type: 'command', command: 'node "C:/Orqiva/bin/orq.mjs" hook PostToolUse' },
              ],
            },
          ],
          Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
        },
      }),
    );
    expect(refreshHooks(root, null)).toBe('updated');
    const s = settings();
    expect(s.hooks['PostToolUse']?.[0]?.matcher).toBe(RUN_TOOLS);
    expect(s.hooks['PostToolUse']?.[0]?.hooks[0]?.command).toBe(
      'node "C:/Orqiva/bin/orq.mjs" hook PostToolUse',
    );
    expect(s.hooks['Stop']?.map((e) => e.hooks[0]?.command)).toContain('say done');
    expect(refreshHooks(root, null)).toBe('current');
  });

  it('are installed with the orq of this computer, or not at all without one', () => {
    expect(refreshHooks(root, path.join(home, 'missing.mjs'))).toBe('no-orq');
    const orq = path.join(home, 'orq.mjs');
    fs.writeFileSync(orq, '');
    expect(refreshHooks(root, orq)).toBe('installed');
    expect(settings().hooks['SessionStart']?.[0]?.hooks[0]?.command).toBe(
      'node "' + orq.replace(/\\/g, '/') + '" hook SessionStart',
    );
  });
});
