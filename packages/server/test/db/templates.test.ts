// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-119 | S15 | v0.1.0] Add workspace lifecycle templates with an editor ──
import type { LifecycleDef, LifecycleState } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('lifecycle templates (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let lean = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Template = { id: string; name: string; definition: LifecycleDef; projects: number };

  const twoPhases: LifecycleDef = {
    phases: [
      {
        key: 'shape',
        name: 'Shape',
        stages: [{ key: 'pitch', name: 'Pitch', agent: 'Analyst agent', owner: 'Owner' }],
        gate: {
          key: 'bet',
          name: 'Betting table',
          signer: 'admin',
          criteria: [{ key: 'appetite', text: 'Appetite set' }],
        },
      },
      {
        key: 'build',
        name: 'Build',
        stages: [
          { key: 'cycle', name: 'Six-week cycle', agent: 'Developer agents', owner: 'Team' },
        ],
      },
    ],
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lists the default, and lets only admins create: a copy of the default, or a definition of their own', async () => {
    const empty = await t.call<{ default: LifecycleDef; templates: Template[] }>(
      cy,
      'GET',
      W('/lifecycle/templates'),
    );
    expect(empty.body.default.phases).toHaveLength(4);
    expect(empty.body.templates).toEqual([]);
    expect((await t.call(cy, 'POST', W('/lifecycle/templates'), { name: 'Mine' })).status).toBe(
      403,
    );
    const copy = await t.call<Template>(ada, 'POST', W('/lifecycle/templates'), { name: 'Agency' });
    expect(copy.status).toBe(201);
    expect(copy.body.definition.phases.flatMap((p) => p.stages)).toHaveLength(14);
    const own = await t.call<Template>(ada, 'POST', W('/lifecycle/templates'), {
      name: 'Lean',
      definition: twoPhases,
    });
    lean = own.body.id;
    expect(own.body.definition.phases.map((p) => p.name)).toEqual(['Shape', 'Build']);
    expect((await t.call(ada, 'POST', W('/lifecycle/templates'), { name: 'Lean' })).status).toBe(
      409,
    );
  });

  it('refuses a broken definition with readable reasons', async () => {
    const broken = { phases: [{ key: 'a', name: 'A', stages: [] }] };
    const r = await t.call<{ error: { message: string } }>(
      ada,
      'PATCH',
      W('/lifecycle/templates/' + lean),
      { definition: broken },
    );
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain('needs at least one stage');
  });

  it('starts a project from a template; later edits leave the running project as it was', async () => {
    const p = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'LEAN', name: 'Lean one' })
    ).body.id;
    const started = await t.call<{ lifecycle: LifecycleState }>(
      ada,
      'POST',
      W('/projects/' + p + '/lifecycle'),
      { templateId: lean },
    );
    expect(started.status).toBe(201);
    expect(started.body.lifecycle.templateName).toBe('Lean');
    expect(started.body.lifecycle.phases.map((ph) => ph.gate?.name ?? null)).toEqual([
      'Betting table',
      null,
    ]);

    const [shape, build] = twoPhases.phases;
    if (!shape || !build) throw new Error('fixture');
    const changed: LifecycleDef = {
      phases: [{ ...shape, name: 'Shape it' }, build],
    };
    const edited = await t.call<Template>(ada, 'PATCH', W('/lifecycle/templates/' + lean), {
      definition: changed,
      name: 'Lean 2',
    });
    expect(edited.body.name).toBe('Lean 2');
    const still = await t.call<{ lifecycle: LifecycleState }>(
      ada,
      'GET',
      W('/projects/' + p + '/lifecycle'),
    );
    expect(still.body.lifecycle.phases[0]?.name).toBe('Shape');
    expect(still.body.lifecycle.templateName).toBe('Lean');

    expect((await t.call(ada, 'DELETE', W('/lifecycle/templates/' + lean))).status).toBe(200);
    expect(
      (await t.call<{ lifecycle: LifecycleState }>(ada, 'GET', W('/projects/' + p + '/lifecycle')))
        .body.lifecycle.phases,
    ).toHaveLength(2);
  });
});
