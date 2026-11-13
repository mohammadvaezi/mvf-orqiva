// ── [PCODE-342 | S15 | v0.1.0] T34.2c AI postmortems and runbooks matched to incidents ──
//    Why:  what to do when a known problem comes back, kept by the admins: a runbook's trigger words match
//          it to the incidents whose title or alerts carry them, and an alert that opens or joins an
//          incident puts the matching runbooks on its timeline, once each.
import { runbookMatches } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';

const uuid = s.string({ format: 'uuid' });

interface RunbookRow {
  id: string;
  project_id: string | null;
  project_key: string | null;
  title: string;
  pattern: string;
  body: string;
  updated_at: Date;
}

const SELECT = `SELECT r.id, r.project_id, p.key AS project_key, r.title, r.pattern, r.body, r.updated_at
  FROM runbooks r LEFT JOIN projects p ON p.id = r.project_id`;

const runbookOut = s.object({
  id: s.string(),
  projectId: s.nullable(s.string()),
  projectKey: s.nullable(s.string()),
  title: s.string(),
  pattern: s.string(),
  body: s.string(),
  updatedAt: s.string(),
});

interface RunbookJson {
  id: string;
  projectId: string | null;
  projectKey: string | null;
  title: string;
  pattern: string;
  body: string;
  updatedAt: string;
}

const json = (r: RunbookRow): RunbookJson => ({
  id: r.id,
  projectId: r.project_id,
  projectKey: r.project_key,
  title: r.title,
  pattern: r.pattern,
  body: r.body,
  updatedAt: r.updated_at.toISOString(),
});

/** The runbooks for an incident: its project's and the general ones, matched on its title and alerts. */
export async function matchingRunbooks(c: PoolClient, incidentId: string): Promise<RunbookRow[]> {
  const inc = (
    await c.query<{ title: string; project_id: string | null }>(
      'SELECT title, project_id FROM incidents WHERE id = $1',
      [incidentId],
    )
  ).rows[0];
  if (!inc) return [];
  const texts = [
    inc.title,
    ...(
      await c.query<{ title: string; source: string }>(
        'SELECT title, source FROM alerts WHERE incident_id = $1',
        [incidentId],
      )
    ).rows.map((x) => x.source + ' ' + x.title),
  ];
  const all = (
    await c.query<RunbookRow>(
      SELECT + ' WHERE r.project_id IS NULL OR r.project_id = $1 ORDER BY r.title',
      [inc.project_id],
    )
  ).rows;
  return all.filter((r) => runbookMatches(r.pattern, texts));
}

/** Puts each matching runbook on the incident's timeline, once. */
export async function noteRunbooks(
  c: PoolClient,
  workspaceId: string,
  incidentId: string,
): Promise<number> {
  const noted = new Set(
    (
      await c.query<{ id: string }>(
        "SELECT data->>'runbookId' AS id FROM incident_events WHERE incident_id = $1 AND data ? 'runbookId'",
        [incidentId],
      )
    ).rows.map((r) => r.id),
  );
  let n = 0;
  for (const r of await matchingRunbooks(c, incidentId)) {
    if (noted.has(r.id)) continue;
    await c.query(
      "INSERT INTO incident_events (workspace_id, incident_id, kind, text, data, at) VALUES ($1, $2, 'note', $3, $4, clock_timestamp())",
      [workspaceId, incidentId, 'Runbook: ' + r.title, JSON.stringify({ runbookId: r.id })],
    );
    n++;
  }
  return n;
}

export function runbookRoutes(pool: Pool): Route[] {
  const ws = s.object({ workspaceId: uuid });
  const one = s.object({ workspaceId: uuid, runbookId: uuid });
  const fields = {
    title: s.string({ min: 1, max: 120 }),
    pattern: s.string({ min: 2, max: 500 }),
    body: s.string({ min: 1, max: 20_000 }),
    projectId: s.optional(s.nullable(uuid)),
  };

  const ownProject = async (c: PoolClient, id: string | null | undefined): Promise<void> => {
    if (!id) return;
    const ok = (await c.query('SELECT 1 FROM projects WHERE id = $1', [id])).rowCount;
    if (!ok)
      throw new HttpError(400, 'invalid_request', 'Unknown project', [
        { path: 'body.projectId', message: 'is not a project of this workspace' },
      ]);
  };

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/runbooks',
    summary: 'The workspace’s runbooks (member)',
    tags: ['incidents'],
    params: ws,
    response: s.array(runbookOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: (await c.query<RunbookRow>(SELECT + ' ORDER BY r.title')).rows.map(json),
      })),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/runbooks',
    summary: 'Write a runbook with its trigger words, for one project or all (admin)',
    tags: ['incidents'],
    params: ws,
    body: s.object(fields),
    response: runbookOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        await ownProject(c, body.projectId);
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO runbooks (workspace_id, project_id, title, pattern, body, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [
              a.workspaceId,
              body.projectId ?? null,
              body.title.trim(),
              body.pattern.trim(),
              body.body,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        const r = (await c.query<RunbookRow>(SELECT + ' WHERE r.id = $1', [id])).rows[0];
        if (!r) throw new Error('runbook insert returned nothing');
        return { status: 201, body: json(r) };
      }),
  });

  const update = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/runbooks/:runbookId',
    summary: 'Change a runbook (admin)',
    tags: ['incidents'],
    params: one,
    body: s.object(fields),
    response: runbookOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        await ownProject(c, body.projectId);
        const n = (
          await c.query(
            'UPDATE runbooks SET project_id = $2, title = $3, pattern = $4, body = $5, updated_at = now() WHERE id = $1',
            [
              params.runbookId,
              body.projectId ?? null,
              body.title.trim(),
              body.pattern.trim(),
              body.body,
            ],
          )
        ).rowCount;
        const r = (await c.query<RunbookRow>(SELECT + ' WHERE r.id = $1', [params.runbookId]))
          .rows[0];
        if (!n || !r) throw new HttpError(404, 'not_found', 'Runbook not found');
        return { body: json(r) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/runbooks/:runbookId',
    summary: 'Remove a runbook (admin)',
    tags: ['incidents'],
    params: one,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: {
          removed: Boolean(
            (await c.query('DELETE FROM runbooks WHERE id = $1', [params.runbookId])).rowCount,
          ),
        },
      })),
  });

  const forIncident = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/incidents/:incidentId/runbooks',
    summary: 'The runbooks that match an incident’s title and alerts (member)',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, incidentId: uuid }),
    response: s.array(runbookOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: (await matchingRunbooks(c, params.incidentId)).map(json),
      })),
  });

  return [list, create, update, remove, forIncident];
}
