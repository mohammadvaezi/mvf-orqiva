// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
//    Why:  against the real database: a project's lead runs their project's own settings (guests, project
//          settings) but not another project's or the workspace's; a team's lead sets their team's values;
//          the settings call shows a project's and a team's values with their source; and an AI budget
//          warns at half, at its level and when used up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { alertRound } from '../../src/push/alerts.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)(
  'project leads, team and project settings, budget steps (PostgreSQL)',
  () => {
    let t: TestApp;
    let ada: Person;
    let lea: Person;
    let mo: Person;
    let gus: Person;
    let app = '';
    let ops = '';
    let team = '';
    const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
    const sys = (sql: string, args: unknown[] = []) =>
      inSystem(t.db.pool, (c) => c.query(sql, args));
    const setting = (who: Person, scope: string, scopeId: string, value: unknown) =>
      t.call(who, 'PUT', W('/settings/planning.sprint_weeks'), { scope, scopeId, value });

    beforeAll(async () => {
      t = await startTestApp();
      ada = await t.signup('Ada');
      lea = await t.signup('Lea');
      mo = await t.signup('Mo');
      gus = await t.signup('Gus');
      for (const p of [lea, mo])
        await t.call(ada, 'POST', W('/members'), { email: p.email, role: 'member' });
      await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
      app = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'The App' })
      ).body.id;
      ops = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects'), {
          key: 'OPS',
          name: 'Operations',
        })
      ).body.id;
      await sys(
        "INSERT INTO project_members (workspace_id, project_id, user_id, role) VALUES ($1, $2, $3, 'lead') ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'lead'",
        [ada.workspaceId, app, lea.id],
      );
      team =
        (
          await t.call<{ id: string; name: string }[]>(ada, 'PUT', W('/teams'), {
            name: 'Mobile',
            memberIds: [lea.id, mo.id],
            leadIds: [lea.id],
          })
        ).body.find((x) => x.name === 'Mobile')?.id ?? '';
    }, 60_000);

    afterAll(async () => {
      await t.stop();
    });

    it('lets a project’s lead run their project, not another one', async () => {
      expect(
        (await t.call(lea, 'POST', W('/projects/' + app + '/guests'), { userId: gus.id })).status,
      ).toBeLessThan(300);
      expect(
        (await t.call(lea, 'POST', W('/projects/' + ops + '/guests'), { userId: gus.id })).status,
      ).toBe(403);
      expect(
        (await t.call(mo, 'POST', W('/projects/' + app + '/guests'), { userId: gus.id })).status,
      ).toBe(403);
      expect((await setting(lea, 'project', app, 3)).status).toBe(200);
      expect((await setting(lea, 'project', ops, 3)).status).toBe(403);
      expect((await setting(lea, 'workspace', ada.workspaceId, 3)).status).toBe(403);
    });

    it('lets a team’s lead set the team’s values, and shows where each value comes from', async () => {
      expect((await setting(mo, 'team', team, 4)).status).toBe(403);
      expect((await setting(lea, 'team', team, 4)).status).toBe(200);
      type E = { key: string; value: unknown; source: string };
      const of = async (q: string) =>
        (await t.call<E[]>(mo, 'GET', W('/settings' + q))).body.find(
          (x) => x.key === 'planning.sprint_weeks',
        );
      expect(await of('')).toMatchObject({ source: 'default' });
      expect(await of('?teamId=' + team)).toMatchObject({ value: 4, source: 'team' });
      expect(await of('?teamId=' + team + '&projectId=' + app)).toMatchObject({
        value: 3,
        source: 'project',
      });
      expect(
        (
          await t.call(
            lea,
            'DELETE',
            W('/settings/planning.sprint_weeks?scope=project&scopeId=' + app),
          )
        ).status,
      ).toBe(200);
      expect(await of('?teamId=' + team + '&projectId=' + app)).toMatchObject({
        value: 4,
        source: 'team',
      });
    });

    it('warns about an AI budget at half, at its level and when used up', async () => {
      await sys(
        "INSERT INTO budgets (workspace_id, scope_type, scope_id, measure, period, amount_cents, created_by) VALUES ($1, 'workspace', NULL, 'ai', 'month', 1000, $2)",
        [ada.workspaceId, ada.id],
      );
      const agent = (
        await sys('SELECT id FROM agents WHERE workspace_id = $1 LIMIT 1', [ada.workspaceId])
      ).rows[0] as { id: string } | undefined;
      const agentId =
        agent?.id ??
        (
          (
            await sys(
              "INSERT INTO agents (workspace_id, key, name, model) VALUES ($1, 'helper', 'Helper', 'demo') RETURNING id",
              [ada.workspaceId],
            )
          ).rows[0] as { id: string }
        ).id;
      const spend = (micros: number) =>
        sys(
          `INSERT INTO agent_runs (workspace_id, project_id, agent_id, instruction, status, model, cost_micros, created_at)
         VALUES ($1, $2, $3, 'x', 'succeeded', 'demo', $4, now())`,
          [ada.workspaceId, app, agentId, micros],
        );
      const titles = async (): Promise<string[]> =>
        (
          (
            await sys(
              "SELECT title FROM inbox_items WHERE kind = 'budget' AND user_id = $1 ORDER BY created_at",
              [ada.id],
            )
          ).rows as { title: string }[]
        ).map((r) => r.title);
      const deps = { subject: 'mailto:ops@example.test' };
      // the euro rate: the server's default, so a dollar of spend is a little under a euro
      await spend(6_000_000);
      await alertRound(t.db.pool, deps);
      expect((await titles()).map((x) => x.replace(/\d+ %/, 'N %'))).toEqual([
        'Budget at N %: the workspace, this month',
      ]);
      await alertRound(t.db.pool, deps);
      expect(await titles()).toHaveLength(1);
      await spend(4_000_000);
      await alertRound(t.db.pool, deps);
      await spend(4_000_000);
      await alertRound(t.db.pool, deps);
      const all = await titles();
      expect(all).toHaveLength(3);
      expect(all[2]).toBe('Budget used up: the workspace, this month');
    });
  },
);
