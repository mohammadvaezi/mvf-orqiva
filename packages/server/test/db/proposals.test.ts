// ── [PCODE-124 | S15 | v0.1.0] Generate proposals with an estimate from the interview, with versions ──
//    Why:  drafting, checking and versioning proposals against the real database with a scripted architect.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  demoProvider,
  scriptedProvider,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { PROPOSAL_PROMPT, proposalBrief } from '../../src/api/proposals.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const say = (text: string): ModelReply => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { input: 500, output: 300 },
});
const draft = {
  summary: 'CSV export of the report.',
  problem: 'Finance retypes numbers every month.',
  goals: ['No retyping'],
  scopeIn: ['CSV of the monthly report'],
  scopeOut: ['Excel files'],
  risks: ['Large reports'],
  tasks: [
    { title: 'Export endpoint', estimate: 3, description: 'Stream the rows' },
    { title: 'Export button', estimate: 2, description: '' },
    { title: 'Tests', estimate: 2, description: '' },
  ],
};

describe('the brief and the demo architect', () => {
  it('give the model the idea, the summary and the interview', () => {
    const [m] = proposalBrief({ title: 'CSV', body: '', summary: 'Finance needs CSV.' }, [
      { role: 'agent', body: 'Who?' },
      { role: 'owner', body: 'Finance.' },
    ]);
    const text = m?.content[0]?.type === 'text' ? m.content[0].text : '';
    expect(text).toBe(
      'The idea: CSV\n\nInterview summary: Finance needs CSV.\n\nThe interview:\nQ: Who?\nA: Finance.',
    );
  });

  it('lets the demo model write a usable proposal', async () => {
    const r = await demoProvider().complete({
      model: 'x',
      system: PROPOSAL_PROMPT,
      messages: proposalBrief({ title: 'Dark mode', body: '', summary: '' }, []),
      tools: [],
      maxTokens: 100,
    });
    const text = r.content[0]?.type === 'text' ? r.content[0].text : '';
    expect(text).toContain('"Build Dark mode"');
  });
});

describe.skipIf(!hasDatabase)('proposals (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let current: ModelProvider | null = null;
  let idea = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Proposal = {
    version: number;
    source: string;
    author: string | null;
    content: typeof draft;
    estimate: { points: number; days: number };
  };

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
    const project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    idea = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'CSV export',
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('waits for the interview before drafting', async () => {
    expect((await t.call(ada, 'POST', W('/ideas/' + idea + '/proposals/draft'))).status).toBe(409);
    current = scriptedProvider([say('READY: Finance needs a CSV of the monthly report.')]);
    await t.call(ada, 'POST', W('/ideas/' + idea + '/interview'), {});
  });

  it('stores nothing when the draft cannot be used', async () => {
    current = scriptedProvider([say('I think you should build it.')]);
    const r = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/proposals/draft'),
    );
    expect(r.status).toBe(502);
    expect(r.body.error.message).toContain('could not be used: A proposal is an object');
    expect((await t.call<unknown[]>(ada, 'GET', W('/ideas/' + idea + '/proposals'))).body).toEqual(
      [],
    );
  });

  it('drafts version 1 with an estimate the server computes', async () => {
    current = scriptedProvider([say('Here it is.\n```json\n' + JSON.stringify(draft) + '\n```')]);
    const r = await t.call<Proposal>(ada, 'POST', W('/ideas/' + idea + '/proposals/draft'));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      version: 1,
      source: 'agent',
      author: null,
      estimate: { points: 7, days: 2 },
    });
    expect(r.body.content.tasks[0]?.title).toBe('Export endpoint');
    const thread = await t.call<{ idea: { status: string } }>(ada, 'GET', W('/ideas/' + idea));
    expect(thread.body.idea.status).toBe('proposed');
  });

  it('keeps every edit as a new version, with the estimate following the tasks', async () => {
    const edited = { ...draft, tasks: [...draft.tasks, { title: 'Docs', estimate: 5 }] };
    const r = await t.call<Proposal>(ada, 'POST', W('/ideas/' + idea + '/proposals'), {
      content: edited,
    });
    expect(r.body).toMatchObject({
      version: 2,
      source: 'person',
      author: 'Ada',
      estimate: { points: 12, days: 3 },
    });
    const bad = await t.call<{ error: { details: { message: string }[] } }>(
      ada,
      'POST',
      W('/ideas/' + idea + '/proposals'),
      { content: { ...draft, tasks: [{ title: 'x', estimate: 4 }] } },
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.map((d) => d.message)).toEqual([
      "task 1's estimate is one of 1, 2, 3, 5, 8, 13 points",
    ]);
    const versions = await t.call<Proposal[]>(ada, 'GET', W('/ideas/' + idea + '/proposals'));
    expect(versions.body.map((v) => v.version)).toEqual([2, 1]);
  });
});
