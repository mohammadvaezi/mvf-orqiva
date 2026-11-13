// ── [PCODE-273 | S15 | v0.1.0] T28.2 Interview steered by coverage; handed-over questions notify their owner ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-123 | S15 | v0.1.0] Add the ideas inbox and the AI owner interview ──
//    Why:  the inbox and the interview against the real database, with a scripted interviewer: what is
//          kept, in which order, what it costs, and who may take part.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coverage, steering, weakest } from '../../src/api/ideacoverage.js';
import { interviewMessages, readInterview } from '../../src/api/ideas.js';
import {
  scriptedProvider,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const say = (text: string): ModelReply => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { input: 200, output: 40 },
});

describe('the interview, as the model sees it', () => {
  it('starts with the idea and merges answers given in a row', () => {
    const m = interviewMessages({ title: 'CSV export', body: 'Finance asks.' }, [
      { role: 'agent', body: 'Who needs it?' },
      { role: 'owner', body: 'Finance.' },
      { role: 'owner', body: 'And audit.' },
    ]);
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(m[0]?.content[0]).toMatchObject({
      text: expect.stringContaining('CSV export') as string,
    });
    expect(m[2]?.content[0]).toMatchObject({ text: 'Finance.\n\nAnd audit.' });
  });

  it('knows a summary from a question', () => {
    expect(readInterview('Who needs it?')).toEqual({
      done: false,
      body: 'Who needs it?',
      area: null,
    });
    expect(readInterview('READY: Finance needs CSV.')).toEqual({
      done: true,
      body: 'Finance needs CSV.',
      area: null,
    });
    // [PCODE-273 | S15 | v0.1.0] the area a question is about leaves its text
    expect(readInterview('[users] Who needs it?')).toEqual({
      done: false,
      body: 'Who needs it?',
      area: 'users',
    });
    expect(readInterview('[Non-functional] How fast?')).toMatchObject({ area: 'non_functional' });
    expect(readInterview('[later] Fine?')).toEqual({
      done: false,
      body: '[later] Fine?',
      area: null,
    });
  });

  // [PCODE-273 | S15 | v0.1.0]
  it('steers by coverage: interview answers count, the weakest area first, finish when covered', () => {
    const cov = coverage(
      [{ area: 'scope', status: 'accepted' }],
      [],
      ['users', 'problem', 'problem'],
    );
    expect(cov).toMatchObject({ problem: 100, users: 67, scope: 33, data: 0 });
    expect(weakest(cov).slice(0, 2)).toEqual(['non_goals', 'non_functional']);
    const go = steering(cov, 3, false);
    expect(go.finish).toBe(false);
    expect(go.text).toContain('problem 100%, users 67%, scope 33%');
    expect(go.text).toContain('Questions asked: 3 of at most 12');
    expect(go.text).toContain(
      'Weakest: non_goals, non_functional, data, integrations, security, scope.',
    );
    expect(steering(cov, 3, true)).toMatchObject({ finish: true });
    expect(steering(cov, 3, true).text).toContain('FINISH NOW: the owner has said enough.');
    expect(steering(cov, 12, false).finish).toBe(true);
    const all = Object.fromEntries(
      [
        'problem',
        'users',
        'scope',
        'non_goals',
        'non_functional',
        'data',
        'integrations',
        'security',
      ].map((a) => [a, 66]),
    );
    expect(steering(all, 8, false).finish).toBe(true);
    const m = interviewMessages({ title: 'CSV', body: '' }, [], go.text);
    expect(m).toHaveLength(1);
    expect(m[0]?.content[0]).toMatchObject({
      text: expect.stringContaining('[ORQIVA] COVERAGE') as string,
    });
    const after = interviewMessages(
      { title: 'CSV', body: '' },
      [{ role: 'agent', body: 'Who?' }],
      'FINISH',
    );
    expect(after.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
  });
});

describe.skipIf(!hasDatabase)('ideas and the owner interview (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let project = '';
  let current: (ModelProvider & { requests: { system: string; messages: unknown[] }[] }) | null =
    null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Idea = { id: string; ref: string; status: string; interviewDone: boolean; summary: string };
  type Thread = {
    idea: Idea;
    messages: { seq: number; role: string; body: string; runId: string | null }[];
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
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/guests'), { userId: gus.id });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('files ideas in the inbox, numbered per project', async () => {
    const a = await t.call<Idea>(ada, 'POST', W('/projects/' + project + '/ideas'), {
      title: 'Export the report as CSV',
      body: 'Finance keeps asking.',
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ ref: 'APP-I1', status: 'new', interviewDone: false });
    const list = await t.call<Idea[]>(gus, 'GET', W('/projects/' + project + '/ideas'));
    expect(list.body.map((i) => i.ref)).toEqual(['APP-I1']);
    expect(
      (await t.call(gus, 'POST', W('/projects/' + project + '/ideas'), { title: 'x' })).status,
    ).toBe(403);
  });

  it('interviews the owner one question at a time, then sums up', async () => {
    const idea = (
      await t.call<Idea>(ada, 'POST', W('/projects/' + project + '/ideas'), { title: 'Dark mode' })
    ).body;
    current = scriptedProvider([
      say('Who wants it?'),
      say('By when?'),
      say('READY: Night-shift users want dark mode by June.'),
    ]);
    const first = await t.call<Thread>(ada, 'POST', W('/ideas/' + idea.id + '/interview'), {});
    expect(first.status).toBe(200);
    expect(first.body.idea.status).toBe('interviewing');
    expect(first.body.messages.map((m) => [m.role, m.body])).toEqual([['agent', 'Who wants it?']]);
    // a question is open: it must be answered first
    expect((await t.call(ada, 'POST', W('/ideas/' + idea.id + '/interview'), {})).status).toBe(400);
    expect(
      (await t.call(gus, 'POST', W('/ideas/' + idea.id + '/interview'), { answer: 'me' })).status,
    ).toBe(403);

    await t.call(ada, 'POST', W('/ideas/' + idea.id + '/interview'), {
      answer: 'Night-shift users.',
    });
    const last = await t.call<Thread>(ada, 'POST', W('/ideas/' + idea.id + '/interview'), {
      answer: 'June.',
    });
    expect(last.body.messages.map((m) => m.role)).toEqual([
      'agent',
      'owner',
      'agent',
      'owner',
      'agent',
    ]);
    expect(last.body.idea).toMatchObject({
      interviewDone: true,
      summary: 'Night-shift users want dark mode by June.',
    });
    // the model saw the idea and every answer, under the interviewer's instructions
    const req = current.requests[2];
    expect(req?.system).toContain('[orqiva:interview]');
    expect(JSON.stringify(req?.messages)).toContain('June.');
    // each question is a finished run of the Interviewer agent with its tokens
    const runId = last.body.messages[4]?.runId ?? '';
    const run = await t.call<{ run: { agentName: string; status: string; tokensIn: number } }>(
      ada,
      'GET',
      W('/agent-runs/' + runId),
    );
    expect(run.body.run).toMatchObject({
      agentName: 'Interviewer agent',
      status: 'succeeded',
      tokensIn: 200,
    });
    const agents = await t.call<{ key: string; usedThisMonth: number }[]>(ada, 'GET', W('/agents'));
    expect(agents.body.find((a) => a.key === 'interviewer')?.usedThisMonth).toBe(720);
  });

  // [PCODE-273 | S15 | v0.1.0]
  it('keeps the area of each question, raises its coverage, and sums up when the owner says enough', async () => {
    const idea = (
      await t.call<Idea>(ada, 'POST', W('/projects/' + project + '/ideas'), { title: 'Reminders' })
    ).body;
    current = scriptedProvider([
      say('[users] Who forgets most?'),
      say('[data] Which phone numbers do we have?'),
      say('READY: Older patients forget; we have mobile numbers.'),
    ]);
    type Turn = Thread & {
      messages: { area: string | null }[];
      coverage: Record<string, number>;
      maxQuestions: number;
    };
    const first = await t.call<Turn>(ada, 'POST', W('/ideas/' + idea.id + '/interview'), {});
    expect(first.body.messages[0]).toMatchObject({ body: 'Who forgets most?', area: 'users' });
    expect(first.body.coverage['users']).toBe(0);
    expect(first.body.maxQuestions).toBe(12);
    // the interviewer was told the coverage on its first turn
    expect(JSON.stringify(current.requests[0]?.messages)).toContain(
      'Questions asked: 0 of at most 12',
    );
    const second = await t.call<Turn>(ada, 'POST', W('/ideas/' + idea.id + '/interview'), {
      answer: 'Older patients.',
    });
    expect(second.body.coverage['users']).toBe(67);
    expect(second.body.messages.at(-1)).toMatchObject({ area: 'data' });
    expect(JSON.stringify(current.requests[1]?.messages)).toContain('users 67%');
    // enough: no answer to the open question needed, the interviewer is told to finish
    const done = await t.call<Turn>(ada, 'POST', W('/ideas/' + idea.id + '/interview'), {
      enough: true,
    });
    expect(done.status).toBe(200);
    expect(done.body.idea.interviewDone).toBe(true);
    expect(JSON.stringify(current.requests[2]?.messages)).toContain(
      'FINISH NOW: the owner has said enough.',
    );
    // the workspace counts the interview's answers too
    const ws = await t.call<{ coverage: Record<string, number> }>(
      ada,
      'GET',
      W('/ideas/' + idea.id + '/workspace'),
    );
    expect(ws.body.coverage['users']).toBe(67);
    expect(ws.body.coverage['data']).toBe(0);
  });

  it('refuses clearly when the interviewer is switched off or the idea is closed', async () => {
    const idea = (
      await t.call<Idea>(ada, 'POST', W('/projects/' + project + '/ideas'), { title: 'Badges' })
    ).body;
    const agents = await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'));
    const interviewer = agents.body.find((a) => a.key === 'interviewer')?.id ?? '';
    await t.call(ada, 'PATCH', W('/agents/' + interviewer), { enabled: false });
    const off = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      W('/ideas/' + idea.id + '/interview'),
      {},
    );
    expect(off.status).toBe(409);
    expect(off.body.error.message).toContain('Interviewer agent is switched off');
    await t.call(ada, 'PATCH', W('/agents/' + interviewer), { enabled: true });

    await t.call(ada, 'PATCH', W('/ideas/' + idea.id), { status: 'declined' });
    expect((await t.call(ada, 'POST', W('/ideas/' + idea.id + '/interview'), {})).status).toBe(409);
  });
});
