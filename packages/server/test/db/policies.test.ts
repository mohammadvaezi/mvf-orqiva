// ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
//    Why:  against the real database: a dry run names what a rule would stop before it goes on; on, tasks
//          without criteria stay out of sprints (one by one and in a sprint plan), the token cap and the
//          no-merge rule reach agent runs, personal data leaves for the AI provider masked; a draft
//          changes nothing; and only admins keep policies.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProvider, type ModelRequest } from '../../src/agents/provider.js';
import { runPolicies } from '../../src/api/policies.js';
import { inSystem, inWorkspace } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('workspace policies (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let project = '';
  let sprint = '';
  const asked: ModelRequest[] = [];
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  type Dry = { count: number; examples: string[]; text: string };

  beforeAll(async () => {
    const demo = demoProvider();
    t = await startTestApp({
      agents: {
        provider: () =>
          Promise.resolve({
            ...demo,
            complete: (r: ModelRequest) => {
              asked.push(r);
              return demo.complete(r);
            },
          }),
      },
    });
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'The App' })
    ).body.id;
    sprint = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 1',
        startDate: '2026-11-02',
        endDate: '2026-11-13',
      })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/items'), {
      title: 'Vague task',
      sprintId: sprint,
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('dry runs a rule, then keeps tasks without criteria out of sprints once it is on', async () => {
    const dry = await t.call<Dry>(ada, 'POST', W('/workspace-policies/dry-run'), {
      rule: 'sprint_requires_criteria',
    });
    expect(dry.body.count).toBe(1);
    expect(dry.body.examples).toEqual(['APP-1 Vague task']);
    expect(
      (
        await t.call(mo, 'POST', W('/workspace-policies'), {
          rule: 'sprint_requires_criteria',
          state: 'on',
        })
      ).status,
    ).toBe(403);
    const draft = await t.call<{ id: string; state: string }>(
      ada,
      'POST',
      W('/workspace-policies'),
      { rule: 'sprint_requires_criteria' },
    );
    expect(draft.body.state).toBe('draft');
    // a draft changes nothing
    expect(
      (
        await t.call(mo, 'POST', W('/projects/' + project + '/items'), {
          title: 'Also vague',
          sprintId: sprint,
        })
      ).status,
    ).toBe(201);
    await t.call(ada, 'PATCH', W('/workspace-policies/' + draft.body.id), { state: 'on' });
    const refused = await t.call<{ error: { message: string } }>(
      mo,
      'POST',
      W('/projects/' + project + '/items'),
      {
        title: 'Still vague',
        sprintId: sprint,
      },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain('acceptance criteria');
    const item = (
      await t.call<{ id: string }>(mo, 'POST', W('/projects/' + project + '/items'), {
        title: 'Clear task',
      })
    ).body.id;
    expect((await t.call(mo, 'PATCH', W('/items/' + item), { sprintId: sprint })).status).toBe(409);
    await sys(
      "INSERT INTO item_criteria (workspace_id, item_id, text, position) VALUES ($1, $2, 'It works', 0)",
      [ada.workspaceId, item],
    );
    expect((await t.call(mo, 'PATCH', W('/items/' + item), { sprintId: sprint })).status).toBe(200);
  });

  it('caps agent runs, refuses merges and masks personal data for the AI provider', async () => {
    const agent = (
      (
        await sys("SELECT id FROM agents WHERE workspace_id = $1 AND key = 'devops'", [
          ada.workspaceId,
        ])
      ).rows[0] as { id: string } | undefined
    )?.id;
    await t.call(ada, 'GET', W('/agents'));
    const devops =
      agent ??
      (
        (
          await sys("SELECT id FROM agents WHERE workspace_id = $1 AND key = 'devops'", [
            ada.workspaceId,
          ])
        ).rows[0] as { id: string }
      ).id;
    await sys(
      `INSERT INTO agent_runs (workspace_id, project_id, agent_id, instruction, status, model, tokens_in, tokens_out)
       VALUES ($1, $2, $3, 'Summarise ada@example.test feedback', 'succeeded', 'demo', 40000, 20000)`,
      [ada.workspaceId, project, devops],
    );
    expect(
      (
        await t.call<Dry>(ada, 'POST', W('/workspace-policies/dry-run'), {
          rule: 'run_token_cap',
          params: { maxTokens: 50000 },
        })
      ).body.count,
    ).toBe(1);
    expect(
      (
        await t.call(ada, 'POST', W('/workspace-policies/dry-run'), {
          rule: 'run_token_cap',
          params: { maxTokens: 5 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call<Dry>(ada, 'POST', W('/workspace-policies/dry-run'), {
          rule: 'mask_personal_data',
        })
      ).body.examples,
    ).toEqual(['Summarise [email] feedback']);
    for (const [rule, params] of [
      ['run_token_cap', { maxTokens: 50000 }],
      ['agents_no_merge', {}],
      ['mask_personal_data', {}],
    ] as const)
      await t.call(ada, 'POST', W('/workspace-policies'), { rule, params, state: 'on' });
    expect(await inWorkspace(t.db.pool, ada.workspaceId, (c) => runPolicies(c, project))).toEqual({
      noMerge: true,
      tokenCap: 50000,
      mask: true,
    });
    // a postmortem drafted by the DevOps agent: the incident's mail address does not reach the provider
    const inc = (
      (
        await sys(
          "INSERT INTO incidents (workspace_id, number, project_id, severity, title) VALUES ($1, 1, $2, 'sev3', 'Mail to ops@helio.example bounced') RETURNING id",
          [ada.workspaceId, project],
        )
      ).rows[0] as { id: string }
    ).id;
    expect(
      (await t.call(ada, 'PUT', W('/incidents/' + inc + '/postmortem'), { ai: true })).status,
    ).toBe(200);
    const sent = JSON.stringify(asked.at(-1)?.messages ?? []);
    expect(sent).toContain('Mail to [email] bounced');
    expect(sent).not.toContain('ops@helio.example');
  });
});
