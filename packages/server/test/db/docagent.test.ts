// ── [PCODE-198 | S15 | v0.1.0] T16.2 Documenter agent: document tools with knowledge scopes, agent-written drafts, Ask the Documenter ──
//    Why:  the Documenter against the real database and worker, with a scripted model: it reads only the
//          pages its knowledge scope allows (and every read is logged with the passage it used), writes a
//          draft that stays marked until a person approves it, and never touches a page built from the
//          code or a locked page.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  scriptedProvider,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);
const use = (
  name: string,
  input: Record<string, unknown>,
  id = name + '-1',
): ModelReply['content'][number] => ({ type: 'tool_use', id, name, input });
const turn = (content: ModelReply['content']): ModelReply => ({
  content,
  stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
  usage: { input: 100, output: 50 },
});

describe.skipIf(!hasDatabase)('the Documenter agent (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let documenter = '';
  let current: ModelProvider | null = null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  type Step = { kind: string; content: Record<string, unknown> };
  type Result = { content: string; is_error?: boolean };
  const run = async (replies: ModelReply[]): Promise<{ status: string; steps: Step[] }> => {
    current = scriptedProvider(replies);
    const r = await t.call<{ id: string }>(ada, 'POST', P('/agent-runs'), {
      agentId: documenter,
      instruction: 'Write the runbook',
    });
    expect(r.status).toBe(201);
    const end = Date.now() + 10_000;
    for (;;) {
      const g = await t.call<{ run: { status: string }; steps: Step[] }>(
        ada,
        'GET',
        W('/agent-runs/' + r.body.id),
      );
      if (['succeeded', 'failed', 'waiting'].includes(g.body.run.status))
        return { status: g.body.run.status, steps: g.body.steps };
      if (Date.now() > end) throw new Error('run stayed ' + g.body.run.status);
      await new Promise((res) => setTimeout(res, 50));
    }
  };
  const results = (steps: Step[]): Result[] =>
    steps.filter((s) => s.kind === 'tool_result').flatMap((s) => s.content['results'] as Result[]);
  const page = async (title: string, body: string, tags: string[] = []): Promise<string> =>
    (await t.call<{ page: { id: string } }>(ada, 'POST', P('/docs'), { title, body, tags })).body
      .page.id;
  type Node = {
    id: string;
    title: string;
    parentId: string | null;
    needsApproval: boolean;
    status: string;
    ownerName: string | null;
  };
  let ops = '';
  let secret = '';
  let locked = '';

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
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' })
    ).body.id;
    const agents = await t.call<{ id: string; key: string; tools: string[] }[]>(
      ada,
      'GET',
      W('/agents'),
    );
    const doc = agents.body.find((a) => a.key === 'documenter');
    documenter = doc?.id ?? '';
    expect(doc?.tools).toEqual(expect.arrayContaining(['list_docs', 'read_doc', 'write_doc']));
    expect(agents.body.find((a) => a.key === 'analyst')?.tools).not.toContain('write_doc');
    await t.call(ada, 'PUT', W('/agents/provider'), {
      provider: 'anthropic',
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
    });
    ops = await page('Deploys', 'We deploy with `deploy/compose.yaml` every Tuesday.', ['ops']);
    secret = await page('Salaries', 'Not for agents.');
    locked = await page('Runbook: restore', 'Old text', ['ops']);
    await t.call(ada, 'PATCH', W('/docs/' + locked), { locked: true });
    await t.call(ada, 'PUT', P('/knowledge/documenter'), { pageIds: [], tags: ['ops'] });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('reads only what its scope allows, and logs the passage it used', async () => {
    const r = await run([
      turn([use('list_docs', {})]),
      turn([
        use('read_doc', { page: 'Deploys', cite: 'every Tuesday' }),
        use('read_doc', { page: secret }, 'read-2'),
      ]),
      turn([{ type: 'text', text: 'Read.' }]),
    ]);
    expect(r.status).toBe('succeeded');
    const out = results(r.steps);
    expect(JSON.parse(out[0]?.content ?? '[]')).toEqual([
      expect.objectContaining({ title: 'Deploys', builtFromCode: false }),
      expect.objectContaining({ title: 'Runbook: restore' }),
    ]);
    expect(JSON.parse(out[1]?.content ?? '{}')).toMatchObject({
      id: ops,
      body: expect.stringContaining('Tuesday') as unknown,
    });
    expect(out[2]).toMatchObject({
      is_error: true,
      content: expect.stringContaining('knowledge scope') as unknown,
    });
    const k = await t.call<{
      reads: { agentKey: string; pageId: string; passage: string; runId: string | null }[];
    }>(ada, 'GET', P('/knowledge'));
    expect(k.body.reads).toEqual([
      expect.objectContaining({ agentKey: 'documenter', pageId: ops, passage: 'every Tuesday' }),
    ]);
    expect(k.body.reads[0]?.runId).not.toBeNull();
  });

  it('writes a draft that waits for a person, and never a locked page', async () => {
    const r = await run([
      turn([
        use('write_doc', {
          title: 'Runbook: deploy',
          body: '# Deploy\n\nRun `deploy/compose.yaml`.',
          parent: 'Deploys',
        }),
        use('write_doc', { page: 'Runbook: restore', body: 'New text' }, 'w-2'),
        use(
          'write_doc',
          {
            page: 'Deploys',
            body: 'We deploy with `deploy/compose.yaml` on Tuesdays and Fridays.',
          },
          'w-3',
        ),
      ]),
      turn([{ type: 'text', text: 'Written.' }]),
    ]);
    expect(r.status).toBe('succeeded');
    const out = results(r.steps);
    expect(out[1]).toMatchObject({ is_error: true, content: 'Someone has locked this page' });
    const made = JSON.parse(out[0]?.content ?? '{}') as { pageId: string };
    const tree = (await t.call<Node[]>(ada, 'GET', P('/docs'))).body;
    expect(tree.find((n) => n.id === made.pageId)).toMatchObject({
      parentId: ops,
      needsApproval: true,
      status: 'draft',
      ownerName: 'Ada',
    });
    expect(tree.find((n) => n.id === ops)).toMatchObject({ needsApproval: true });
    expect(tree.find((n) => n.id === locked)).toMatchObject({ needsApproval: false });
    const versions = await t.call<unknown[]>(ada, 'GET', W('/docs/' + ops + '/versions'));
    expect(versions.body).toHaveLength(2);
    await t.call(ada, 'POST', W('/docs/' + ops + '/approve'));
    const after = (await t.call<Node[]>(ada, 'GET', P('/docs'))).body;
    expect(after.find((n) => n.id === ops)?.needsApproval).toBe(false);
  });

  it('leaves pages built from the code alone', async () => {
    await t.call(ada, 'POST', P('/code-scan'), {
      files: [{ path: 'deploy/compose.yaml', lines: 40 }],
    });
    await t.call(ada, 'POST', P('/docs/from-code'));
    await t.call(ada, 'PUT', P('/knowledge/documenter'), {
      pageIds: [],
      tags: ['ops', 'from-code'],
    });
    const r = await run([
      turn([use('write_doc', { page: 'System overview (from code)', body: 'mine' })]),
      turn([{ type: 'text', text: 'ok' }]),
    ]);
    expect(results(r.steps)[0]).toMatchObject({
      is_error: true,
      content: expect.stringContaining('built from the code') as unknown,
    });
  });
});
