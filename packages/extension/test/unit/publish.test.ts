// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-34 | S06 | v0.1.0] Publish the plan with confirmation, single-flight guard and result summary ──
//    Why:  refuses when the check fails, spawns nothing on cancel, runs once for two overlapping clicks, and
//          against the fake engine the published timestamp reaches the plan status.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineCommands } from '../../src/engine/commands';
import { runEngine } from '../../src/engine/run';
import { PlanService, toStatusMessage } from '../../src/plan/planService';
import {
  _resetPublishForTests,
  confirmMessage,
  isPublishing,
  parsePublishOutput,
  publishPlan,
  resultMessage,
} from '../../src/plan/publish';
import { Store } from '../../src/state/store';
import { Logger, resetLoggerForTests } from '../../src/util/log';

const FAKE_HOME = path.resolve(__dirname, '..', 'fixtures', 'fake-engine');
const OK = '2 sprint(s), 3 item(s), 2026-01-01 to 2026-01-02, version 0.1.0; not yet published\n';
const BAD = OK + '- sprint 1: date 2026-01-01 is in the past (Plane closes past sprints)\n';
const PUBLISHED =
  'Sprint 01 - Foundation: 2 new item(s)\nSprint 02 - Board: 1 new item(s)\nPublished: 2 sprint(s), 3 item(s) created. Board: https://plane.example.test/ws/projects/0/issues/\n';
const VALID_PLAN = '{"version":"0.1.0","sprints":[{"name":"S","date":"2026-01-01","items":[]}]}';

function deps(check: string, publish: string | (() => Promise<string>)) {
  const calls: string[][] = [];
  const store = new Store();
  const engine = new EngineCommands((_s, args) => {
    calls.push(args);
    if (args[0] === 'check') return Promise.resolve({ code: 0, stdout: check, stderr: '' });
    const out = typeof publish === 'string' ? Promise.resolve(publish) : publish();
    return out.then((stdout) => ({ code: 0, stdout, stderr: '' }));
  });
  const services = { engine, store, log: new Logger(), root: () => null as string | null };
  const planService = new PlanService(services, {
    existsSync: (p) => p.endsWith('plan.json'),
    readFileSync: () => VALID_PLAN,
  });
  // root null for the PlanService would short-circuit; give it a root through the io instead
  const svc = { ...services, root: () => 'C:\\proj' };
  return { calls, services: svc, planService: new PlanService(svc, planService['io']) };
}

describe('publishPlan', () => {
  beforeEach(() => {
    resetLoggerForTests();
    _resetPublishForTests();
  });

  it('parses the engine output', () => {
    const r = parsePublishOutput(PUBLISHED);
    expect(r).toMatchObject({
      sprints: 2,
      items: 3,
      board: 'https://plane.example.test/ws/projects/0/issues/',
      perSprint: [
        { name: 'Sprint 01 - Foundation', items: 2 },
        { name: 'Sprint 02 - Board', items: 1 },
      ],
    });
    expect(resultMessage(r)).toBe('Published: 2 sprints, 3 items created.');
  });

  // ── [PCODE-34 | S06 | v0.1.0] refuses_when_check_fails ──
  it('refuses when the check fails and spawns no publish', async () => {
    const d = deps(BAD, PUBLISHED);
    await expect(publishPlan({ ...d, confirm: () => Promise.resolve(true) })).rejects.toThrow(
      /Plan has 1 error\(s\)/,
    );
    expect(d.calls).toEqual([['check']]);
  });

  // ── [PCODE-34 | S06 | v0.1.0] requires_confirmation ──
  it('asks with the counts; cancel means no spawn', async () => {
    const d = deps(OK, PUBLISHED);
    const asked: string[] = [];
    const r = await publishPlan({
      ...d,
      confirm: (m) => {
        asked.push(m);
        return Promise.resolve(false);
      },
    });
    expect(r).toBeUndefined();
    expect(asked).toEqual([
      'Publish 2 sprints and 3 items? Existing items are kept; nothing is deleted.',
    ]);
    expect(d.calls).toEqual([['check']]);
    expect(confirmMessage(await d.planService.status())).toBe(asked[0]);
  });

  // ── [PCODE-34 | S06 | v0.1.0] single_flight ──
  it('two overlapping calls run the engine once and share the result', async () => {
    let release: (v: string) => void = () => undefined;
    let spawned = 0;
    const d = deps(OK, () => {
      spawned++;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    const yes = () => Promise.resolve(true);
    const first = publishPlan({ ...d, confirm: yes, progress: (_t, fn) => fn() });
    await new Promise((r) => setTimeout(r, 10));
    expect(isPublishing()).toBe(true);
    const second = publishPlan({ ...d, confirm: yes, progress: (_t, fn) => fn() });
    release(PUBLISHED);
    const [a, b] = await Promise.all([first, second]);
    expect(spawned).toBe(1);
    expect(a?.items).toBe(3);
    expect(b).toBe(a);
    expect(isPublishing()).toBe(false);
    expect(d.calls.filter((c) => c[0] === 'publish')).toEqual([['publish', '--yes']]);
  });
});

// ── [PCODE-34 | S06 | v0.1.0] the fake engine writes published.json; the status shows the timestamp ──
describe('publishPlan (fake engine, real python)', () => {
  const python = (() => {
    for (const c of [['py', '-3'], ['python3'], ['python']]) {
      const r = spawnSync(c[0] ?? '', [...c.slice(1), '--version'], { encoding: 'utf8' });
      if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return c;
    }
    return null;
  })();
  let tmp = '';
  beforeEach(() => {
    _resetPublishForTests();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-publish-'));
    fs.mkdirSync(path.join(tmp, '.plane', 'state'), { recursive: true });
    fs.copyFileSync(
      path.resolve(__dirname, '..', 'fixtures', 'workspace', '.plane', 'plan.json'),
      path.join(tmp, '.plane', 'plan.json'),
    );
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    const calls = path.join(FAKE_HOME, 'plan-calls.jsonl');
    if (fs.existsSync(calls)) fs.unlinkSync(calls);
  });

  it.skipIf(!python)('publishes and the panel status reads Published <at>', async () => {
    const store = new Store();
    store.load(tmp);
    const engine = new EngineCommands((script, args) =>
      runEngine({ python: python ?? [], home: FAKE_HOME }, script, args, { cwd: tmp }),
    );
    const services = { engine, store, log: new Logger(), root: () => tmp };
    let refreshed = 0;
    const r = await publishPlan({
      services: {
        ...services,
        refreshBoard: () => {
          refreshed++;
          return Promise.resolve();
        },
      },
      confirm: () => Promise.resolve(true),
      progress: (_t, fn) => fn(),
    });
    expect(r).toMatchObject({ sprints: 2, items: 3 });
    expect(refreshed).toBe(1);
    expect(store.state.published?.at).toBe('2026-01-01T10:00:00');
    const m = toStatusMessage(await new PlanService(services).status());
    expect(m.published).toBe('Published 2026-01-01T10:00:00');
  });
});

// ── [PCODE-454 | S15 | v0.1.0] VS Code extension: Home tab shows and changes project, server and account; planning works on the Orqiva server ──
describe('publishPlan on an Orqiva folder', () => {
  let root = '';
  let home = '';
  const SERVER = 'http://orqiva.test:8490';
  const DESC = 'Set up the repository layout, the toolchain and the test runner for the app.';
  beforeEach(() => {
    resetLoggerForTests();
    _resetPublishForTests();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-pub-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-home-'));
    fs.mkdirSync(path.join(root, '.orqiva'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.orqiva', 'project.json'),
      JSON.stringify({
        server: SERVER,
        workspaceId: 'w1',
        projectId: 'p1',
        projectKey: 'MARK',
        projectName: 'Marketspider',
      }),
    );
    fs.mkdirSync(path.join(home, '.orqiva'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.orqiva', 'credentials.json'),
      JSON.stringify({ servers: { [SERVER]: { token: 'orq_t', email: 'a@x.test' } } }),
    );
    fs.mkdirSync(path.join(root, '.orqiva'), { recursive: true });
    const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(root, '.orqiva', 'plan.json'),
      JSON.stringify({
        version: '0.1.0',
        sprints: [
          {
            name: 'Sprint 01',
            date,
            goal: 'g',
            items: [
              {
                title: 'Scaffold',
                label: 'feature',
                priority: 'high',
                description_md: DESC,
                acceptance: ['a', 'b'],
              },
            ],
          },
        ],
      }),
    );
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('checks in the extension and publishes to the server, never through the engine', async () => {
    const store = new Store();
    store.load(root);
    expect(store.state.link?.server).toBe(SERVER);
    const engine = new EngineCommands(() => Promise.reject(new Error('the engine must not run')));
    const calls: string[] = [];
    const fetchImpl = ((url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      calls.push(method + ' ' + url.slice(SERVER.length));
      const json = (v: unknown): Promise<Response> =>
        Promise.resolve(new Response(JSON.stringify(v), { status: method === 'GET' ? 200 : 201 }));
      if (method === 'GET') return json([]);
      if (url.endsWith('/labels')) return json({ id: 'l1', name: 'feature' });
      if (url.endsWith('/sprints')) return json({ id: 's1', name: 'Sprint 01' });
      // [PCODE-456 | S15 | v0.1.0] the plan documents follow the publish
      if (url.endsWith('/docs'))
        return json({ page: { id: 'd' + String(calls.length), version: 1 }, body: '' });
      return json({ id: 'i1' });
    }) as unknown as typeof fetch;
    const services = { engine, store, log: new Logger(), root: () => root };
    const r = await publishPlan({
      services,
      confirm: () => Promise.resolve(true),
      progress: (_t, fn) => fn(),
      home: () => home,
      fetchImpl,
    });
    expect(r).toMatchObject({ sprints: 1, items: 1, board: SERVER + '/projects/p1' });
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([
      'POST /api/workspaces/w1/projects/p1/sprints',
      'POST /api/workspaces/w1/projects/p1/labels',
      'POST /api/workspaces/w1/projects/p1/items',
      // the folder Project plan and the Sprint plan page (no other document exists yet)
      'POST /api/workspaces/w1/projects/p1/docs',
      'POST /api/workspaces/w1/projects/p1/docs',
    ]);
    const m = toStatusMessage(await new PlanService(services).status());
    expect(m.plan).toBe('valid');
    expect(m.published).toMatch(/^Published \d{4}-\d{2}-\d{2}T/);
  });

  it('asks to sign in when this computer has no token for the server', async () => {
    fs.rmSync(path.join(home, '.orqiva', 'credentials.json'));
    const store = new Store();
    store.load(root);
    const engine = new EngineCommands(() => Promise.reject(new Error('no engine')));
    await expect(
      publishPlan({
        services: { engine, store, log: new Logger(), root: () => root },
        confirm: () => Promise.resolve(true),
        progress: (_t, fn) => fn(),
        home: () => home,
        fetchImpl: () => Promise.reject(new Error('offline')),
      }),
    ).rejects.toThrow(/Sign in on the Orqiva tab/);
  });
});
