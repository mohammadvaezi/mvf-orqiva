// ── [PCODE-350 | S15 | v0.1.0] T35.3a Templates library for projects, PRDs, sprints and agents ──
//    Why:  against the real database: a project starts from a built-in template with its board, labels and
//          epics; a project is kept as a template and starts another; a sprint starts from one on a date
//          with its tasks; an agent is made from one, switched off; a workspace's PRD template becomes the
//          default for its kind of idea and is reset; and only admins keep templates.
import { PRD_TEMPLATES } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem, inWorkspace } from '../../src/db/pool.js';
import { prdTemplateFor } from '../../src/api/templatelibrary.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('templates library (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let client = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  type Use = { projectId?: string; sprintId?: string; agentId?: string; endDate?: string };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('starts a project from a built-in template', async () => {
    const lib = (
      await t.call<{ templates: { id: string; kind: string }[] }>(
        bob,
        'GET',
        W('/template-library'),
      )
    ).body;
    expect(lib.templates.filter((x) => x.kind === 'project').length).toBeGreaterThanOrEqual(2);
    const made = await t.call<Use>(bob, 'POST', W('/template-library/builtin:client-project/use'), {
      key: 'CLI',
      name: 'Client portal',
    });
    expect(made.status).toBe(201);
    client = made.body.projectId ?? '';
    const states = await sys<{ name: string }>(
      'SELECT name FROM project_states WHERE project_id = $1 ORDER BY position',
      [client],
    );
    expect(states.map((s) => s.name)).toContain('Client acceptance');
    expect(await sys('SELECT 1 FROM labels WHERE project_id = $1', [client])).toHaveLength(3);
    const epics = await sys<{ title: string; sequence: number }>(
      "SELECT title, sequence FROM items WHERE project_id = $1 AND kind = 'epic' ORDER BY sequence",
      [client],
    );
    expect(epics.map((e) => e.title)).toEqual([
      'Kick-off',
      'Design',
      'Delivery',
      'Acceptance',
      'Handover',
    ]);
    expect(epics.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(
      (
        await t.call(bob, 'POST', W('/template-library/builtin:client-project/use'), {
          key: 'CLI',
          name: 'Again',
        })
      ).status,
    ).toBe(409);
  });

  it('keeps a project as a template and starts another from it; only admins keep templates', async () => {
    await inSystem(t.db.pool, (c) =>
      c.query(
        "INSERT INTO settings (workspace_id, scope_type, scope_id, key, value) VALUES ($1, 'project', $2, 'planning.sprint_weeks', '3')",
        [ada.workspaceId, client],
      ),
    );
    expect(
      (
        await t.call(bob, 'POST', W('/template-library/from-project'), {
          projectId: client,
          name: 'Ours',
        })
      ).status,
    ).toBe(403);
    const kept = await t.call<{
      id: string;
      body: { states: unknown[]; settings: Record<string, unknown> };
    }>(ada, 'POST', W('/template-library/from-project'), {
      projectId: client,
      name: 'Our client way',
    });
    expect(kept.status).toBe(201);
    expect(kept.body.body.states).toHaveLength(7);
    expect(kept.body.body.settings).toEqual({ 'planning.sprint_weeks': 3 });
    const next = (
      await t.call<Use>(bob, 'POST', W('/template-library/' + kept.body.id + '/use'), {
        key: 'NXT',
        name: 'Next client',
      })
    ).body;
    expect(
      await sys("SELECT 1 FROM settings WHERE scope_type = 'project' AND scope_id = $1", [
        next.projectId,
      ]),
    ).toHaveLength(1);
    expect(
      (
        await t.call(ada, 'POST', W('/template-library'), {
          kind: 'sprint',
          name: 'Bad',
          body: { days: 0, goal: '', tasks: [] },
        })
      ).status,
    ).toBe(400);
  });

  it('starts a sprint on a date with its tasks', async () => {
    const r = await t.call<Use>(bob, 'POST', W('/template-library/builtin:two-week-sprint/use'), {
      projectId: client,
      startDate: '2026-11-02',
    });
    expect(r.body.endDate).toBe('2026-11-15');
    const tasks = await sys<{ title: string }>(
      'SELECT title FROM items WHERE sprint_id = $1 ORDER BY sequence',
      [r.body.sprintId],
    );
    expect(tasks.map((x) => x.title)).toEqual([
      'Sprint planning',
      'Sprint review',
      'Retrospective',
    ]);
  });

  it('makes an agent from a template, switched off', async () => {
    expect(
      (
        await t.call(bob, 'POST', W('/template-library/builtin:release-notes-writer/use'), {
          key: 'notes',
        })
      ).status,
    ).toBe(403);
    const r = await t.call<Use>(
      ada,
      'POST',
      W('/template-library/builtin:release-notes-writer/use'),
      { key: 'notes' },
    );
    const agent = (
      await sys<{ name: string; enabled: boolean; system_prompt: string }>(
        'SELECT name, enabled, system_prompt FROM agents WHERE id = $1',
        [r.body.agentId],
      )
    )[0];
    expect(agent).toMatchObject({ name: 'Release notes writer', enabled: false });
    expect(agent?.system_prompt).toContain('release notes');
    expect(
      (
        await t.call(ada, 'POST', W('/template-library/builtin:release-notes-writer/use'), {
          key: 'notes',
        })
      ).status,
    ).toBe(409);
  });

  it('makes a PRD template the default for its kind of idea, and resets it', async () => {
    const mine = await t.call<{ id: string }>(ada, 'POST', W('/template-library'), {
      kind: 'prd',
      name: 'Our feature PRD',
      body: {
        ideaKind: 'feature',
        sections: [{ key: 'why_now', title: 'Why now', hint: 'What changed.' }],
      },
    });
    await t.call(ada, 'POST', W('/template-library/' + mine.body.id + '/use'), {});
    const sections = await inWorkspace(t.db.pool, ada.workspaceId, (c) =>
      prdTemplateFor(c, 'feature'),
    );
    expect(sections.map((x) => x.key)).toEqual(['why_now']);
    expect(
      (await t.call<{ prdDefaults: Record<string, string> }>(bob, 'GET', W('/template-library')))
        .body.prdDefaults,
    ).toEqual({
      feature: mine.body.id,
    });
    await t.call(ada, 'DELETE', W('/prd-template-defaults/feature'));
    const back = await inWorkspace(t.db.pool, ada.workspaceId, (c) => prdTemplateFor(c, 'feature'));
    expect(back).toEqual(PRD_TEMPLATES.feature);
  });
});
