// ── [PCODE-205 | S15 | v0.1.0] T17.3 Release agent with release tools, approved release notes, changelogs per release, project and train ──
//    Why:  release notes go out once a person approved them, and the changes of shipped versions are kept
//          as a changelog people know: per release, for a project's whole history, and for a train
//          (one part per project). Written from the releases' tasks, never by hand.
import {
  changelog,
  changelogSection,
  compareVersions,
  type ChangelogVersion,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';
import { releaseEvent, releaseOf } from './versions.js';

const uuid = s.string({ format: 'uuid' });
const textOut = s.object({ markdown: s.string() });

/** A release as a changelog version: its tasks, its date, and whether it was rolled back. */
async function versionOf(
  c: PoolClient,
  r: { id: string; version: string; state: string; released_at: Date | null },
): Promise<ChangelogVersion> {
  const items = (
    await c.query<{ ref: string; title: string; kind: string; breaking: boolean }>(
      `SELECT p.key || '-' || i.sequence AS ref, i.title, i.kind, x.breaking FROM release_items x
         JOIN items i ON i.id = x.item_id JOIN projects p ON p.id = i.project_id WHERE x.release_id = $1 ORDER BY i.sequence`,
      [r.id],
    )
  ).rows;
  return {
    version: r.version,
    date: r.released_at ? r.released_at.toISOString().slice(0, 10) : null,
    items,
    rolledBack: r.state === 'rolled_back',
  };
}

export function changelogRoutes(pool: Pool): Route[] {
  const approve = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/notes/approve',
    summary: 'Approve the release notes as they are now; a later change asks again (member)',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, releaseId: uuid }),
    response: s.object({ approvedBy: s.string(), approvedAt: s.string() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        if (!r.notes_team.trim() && !r.notes_client.trim())
          throw new HttpError(409, 'conflict', 'There are no notes to approve yet');
        const at = new Date();
        await c.query(
          'UPDATE releases SET notes_approved_by = $2, notes_approved_at = $3 WHERE id = $1',
          [r.id, a.user.id, at],
        );
        await releaseEvent(c, a, r.project, { from: null, to: r.version + ' notes approved' });
        return { body: { approvedBy: a.user.name, approvedAt: at.toISOString() } };
      }),
  });

  const one = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/changelog',
    summary: 'The changelog section of one release (Keep a Changelog)',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, releaseId: uuid }),
    response: textOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        return { body: { markdown: changelogSection(await versionOf(c, r)) } };
      }),
  });

  const project = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/changelog',
    summary: 'The project’s changelog: every shipped (or rolled back) version, newest first',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: textOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{ id: string; version: string; state: string; released_at: Date | null }>(
            "SELECT id, version, state, released_at FROM releases WHERE project_id = $1 AND state IN ('released', 'rolled_back')",
            [p.id],
          )
        ).rows;
        const versions: ChangelogVersion[] = [];
        for (const r of rows) versions.push(await versionOf(c, r));
        return { body: { markdown: changelog(p.name + ' changelog', versions, compareVersions) } };
      }),
  });

  const train = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/trains/:trainId/changelog',
    summary: 'A train’s changelog: one part per project, with its version on the train',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, trainId: uuid }),
    response: textOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const t = (
          await c.query<{ name: string; shipped_at: Date | null }>(
            'SELECT name, shipped_at FROM release_trains WHERE id = $1',
            [params.trainId],
          )
        ).rows[0];
        if (!t) throw new HttpError(404, 'not_found', 'Train not found');
        const rows = (
          await c.query<{
            id: string;
            project_id: string;
            key: string;
            name: string;
            version: string;
            state: string;
            released_at: Date | null;
          }>(
            `SELECT r.id, r.project_id, p.key, p.name, r.version, r.state, r.released_at FROM releases r
               JOIN projects p ON p.id = r.project_id WHERE r.train_id = $1 ORDER BY p.key`,
            [params.trainId],
          )
        ).rows;
        const parts = ['# Train ' + t.name, ''];
        for (const r of rows) {
          try {
            await requireProject(c, a, r.project_id);
          } catch {
            continue;
          }
          parts.push('# ' + r.key + ' · ' + r.name, '', changelogSection(await versionOf(c, r)));
        }
        return { body: { markdown: parts.join('\n') } };
      }),
  });

  return [approve, one, project, train];
}
