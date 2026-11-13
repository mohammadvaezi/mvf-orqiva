// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
//    Why:  against a fake server: a new client and a request from the description are made, the files Claude
//          reads say for whom; publishing links each task to the requests the plan names; the plan check
//          refuses a request the project does not have; planning waits until the client is chosen; the
//          webview's choice is one way only; Claude's mapping of published tasks is read strictly.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validatePlan } from '../../src/plan/orqivaPlan';
import { parseMapping, PlanningSession } from '../../src/plan/session';
import {
  applyBinding,
  linkPlanRequests,
  readBindingFile,
  requestTitle,
  type Binding,
} from '../../src/server/binding';
import { wizardModel } from '../../src/webviews/home/wizard';
import { isWebviewMessage } from '../../src/webviews/protocol';

const SERVER = 'http://o.test';
const P = '/api/workspaces/w/projects/p';
let root = '';
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-bind-'));
  fs.mkdirSync(path.join(root, '.orqiva'));
  fs.writeFileSync(path.join(root, '.orqiva', 'project.json'), '{}');
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
const T = () => ({ root, server: SERVER, token: 't', workspaceId: 'w', projectId: 'p' });

function fake() {
  const state: Binding = { client: null, internal: false, requests: [] };
  const links: Record<string, string[]> = {};
  const calls: string[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    const m = init.method ?? 'GET';
    const p = url.slice(SERVER.length);
    const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    calls.push(m + ' ' + p);
    const json = (v: unknown, s = 200) =>
      Promise.resolve(new Response(JSON.stringify(v), { status: s }));
    if (p === '/api/workspaces/w/clients' && m === 'POST') {
      state.client = { id: 'c1', name: body['name'] as string };
      return json({ id: 'c1' }, 201);
    }
    if (p === P + '/binding' && m === 'PUT') {
      state.internal = body['internal'] as boolean;
      if (!body['clientId']) state.client = null;
      return json(state);
    }
    if (p === P + '/binding') return json(state);
    if (p === '/api/workspaces/w/client-requests' && m === 'POST') {
      state.requests.push({
        id: 'r1',
        ref: 'F-1',
        kind: 'feature',
        title: body['title'] as string,
        state: 'planned',
        text: body['body'] as string,
        inProject: true,
        items: [],
      });
      return json({ id: 'r1' }, 201);
    }
    if (p === P + '/items')
      return json([
        { id: 'i1', title: 'Parts list' },
        { id: 'i2', title: 'CI pipeline' },
      ]);
    const item = /\/items\/(i\d)\/requests$/.exec(p)?.[1];
    if (item) {
      links[item] = body['requestIds'] as string[];
      return json({ requests: [] });
    }
    return json({ error: { message: 'no route ' + p } }, 404);
  }) as unknown as typeof fetch;
  return { state, links, calls, fetchImpl };
}

describe('for which client the project is planned', () => {
  it('makes the client and a request from the description, and writes what Claude reads', async () => {
    const s = fake();
    const b = await applyBinding(
      T(),
      { newClient: 'Werkstatt Meyer', requestIds: [], fromDescription: true },
      '# Project description\n\nA tool for our workshop stock.\nMore.',
      s.fetchImpl,
    );
    expect(b.client?.name).toBe('Werkstatt Meyer');
    expect(b.requests[0]).toMatchObject({ ref: 'F-1', title: 'A tool for our workshop stock.' });
    expect(readBindingFile(root)).toEqual({
      client: { id: 'c1', name: 'Werkstatt Meyer' },
      internal: false,
      requests: [{ id: 'r1', ref: 'F-1' }],
    });
    const md = fs.readFileSync(path.join(root, '.orqiva', 'description', 'requests.md'), 'utf8');
    expect(md).toContain('# For whom: Werkstatt Meyer');
    expect(md).toContain('## F-1 A tool for our workshop stock.');
    expect(requestTitle('# Project description\n\n' + 'x'.repeat(200))).toHaveLength(118);
  });

  it('marks an internal project, and links each published task to the requests the plan names', async () => {
    const s = fake();
    const b = await applyBinding(T(), { internal: true, requestIds: [] }, 'x', s.fetchImpl);
    expect(b).toMatchObject({ client: null, internal: true });
    expect(
      fs.readFileSync(path.join(root, '.orqiva', 'description', 'requests.md'), 'utf8'),
    ).toContain('An internal project');
    s.state.requests.push({
      id: 'r9',
      ref: 'F-9',
      kind: 'feature',
      title: 'Stock',
      state: 'planned',
      text: '',
      inProject: true,
      items: [],
    });
    const plan = {
      version: '0.1.0',
      sprints: [
        {
          name: 'S1',
          date: '2026-10-26',
          goal: '',
          items: [
            { title: 'Parts list', requests: ['f-9', 'X-1'] },
            { title: 'CI pipeline', requests: [] },
          ],
        },
      ],
    };
    const r = await linkPlanRequests(T(), plan as never, s.fetchImpl);
    expect(s.links).toEqual({ i1: ['r9'], i2: [] });
    expect(r).toEqual({ linked: 2, unknown: ['X-1'] });
  });

  it('refuses a plan that names a request the project does not have', () => {
    const plan = {
      sprints: [
        {
          name: 'S1',
          date: '2026-10-26',
          items: [
            { title: 'A', description_md: 'x'.repeat(40), acceptance: ['a'], requests: ['F-1'] },
            { title: 'B', description_md: 'x'.repeat(40), acceptance: ['a'], requests: ['F-2'] },
          ],
        },
      ],
    };
    expect(validatePlan(plan, '2026-10-01', ['F-1'])).toEqual([
      "sprint 1 item 2: request 'F-2' is not one of the project's client requests",
    ]);
    expect(validatePlan(plan, '2026-10-01')).toEqual([]);
  });

  it('does not plan before the client is chosen, and keeps the description step until then', async () => {
    fs.mkdirSync(path.join(root, '.orqiva', 'description'));
    fs.writeFileSync(
      path.join(root, '.orqiva', 'description', 'description.md'),
      '# Project description\n\nStock.\n',
    );
    const s = new PlanningSession({
      log: { info: () => undefined, warn: () => undefined },
      folder: () => ({ root, name: 'M', identifier: 'MARK', orqiva: true }),
      claudeCommand: () => 'claude',
    });
    await expect(s.ask()).rejects.toThrow(/^Choose the client this project is for/);
    const w = wizardModel({
      description: 'written',
      descriptionText: 'Stock',
      plan: 'missing',
      planJson: null,
      errors: [],
      checkError: null,
      published: false,
      conversation: { state: 'none', entries: [], planCurrent: true },
      bound: false,
    });
    expect(w?.step).toBe('describe');
  });

  it("takes from the webview one way only, and reads Claude's mapping strictly", () => {
    const ok = (binding: unknown) => isWebviewMessage({ type: 'home/binding', binding });
    expect(ok({ clientId: '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b', requestIds: [] })).toBe(true);
    expect(ok({ newClient: 'Meyer', requestIds: [], fromDescription: true })).toBe(true);
    expect(ok({ internal: true, requestIds: [] })).toBe(true);
    expect(ok({ internal: true, newClient: 'x', requestIds: [] })).toBe(false);
    expect(ok({ requestIds: [] })).toBe(false);
    expect(ok({ clientId: 'nope', requestIds: [] })).toBe(false);
    expect(parseMapping('```json\n{"tasks": {"Parts list": ["F-1"], "CI": "F-1"}}\n```')).toEqual({
      'Parts list': ['F-1'],
      CI: [],
    });
    expect(parseMapping('no')).toBeNull();
  });
});
