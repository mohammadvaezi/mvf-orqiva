// ── [PCODE-454 | S15 | v0.1.0] VS Code extension: Home tab shows and changes project, server and account; planning works on the Orqiva server ──
//    Why:  an Orqiva folder plans without the engine: the check gives the engine's messages for the same
//          mistakes, Publish makes sprints and tasks on a fake server (and only the new ones the second
//          time), the publish is noted where the panel reads it, and the bundled prompt fills like the
//          engine's.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPrompt } from '../../src/plan/draft';
import {
  ORQIVA_PLAN_PROMPT,
  checkPlan,
  publishToServer,
  recordPublished,
  taskDescription,
  validatePlan,
} from '../../src/plan/orqivaPlan';
import type { PlanJson } from '../../src/state/types';

const SERVER = 'http://orqiva.test:8490';
const BASE = '/api/workspaces/w1/projects/p1';
const DESC = 'Set up the repository layout, the toolchain and the test runner for the app.';

function item(title: string, extra: Partial<PlanJson['sprints'][number]['items'][number]> = {}) {
  return {
    title,
    label: 'feature' as const,
    priority: 'high' as const,
    description_md: DESC,
    acceptance: ['npm test passes', 'the app starts'],
    ...extra,
  };
}

const PLAN: PlanJson = {
  version: '0.1.0',
  sprints: [
    {
      name: 'Sprint 01 - Foundation',
      date: '2026-10-23',
      goal: 'The app runs.',
      items: [item('Scaffold the repo', { files_hint: ['package.json'] }), item('Add CI')],
    },
    {
      name: 'Sprint 02 - Products',
      date: '2026-10-26',
      goal: 'Products can be stored.',
      items: [item('Store products', { label: 'bug', priority: 'medium' })],
    },
  ],
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeServer(
  calls: Call[],
  have: { sprints: { id: string; name: string }[]; items: { title: string }[] },
) {
  let n = 0;
  return ((url: string, init: RequestInit) => {
    const p = url.slice(SERVER.length);
    const method = init.method ?? 'GET';
    const body = init.body ? (JSON.parse(init.body as string) as unknown) : undefined;
    calls.push({ method, path: p, body });
    const json = (status: number, v: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(v), { status }));
    if (method === 'GET' && p === BASE + '/sprints') return json(200, have.sprints);
    if (method === 'GET' && p === BASE + '/items') return json(200, have.items);
    if (method === 'GET' && p === BASE + '/labels')
      return json(200, [{ id: 'l-feature', name: 'Feature', color: '#000000' }]);
    if (method === 'POST' && p === BASE + '/labels')
      return json(201, { id: 'l-' + (body as { name: string }).name, name: 'x', color: '#000000' });
    if (method === 'POST' && p === BASE + '/sprints') {
      const s = { id: 's' + String(++n), name: (body as { name: string }).name };
      have.sprints.push(s);
      return json(201, s);
    }
    if (method === 'POST' && p === BASE + '/items') {
      have.items.push({ title: (body as { title: string }).title });
      return json(201, { id: 'i' + String(++n) });
    }
    return json(404, { error: { message: 'no route ' + p } });
  }) as unknown as typeof fetch;
}

const target = { server: SERVER, token: 'orq_t', workspaceId: 'w1', projectId: 'p1' };

let root = '';
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-plan-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('the plan check on an Orqiva folder', () => {
  it('passes a good plan and counts it', () => {
    const r = checkPlan(JSON.stringify(PLAN), null, '2026-10-22');
    expect(r).toEqual({
      sprints: 2,
      items: 3,
      from: '2026-10-23',
      to: '2026-10-26',
      version: '0.1.0',
      publishedAt: null,
      errors: [],
    });
  });

  it("names each mistake in the engine's words", () => {
    const bad = {
      sprints: [
        { name: '', date: '2026-10-01', items: [item('A'), item('a', { acceptance: [] })] },
        {
          name: 'B',
          date: '23.10.2026',
          items: [item('C', { description_md: 'short', priority: 'asap' as never })],
        },
        { name: 'D', date: '2026-10-01', items: [] },
      ],
    };
    expect(validatePlan(bad, '2026-10-22')).toEqual([
      'sprint 1: missing name',
      'sprint 1: date 2026-10-01 is in the past',
      "sprint 1 item 2: duplicate title 'a'",
      'sprint 1 item 2: no acceptance checks',
      "sprint 2: date '23.10.2026' is not YYYY-MM-DD",
      'sprint 2 item 1: description too short',
      'sprint 2 item 1: bad priority',
      'sprint 3: date 2026-10-01 is in the past',
      'sprint 3: two sprints on 2026-10-01',
      'sprint 3: no items',
    ]);
    expect(checkPlan('{not json', null, '2026-10-22').errors).toEqual([
      "plan.json needs a non-empty 'sprints' list",
    ]);
  });
});

describe('Publish on an Orqiva folder', () => {
  it('makes the sprints and tasks on the server, with acceptance and file hints', async () => {
    const calls: Call[] = [];
    const r = await publishToServer(target, PLAN, fakeServer(calls, { sprints: [], items: [] }));
    expect(r).toMatchObject({
      sprints: 2,
      items: 3,
      board: SERVER + '/projects/p1',
      perSprint: [
        { name: 'Sprint 01 - Foundation', items: 2 },
        { name: 'Sprint 02 - Products', items: 1 },
      ],
    });
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts[0]).toEqual({
      method: 'POST',
      path: BASE + '/sprints',
      body: {
        name: 'Sprint 01 - Foundation',
        goal: 'The app runs.',
        startDate: '2026-10-23',
        endDate: '2026-10-23',
      },
    });
    expect(posts[1]?.body).toEqual({
      title: 'Scaffold the repo',
      description: taskDescription(item('Scaffold the repo', { files_hint: ['package.json'] })),
      priority: 'high',
      kind: 'task',
      sprintId: 's1',
      labelIds: ['l-feature'],
    });
    expect((posts[1]?.body as { description: string }).description).toContain(
      '### Acceptance\n- [ ] npm test passes\n- [ ] the app starts\n\n### Files (hint)\n- `package.json`',
    );
    // a bug label that does not exist yet is made once, and the task is a bug
    expect(posts.find((c) => c.path === BASE + '/labels')?.body).toEqual({
      name: 'bug',
      color: '#ef4444',
    });
    expect(posts.at(-1)?.body).toMatchObject({ title: 'Store products', kind: 'bug' });
  });

  it('adds only what is new the second time', async () => {
    const have = {
      sprints: [{ id: 's-old', name: 'sprint 01 - foundation' }],
      items: [{ title: 'Scaffold the repo ' }],
    };
    const calls: Call[] = [];
    const r = await publishToServer(target, PLAN, fakeServer(calls, have));
    expect(r.sprints).toBe(1);
    expect(r.items).toBe(2);
    const items = calls.filter((c) => c.method === 'POST' && c.path === BASE + '/items');
    expect(items.map((c) => (c.body as { title: string; sprintId: string }).sprintId)).toEqual([
      's-old',
      expect.stringMatching(/^s\d+$/),
    ]);
    const again = await publishToServer(target, PLAN, fakeServer([], have));
    expect([again.sprints, again.items]).toEqual([0, 0]);
  });

  it('notes the publish where the plan panel reads it, keeping earlier ids', () => {
    recordPublished(root, { A: 'i1' }, new Date('2026-10-22T10:00:00Z'));
    const at = recordPublished(root, { B: 'i2' }, new Date('2026-10-22T11:30:00Z'));
    const file = path.join(root, '.plane', 'state', 'published.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      at,
      items: { A: 'i1', B: 'i2' },
    });
    expect(at).toBe('2026-10-22T11:30:00');
  });
});

describe('the bundled planning prompt', () => {
  it('fills like the engine template and names no other tracker', () => {
    const { prompt, startDate } = buildPrompt({
      name: 'Marketspider',
      identifier: 'MARK',
      template: ORQIVA_PLAN_PROMPT,
      today: new Date(2026, 9, 22),
    });
    expect(startDate).toBe('2026-10-23');
    expect(prompt).toContain('Project: **Marketspider** (Orqiva key `MARK`)');
    expect(prompt).toContain('starting 2026-10-23');
    expect(prompt).toContain('"sprints": [');
    expect(prompt).not.toMatch(/plane(?!\/)/i);
  });
});
