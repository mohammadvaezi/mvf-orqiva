// ── [PCODE-205 | S15 | v0.1.0] T17.3 Release agent with release tools, approved release notes, changelogs per release, project and train ──
//    Why:  against PostgreSQL with a scripted model: the Release agent reads a release and writes its notes,
//          which then wait for a person; approving records who; a later change asks again; the changelog
//          of a release, a project and a train is written from the tasks.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  scriptedProvider,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);
const use = (
  name: string,
  input: Record<string, unknown>,
  id = name + '-1',
): ModelReply['content'][number] => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const turn = (content: ModelReply['content']): ModelReply => ({
  content,
  stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
  usage: { input: 100, output: 50 },
});

describe.skipIf(!hasDatabase)('the Release agent and changelogs (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let release = '';
  let current: ModelProvider | null = null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  type Rel = { notesClient: string; notesApprovedBy: string | null; notesByAgent: boolean };
  const rel = async (): Promise<Rel> =>
    (await t.call<{ release: Rel }>(ada, 'GET', W('/releases/' + release))).body.release;

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
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'NWL', name: 'Nordwind' })
    ).body.id;
    release = (await t.call<{ id: string }>(ada, 'POST', P('/releases'), { version: '1.4.0' })).body
      .id;
    const items: string[] = [];
    for (const [title, kind] of [
      ['Tour planning', 'story'],
      ['Login loop', 'bug'],
      ['New API base path', 'task'],
    ])
      items.push((await t.call<{ id: string }>(ada, 'POST', P('/items'), { title, kind })).body.id);
    await t.call(ada, 'POST', W('/releases/' + release + '/items'), { itemIds: items.slice(0, 2) });
    await t.call(ada, 'POST', W('/releases/' + release + '/items'), {
      itemIds: [items[2]],
      breaking: true,
    });
    await t.call(ada, 'PUT', W('/agents/provider'), {
      provider: 'anthropic',
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('reads the release and writes notes that wait for a person', async () => {
    const agents = await t.call<{ id: string; key: string; tools: string[] }[]>(
      ada,
      'GET',
      W('/agents'),
    );
    const agent = agents.body.find((a) => a.key === 'release');
    expect(agent?.tools).toEqual(
      expect.arrayContaining(['list_releases', 'read_release', 'write_release_notes']),
    );
    current = scriptedProvider([
      turn([use('list_releases', {}), use('read_release', { version: '1.4.0' }, 'r-2')]),
      turn([
        use('write_release_notes', {
          version: '1.4.0',
          audience: 'client',
          body: '# 1.4.0\n\nPlan your tours.',
        }),
      ]),
      turn([{ type: 'text', text: 'Notes written.' }]),
    ]);
    const run = await t.call<{ id: string }>(ada, 'POST', P('/agent-runs'), {
      agentId: agent?.id,
      instruction: 'Write the notes of 1.4.0',
    });
    let status = '';
    let steps: { kind: string; content: Record<string, unknown> }[] = [];
    for (let i = 0; i < 200 && !['succeeded', 'failed'].includes(status); i++) {
      await new Promise((r) => setTimeout(r, 50));
      const g = await t.call<{ run: { status: string }; steps: typeof steps }>(
        ada,
        'GET',
        W('/agent-runs/' + run.body.id),
      );
      status = g.body.run.status;
      steps = g.body.steps;
    }
    expect(status).toBe('succeeded');
    const results = steps
      .filter((s) => s.kind === 'tool_result')
      .flatMap((s) => s.content['results'] as { content: string; is_error?: boolean }[]);
    expect(results.some((r) => r.is_error)).toBe(false);
    expect(JSON.parse(results[1]?.content ?? '{}')).toMatchObject({
      version: '1.4.0',
      tasks: expect.arrayContaining([
        expect.objectContaining({ title: 'New API base path', breaking: true }),
      ]) as unknown,
    });
    expect(await rel()).toMatchObject({
      notesClient: '# 1.4.0\n\nPlan your tours.',
      notesApprovedBy: null,
      notesByAgent: true,
    });
  });

  it('records the approval, and asks again after a change', async () => {
    const ok = await t.call<{ approvedBy: string }>(
      ada,
      'POST',
      W('/releases/' + release + '/notes/approve'),
    );
    expect(ok.body.approvedBy).toBe('Ada');
    expect((await rel()).notesApprovedBy).toBe('Ada');
    await t.call(ada, 'PATCH', W('/releases/' + release), { name: 'October' });
    expect((await rel()).notesApprovedBy).toBe('Ada');
    await t.call(ada, 'PATCH', W('/releases/' + release), { notesClient: 'Plan tours, faster.' });
    expect(await rel()).toMatchObject({ notesApprovedBy: null, notesByAgent: false });
  });

  it('writes the changelog of a release, the project and a train', async () => {
    const one = await t.call<{ markdown: string }>(
      ada,
      'GET',
      W('/releases/' + release + '/changelog'),
    );
    expect(one.body.markdown).toBe(
      '## [1.4.0] - Unreleased\n\n### Breaking\n\n- New API base path (NWL-3)\n\n### Added\n\n- Tour planning (NWL-1)\n\n### Fixed\n\n- Login loop (NWL-2)\n',
    );
    await inSystem(t.db.pool, (c) =>
      c.query(
        "UPDATE releases SET state = 'released', released_at = '2026-10-16T10:00:00Z' WHERE id = $1",
        [release],
      ),
    );
    const all = await t.call<{ markdown: string }>(ada, 'GET', P('/changelog'));
    expect(all.body.markdown).toContain('# Nordwind changelog');
    expect(all.body.markdown).toContain('## [1.4.0] - 2026-10-16');
    const train = (await t.call<{ id: string }>(ada, 'POST', W('/trains'), { name: 'October' }))
      .body.id;
    await inSystem(t.db.pool, (c) =>
      c.query('UPDATE releases SET train_id = $2 WHERE id = $1', [release, train]),
    );
    const tl = await t.call<{ markdown: string }>(ada, 'GET', W('/trains/' + train + '/changelog'));
    expect(tl.body.markdown).toContain(
      '# Train October\n\n# NWL · Nordwind\n\n## [1.4.0] - 2026-10-16',
    );
  });
});
