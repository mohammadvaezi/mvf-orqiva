// ── [PCODE-329 | S15 | v0.1.0] T33.2 Agent playground: rerun with other settings, compare runs, A/B experiments ──
//    Why:  against the real database and worker: a playground run reads but only records its actions; a
//          rerun takes its own model, prompt version and temperature to the model; an agent still switched
//          off can be tried; two runs compare with a diff of their answers; an experiment runs each
//          variant as often as asked and sums them up; and the quality board leaves playground runs out.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModelProvider, ModelReply, ModelRequest } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('agent playground (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let item = '';
  let analyst = '';
  const seen: ModelRequest[] = [];
  // first a comment on the task, then an answer naming the model and temperature
  const provider: ModelProvider = {
    name: 'scripted',
    complete(req) {
      seen.push(structuredClone(req));
      const answered = req.messages.at(-1)?.content.some((b) => b.type === 'tool_result');
      const reply: ModelReply = answered
        ? {
            content: [
              {
                type: 'text',
                text:
                  'The task needs tests.\nModel ' + req.model + ' at ' + String(req.temperature),
              },
            ],
            stopReason: 'end_turn',
            usage: { input: 1000, output: 100 },
          }
        : {
            content: [
              {
                type: 'tool_use',
                id: 'c-' + String(seen.length),
                name: 'add_comment',
                input: { ref: 'PLY-1', body: 'From the playground' },
              },
            ],
            stopReason: 'tool_use',
            usage: { input: 1000, output: 50 },
          };
      return Promise.resolve(reply);
    },
  };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Run = {
    id: string;
    status: string;
    model: string;
    promptVersion: number;
    playground: boolean;
    rerunOf: string | null;
    temperature: number | null;
  };
  const until = async (
    id: string,
  ): Promise<{ run: Run; steps: { kind: string; content: Record<string, unknown> }[] }> => {
    const end = Date.now() + 15_000;
    for (;;) {
      const r = await t.call<{
        run: Run;
        steps: { kind: string; content: Record<string, unknown> }[];
      }>(ada, 'GET', W('/agent-runs/' + id));
      if (['succeeded', 'failed', 'waiting'].includes(r.body.run.status)) return r.body;
      if (Date.now() > end) throw new Error('run stayed ' + r.body.run.status);
      await new Promise((res) => setTimeout(res, 50));
    }
  };
  const comments = async (): Promise<number> =>
    inSystem(t.db.pool, async (c) =>
      Number(
        (
          await c.query<{ n: string }>('SELECT count(*) AS n FROM comments WHERE item_id = $1', [
            item,
          ])
        ).rows[0]?.n ?? 0,
      ),
    );

  let first = '';
  let v1 = '';

  beforeAll(async () => {
    t = await startTestApp({ agents: { provider: () => Promise.resolve(provider) } });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'PLY', name: 'Play' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Check the export',
      })
    ).body.id;
    analyst =
      (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body.find(
        (a) => a.key === 'analyst',
      )?.id ?? '';
    v1 =
      (
        await t.call<{ version: number; prompt: string }[]>(
          ada,
          'GET',
          W('/agents/' + analyst + '/prompts'),
        )
      ).body.find((v) => v.version === 1)?.prompt ?? '';
    // a second prompt version is live; comments are allowed for real runs
    await t.call(ada, 'PATCH', W('/agents/' + analyst), {
      systemPrompt: 'Version two: be brief.',
      autonomy: 'autonomous',
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('a real run comments; its playground rerun only records it, with its own settings', async () => {
    first = (
      await t.call<Run>(ada, 'POST', W('/projects/' + project + '/agent-runs'), {
        agentId: analyst,
        instruction: 'Look at the task',
        itemId: item,
      })
    ).body.id;
    expect((await until(first)).run.status).toBe('succeeded');
    expect(await comments()).toBe(1);

    // switched off, the agent can still be tried in the playground
    await t.call(ada, 'PATCH', W('/agents/' + analyst), { enabled: false });
    const before = seen.length;
    const r = await t.call<Run>(ada, 'POST', W('/agent-runs/' + first + '/rerun'), {
      model: 'other-model',
      promptVersion: 1,
      temperature: 0.9,
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      playground: true,
      rerunOf: first,
      model: 'other-model',
      promptVersion: 1,
      temperature: 0.9,
    });
    const done = await until(r.body.id);
    expect(done.run.status).toBe('succeeded');
    expect(await comments()).toBe(1);
    const results = done.steps
      .filter((x) => x.kind === 'tool_result')
      .flatMap((x) => x.content['results'] as { content: string }[]);
    expect(results[0]?.content).toMatch(
      /^Playground: not carried out\. It would have run add_comment/,
    );
    const asked = seen.slice(before);
    expect(asked[0]?.model).toBe('other-model');
    expect(asked[0]?.temperature).toBeCloseTo(0.9, 5);
    expect(asked[0]?.system.startsWith(v1.slice(0, 40))).toBe(true);
    expect(
      (await t.call(ada, 'POST', W('/agent-runs/' + first + '/rerun'), { promptVersion: 99 }))
        .status,
    ).toBe(400);

    // two runs side by side: the second answer differs in its last line
    const cmp = await t.call<
      { answer: string; tools: string[]; recorded: number; diff: { op: string; text: string }[] }[]
    >(ada, 'GET', W('/agent-runs-compare?ids=' + first + ',' + r.body.id));
    expect(cmp.status).toBe(200);
    expect(cmp.body[0]?.recorded).toBe(0);
    expect(cmp.body[1]?.recorded).toBe(1);
    expect(cmp.body[1]?.tools).toEqual(['add_comment']);
    expect(cmp.body[1]?.diff.filter((d) => d.op !== 'same').map((d) => d.op)).toEqual([
      'del',
      'add',
    ]);
    expect(cmp.body[1]?.diff[0]).toEqual({ op: 'same', text: 'The task needs tests.' });
    expect(
      (await t.call(ada, 'GET', W('/agent-runs-compare?ids=' + first + ',' + first))).status,
    ).toBe(400);
  });

  it('runs an experiment per variant and sums it up', async () => {
    const e = await t.call<{
      id: string;
      variants: { label: string; runs: number }[];
    }>(ada, 'POST', W('/projects/' + project + '/agent-experiments'), {
      name: 'Cool against warm',
      agentId: analyst,
      instruction: 'Look at the task',
      itemId: item,
      variants: [
        { label: 'cool', temperature: 0.1 },
        { label: 'warm', temperature: 0.8, model: 'warm-model' },
      ],
      repeats: 2,
    });
    expect(e.status).toBe(201);
    expect(e.body.variants.map((v) => v.runs)).toEqual([2, 2]);
    const end = Date.now() + 20_000;
    type Exp = {
      variants: {
        label: string;
        model: string | null;
        finished: number;
        succeeded: number;
        avgTokens: number | null;
        avgCostCents: number | null;
      }[];
      runs: { variant: string; answer: string }[];
    };
    let x: Exp;
    for (;;) {
      x = (await t.call<Exp>(ada, 'GET', W('/agent-experiments/' + e.body.id))).body;
      if (x.variants.every((v) => v.finished === 2)) break;
      if (Date.now() > end) throw new Error('experiment did not finish');
      await new Promise((res) => setTimeout(res, 100));
    }
    expect(x.variants.map((v) => [v.label, v.succeeded, v.avgTokens])).toEqual([
      ['cool', 2, 2150],
      ['warm', 2, 2150],
    ]);
    expect(
      x.runs
        .filter((r) => r.variant === 'warm')
        .every((r) => r.answer.endsWith('warm-model at 0.8')),
    ).toBe(true);
    expect(await comments()).toBe(1);
    expect(
      (
        await t.call(ada, 'POST', W('/projects/' + project + '/agent-experiments'), {
          name: 'Twice',
          agentId: analyst,
          instruction: 'x',
          variants: [{ label: 'a' }, { label: 'a' }],
        })
      ).status,
    ).toBe(400);
    expect((await t.call<unknown[]>(ada, 'GET', W('/agent-experiments'))).body).toHaveLength(1);

    // the quality board counts the one real run only
    const q = await t.call<{ agentId: string; runs: number }[]>(ada, 'GET', W('/agent-quality'));
    expect(q.body.find((r) => r.agentId === analyst)?.runs).toBe(1);

    // removed, the experiment takes its runs along
    expect((await t.call(ada, 'DELETE', W('/agent-experiments/' + e.body.id))).status).toBe(200);
    expect((await t.call(ada, 'GET', W('/agent-experiments/' + e.body.id))).status).toBe(404);
    const left = await inSystem(
      t.db.pool,
      async (c) =>
        (await c.query('SELECT 1 FROM agent_runs WHERE experiment_id = $1', [e.body.id])).rowCount,
    );
    expect(left).toBe(0);
  });
});
