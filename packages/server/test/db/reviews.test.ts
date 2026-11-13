// ── [PCODE-145 | S15 | v0.1.0] Add the review stage and the Reviewer agent ──
//    Why:  reviews against the real database: the agent advises, people decide, and G3's review criterion
//          follows the current sprint's finished tasks.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProvider, scriptedProvider, type ModelProvider } from '../../src/agents/provider.js';
import { REVIEW_PROMPT } from '../../src/api/reviews.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('the demo reviewer', () => {
  it('approves only when criteria are ticked and no test fails', async () => {
    const ask = async (brief: string): Promise<string> => {
      const r = await demoProvider().complete({
        model: 'x',
        system: REVIEW_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: brief }] }],
        tools: [],
        maxTokens: 10,
      });
      return r.content[0]?.type === 'text' ? r.content[0].text : '';
    };
    expect(
      await ask('Acceptance criteria:\n- [x] a\n\nTests (latest result):\n- t: passed'),
    ).toMatch(/^RECOMMEND: approve/);
    expect(
      await ask('Acceptance criteria:\n- [ ] a\n\nTests (latest result):\n- t: failed'),
    ).toMatch(/^RECOMMEND: changes/);
  });
});

describe.skipIf(!hasDatabase)('reviews and the G3 review criterion (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let project = '';
  let item = '';
  let current: (ModelProvider & { requests: { messages: unknown[] }[] }) | null = null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Review = {
    kind: string;
    decision: string | null;
    recommendation: string | null;
    body: string;
    author: string | null;
  };
  const review = async () =>
    (
      await t.call<{
        lifecycle: {
          phases: {
            gate?: { key: string; criteria: { key: string; met: boolean; evidence: string }[] };
          }[];
        };
      }>(ada, 'GET', W('/projects/' + project + '/lifecycle'))
    ).body.lifecycle.phases
      .find((p) => p.gate?.key === 'g3')
      ?.gate?.criteria.find((x) => x.key === 'review');

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
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/guests'), { userId: gus.id });
    await t.call(ada, 'POST', W('/projects/' + project + '/lifecycle'), {});
    const sprint = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 1',
      })
    ).body.id;
    const states = (
      await t.call<{ states: { id: string; name: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Export',
        sprintId: sprint,
        stateId: states.find((s) => s.name === 'Done')?.id,
      })
    ).body.id;
    await t.call(ada, 'POST', W('/items/' + item + '/criteria'), { text: 'One header row' });
    await t.call(ada, 'POST', W('/sprints/' + sprint + '/start'));
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lets the Reviewer agent advise without deciding', async () => {
    current = scriptedProvider([
      {
        content: [
          { type: 'text', text: 'RECOMMEND: changes\nThe header criterion is not ticked.' },
        ],
        stopReason: 'end_turn',
        usage: { input: 100, output: 20 },
      },
    ]);
    const r = await t.call<Review[]>(ada, 'POST', W('/items/' + item + '/reviews/agent'));
    expect(r.status).toBe(201);
    expect(r.body[0]).toMatchObject({
      kind: 'agent',
      decision: null,
      recommendation: 'changes',
      body: 'The header criterion is not ticked.',
    });
    expect(JSON.stringify(current.requests[0]?.messages)).toContain('- [ ] One header row');
    expect((await review())?.met).toBe(false);
  });

  it('takes decisions from members, and G3 follows the sprint’s finished tasks', async () => {
    expect(
      (await t.call(gus, 'POST', W('/items/' + item + '/reviews'), { decision: 'approved' }))
        .status,
    ).toBe(403);
    expect(
      (
        await t.call(ada, 'POST', W('/items/' + item + '/reviews'), {
          decision: 'changes_requested',
        })
      ).status,
    ).toBe(400);
    await t.call(ada, 'POST', W('/items/' + item + '/reviews'), {
      decision: 'changes_requested',
      note: 'Tick the header criterion',
    });
    expect(await review()).toMatchObject({
      met: false,
      evidence: '1 finished tasks of Sprint 1 without an approved review: APP-1',
    });
    const r = await t.call<Review[]>(ada, 'POST', W('/items/' + item + '/reviews'), {
      decision: 'approved',
      note: 'Good now',
    });
    expect(r.body.map((x) => x.decision)).toEqual(['approved', 'changes_requested', null]);
    expect(await review()).toMatchObject({
      met: true,
      evidence: 'All 1 finished tasks of Sprint 1 approved in review',
    });
    expect(
      (await t.call<Review[]>(gus, 'GET', W('/items/' + item + '/reviews'))).body,
    ).toHaveLength(3);
  });
});
