// ── [PCODE-128 | S15 | v0.1.0] Add capacity, velocity and the sprint planning agent ──
//    Why:  capacity, velocity and the planner's suggestion against the real database, with a scripted planner.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  demoProvider,
  scriptedProvider,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { PLANNING_PROMPT, fitSuggestion, velocityOf } from '../../src/api/planning.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const say = (text: string): ModelReply => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { input: 50, output: 20 },
});
const c = (ref: string, estimate: number | null) => ({
  id: ref.toLowerCase(),
  ref,
  title: ref,
  estimate,
});

describe('planning rules', () => {
  it('measure velocity as the average of finished sprints', () => {
    expect(velocityOf([])).toBeNull();
    expect(velocityOf([10, 13, 8])).toBe(10.3);
  });

  it('keep only known, estimated tasks that fit, in the agent’s order', () => {
    const r = fitSuggestion(
      ['APP-1', 'app-2', 'APP-9', 'APP-3', 'APP-4', 'APP-1'],
      [c('APP-1', 3), c('APP-2', 5), c('APP-3', null), c('APP-4', 2)],
      9,
    );
    expect(r.chosen.map((x) => x.ref)).toEqual(['APP-1', 'APP-2']);
    expect(r.dropped).toEqual([
      { ref: 'APP-9', why: 'not an open backlog task' },
      { ref: 'APP-3', why: 'has no estimate' },
      { ref: 'APP-4', why: 'does not fit the room left' },
    ]);
  });

  it('let the demo planner fill the room in backlog order', async () => {
    const r = await demoProvider().complete({
      model: 'x',
      system: PLANNING_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Room: 6 points\n\nAPP-1 | 3 | a\nAPP-2 | 5 | b\nAPP-3 | ? | c\nAPP-4 | 2 | d',
            },
          ],
        },
      ],
      tools: [],
      maxTokens: 10,
    });
    expect(r.content[0]?.type === 'text' ? JSON.parse(r.content[0].text) : null).toMatchObject({
      items: ['APP-1', 'APP-4'],
    });
  });
});

describe.skipIf(!hasDatabase)('capacity and the planning agent (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let project = '';
  let next = '';
  let current: ModelProvider | null = null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Capacity = {
    members: { name: string; points: number }[];
    capacity: number;
    committed: number;
    unestimated: number;
    velocity: number | null;
    velocitySprints: number;
  };
  const item = async (
    title: string,
    estimate: number | null,
    extra: Record<string, unknown> = {},
  ): Promise<string> =>
    (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title,
        ...(estimate === null ? {} : { estimate }),
        ...extra,
      })
    ).body.id;

  beforeAll(async () => {
    t = await startTestApp({
      agents: {
        provider: () => {
          if (!current) throw new Error('no script');
          return Promise.resolve(current);
        },
      },
    });
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    // a finished sprint: 8 of its 11 points done
    const states = (
      await t.call<{ states: { id: string; name: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states;
    const done = states.find((s) => s.name === 'Done')?.id;
    const first = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 1',
      })
    ).body.id;
    await item('Done A', 5, { sprintId: first, stateId: done });
    await item('Done B', 3, { sprintId: first, stateId: done });
    await item('Open C', 3, { sprintId: first });
    await t.call(ada, 'POST', W('/sprints/' + first + '/start'));
    await t.call(ada, 'POST', W('/sprints/' + first + '/complete'), { moveTo: null });
    next = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 2',
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('shows capacity per person, the committed points and the measured velocity', async () => {
    const r = await t.call<Capacity>(ada, 'GET', W('/sprints/' + next + '/capacity'));
    expect(r.body).toMatchObject({ capacity: 0, committed: 0, velocity: 8, velocitySprints: 1 });
    const set = await t.call<Capacity>(ada, 'PUT', W('/sprints/' + next + '/capacity'), {
      entries: [
        { userId: ada.id, points: 5 },
        { userId: cy.id, points: 4 },
      ],
    });
    // [PCODE-253 | S15 | v0.1.0] points set by hand count; the rows also carry what was derived
    expect(set.body.members).toEqual([
      expect.objectContaining({ userId: ada.id, name: 'Ada', points: 5, manual: true }),
      expect.objectContaining({ userId: cy.id, name: 'Cy', points: 4, manual: true }),
    ]);
    expect(set.body.capacity).toBe(9);
  });

  it('suggests within the room, and applies exactly what a person chose', async () => {
    // the backlog: Open C (3, moved back from Sprint 1), then these
    await item('Login', 5);
    await item('Logout', 2);
    await item('Reset password', null);
    await item('Profile page', 3);
    current = scriptedProvider([
      say(
        '```json\n{"items": ["APP-6", "APP-5", "APP-7", "APP-4", "APP-8", "APP-99"], "reasons": "Auth first."}\n```',
      ),
    ]);
    const r = await t.call<{
      room: number;
      basis: string;
      items: { id: string; ref: string }[];
      points: number;
      reasons: string;
      dropped: { ref: string }[];
    }>(ada, 'POST', W('/sprints/' + next + '/plan/draft'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ room: 9, basis: 'capacity', points: 5, reasons: 'Auth first.' });
    expect(r.body.items.map((x) => x.ref)).toEqual(['APP-5', 'APP-7']);
    expect(r.body.dropped.map((x) => x.ref)).toEqual(['APP-6', 'APP-4', 'APP-8', 'APP-99']);
    // nothing moved yet
    expect(
      (await t.call<Capacity>(ada, 'GET', W('/sprints/' + next + '/capacity'))).body.committed,
    ).toBe(0);

    const applied = await t.call<Capacity>(ada, 'POST', W('/sprints/' + next + '/plan/apply'), {
      itemIds: r.body.items.map((x) => x.id),
    });
    expect(applied.body.committed).toBe(5);
    // the room is smaller now
    current = scriptedProvider([say('{"items": ["APP-3"], "reasons": "x"}')]);
    const again = await t.call<{ room: number; items: unknown[] }>(
      ada,
      'POST',
      W('/sprints/' + next + '/plan/draft'),
    );
    expect(again.body).toMatchObject({ room: 4, items: [{ ref: 'APP-3' }] });
  });
});
