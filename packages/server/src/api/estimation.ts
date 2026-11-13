// ── [PCODE-252 | S15 | v0.1.0] T26.1 Estimation: units, async planning poker, suggestions from similar tasks, estimate vs actual ──
//    Why:  estimating as a team without a meeting, and learning from what tasks really took. A poker round
//          of a task collects hidden cards until someone reveals them; the spread shows where the team
//          disagrees; accepting a value makes it the estimate. A suggestion looks at the project's finished
//          tasks that read alike and what they took. Estimate vs actual sets each task's estimate against the
//          hours logged on it, in the project's unit.
import {
  asUnit,
  cardValue,
  estimateHours,
  POKER_DECKS,
  pokerSummary,
  similarity,
  suggestFrom,
  words,
  type EstimateUnit,
  type SimilarTask,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, atLeast, requireProject, type Access } from './access.js';
import { numberSetting, settingFor } from './settingvalue.js';

const uuid = s.string({ format: 'uuid' });
const itemParams = s.object({ workspaceId: uuid, itemId: uuid });
const roundParams = s.object({ workspaceId: uuid, roundId: uuid });

interface ItemRow {
  id: string;
  project_id: string;
  ref: string;
  title: string;
  description: string;
  kind: string;
  estimate: number | null;
}

async function itemOf(c: PoolClient, a: Access, id: string): Promise<ItemRow> {
  const it = (
    await c.query<ItemRow>(
      `SELECT i.id, i.project_id, p.key || '-' || i.sequence AS ref, i.title, i.description, i.kind, i.estimate
         FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = $1`,
      [id],
    )
  ).rows[0];
  if (!it) throw new HttpError(404, 'not_found', 'Task not found');
  try {
    await requireProject(c, a, it.project_id);
  } catch {
    throw new HttpError(404, 'not_found', 'Task not found');
  }
  return it;
}

export const unitOf = async (c: PoolClient, projectId: string): Promise<EstimateUnit> =>
  asUnit(await settingFor(c, 'planning.estimate_unit', projectId));

// ── poker ──

const roundOut = s.object({
  id: s.string(),
  itemId: s.string(),
  unit: s.string(),
  deck: s.array(s.string()),
  status: s.string(),
  startedBy: s.nullable(s.string()),
  createdAt: s.string(),
  voters: s.array(s.object({ userId: s.string(), name: s.string(), card: s.nullable(s.string()) })),
  myCard: s.nullable(s.string()),
  summary: s.nullable(
    s.object({
      votes: s.number({ integer: true }),
      low: s.nullable(s.number()),
      high: s.nullable(s.number()),
      median: s.nullable(s.number()),
      agreed: s.boolean(),
      suggested: s.nullable(s.string()),
    }),
  ),
  accepted: s.nullable(s.number({ integer: true })),
});

interface RoundRow {
  id: string;
  item_id: string;
  unit: string;
  status: string;
  started_by_name: string | null;
  accepted: number | null;
  created_at: Date;
}

/** A round as the caller may see it: the cards stay hidden until the round is revealed. */
async function roundJson(c: PoolClient, a: Access, r: RoundRow) {
  const unit = asUnit(r.unit);
  const votes = (
    await c.query<{ user_id: string; name: string; card: string }>(
      'SELECT v.user_id, u.name, v.card FROM poker_votes v JOIN users u ON u.id = v.user_id WHERE v.round_id = $1 ORDER BY v.voted_at',
      [r.id],
    )
  ).rows;
  const open = r.status === 'open';
  return {
    id: r.id,
    itemId: r.item_id,
    unit,
    deck: [...POKER_DECKS[unit]],
    status: r.status,
    startedBy: r.started_by_name,
    createdAt: r.created_at.toISOString(),
    voters: votes.map((v) => ({ userId: v.user_id, name: v.name, card: open ? null : v.card })),
    myCard: votes.find((v) => v.user_id === a.user.id)?.card ?? null,
    summary: open
      ? null
      : pokerSummary(
          votes.map((v) => v.card),
          unit,
        ),
    accepted: r.accepted,
  };
}

const ROUND_SELECT = `SELECT r.id, r.item_id, r.unit, r.status, u.name AS started_by_name, r.accepted, r.created_at
                        FROM poker_rounds r LEFT JOIN users u ON u.id = r.started_by`;

async function roundOf(c: PoolClient, a: Access, id: string): Promise<RoundRow> {
  const r = (await c.query<RoundRow>(ROUND_SELECT + ' WHERE r.id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Round not found');
  await itemOf(c, a, r.item_id);
  return r;
}

/** Sets a task's estimate as an edit of the task: a new version and an event in the person's name. */
export async function setEstimate(
  c: PoolClient,
  a: Access,
  it: ItemRow,
  value: number,
  why: string,
): Promise<void> {
  if (value === it.estimate) return;
  await c.query(
    'UPDATE items SET estimate = $2, version = version + 1, updated_at = now() WHERE id = $1',
    [it.id, value],
  );
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb: 'updated',
      object: { type: 'item', id: it.id, label: it.ref + ' ' + it.title },
      parent: { type: 'project', id: it.project_id, label: it.ref.split('-')[0] ?? '' },
      changes: { estimate: { from: it.estimate, to: value }, estimatedBy: { from: null, to: why } },
    },
    { projectId: it.project_id },
  );
}

export function estimationRoutes(pool: Pool): Route[] {
  const current = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/items/:itemId/poker',
    summary: "The task's open round of planning poker, else its last one (guest)",
    tags: ['planning'],
    params: itemParams,
    response: s.object({ round: s.nullable(roundOut) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await itemOf(c, a, params.itemId);
        const r = (
          await c.query<RoundRow>(
            ROUND_SELECT +
              ' WHERE r.item_id = $1 ORDER BY (r.status <> $2), r.created_at DESC LIMIT 1',
            [params.itemId, 'closed'],
          )
        ).rows[0];
        return { body: { round: r ? await roundJson(c, a, r) : null } };
      }),
  });

  const start = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/items/:itemId/poker',
    summary: 'Start a round of planning poker on a task (member)',
    tags: ['planning'],
    params: itemParams,
    response: roundOut,
    status: 201,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = await itemOf(c, a, params.itemId);
        if (
          (
            await c.query("SELECT 1 FROM poker_rounds WHERE item_id = $1 AND status <> 'closed'", [
              it.id,
            ])
          ).rowCount
        )
          throw new HttpError(409, 'conflict', it.ref + ' has a round going already');
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO poker_rounds (workspace_id, item_id, unit, started_by) VALUES ($1, $2, $3, $4) RETURNING id',
            [a.workspaceId, it.id, await unitOf(c, it.project_id), a.user.id],
          )
        ).rows[0]?.id;
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'item', id: it.id, label: it.ref + ' ' + it.title },
            changes: { poker: { from: null, to: 'round started' } },
          },
          { projectId: it.project_id },
        );
        return { status: 201, body: await roundJson(c, a, await roundOf(c, a, String(id))) };
      }),
  });

  const vote = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/poker/:roundId/vote',
    summary: 'Lay your card, or change it while the round is open (member)',
    tags: ['planning'],
    params: roundParams,
    body: s.object({ card: s.string({ min: 1, max: 4 }) }),
    response: roundOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await roundOf(c, a, params.roundId);
        if (r.status !== 'open')
          throw new HttpError(409, 'conflict', 'The cards are on the table; start a new round');
        const unit = asUnit(r.unit);
        if (!POKER_DECKS[unit].includes(body.card))
          throw new HttpError(400, 'invalid_request', 'Pick a card of the deck', [
            { path: 'body.card', message: 'is not one of ' + POKER_DECKS[unit].join(' ') },
          ]);
        await c.query(
          `INSERT INTO poker_votes (workspace_id, round_id, user_id, card) VALUES ($1, $2, $3, $4)
           ON CONFLICT (round_id, user_id) DO UPDATE SET card = $4, voted_at = now()`,
          [a.workspaceId, r.id, a.user.id, body.card],
        );
        return { body: await roundJson(c, a, r) };
      }),
  });

  const reveal = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/poker/:roundId/reveal',
    summary: 'Turn the cards over (member)',
    tags: ['planning'],
    params: roundParams,
    response: roundOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await roundOf(c, a, params.roundId);
        if (r.status !== 'open')
          throw new HttpError(409, 'conflict', 'The round is revealed already');
        await c.query(
          "UPDATE poker_rounds SET status = 'revealed', revealed_at = now() WHERE id = $1",
          [r.id],
        );
        return { body: await roundJson(c, a, await roundOf(c, a, r.id)) };
      }),
  });

  const accept = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/poker/:roundId/accept',
    summary: "Make a card the task's estimate and close the round (member)",
    tags: ['planning'],
    params: roundParams,
    body: s.object({ card: s.string({ min: 1, max: 4 }) }),
    response: roundOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await roundOf(c, a, params.roundId);
        if (r.status === 'closed') throw new HttpError(409, 'conflict', 'The round is closed');
        if (r.status === 'open')
          throw new HttpError(409, 'conflict', 'Reveal the cards before accepting one');
        const value = cardValue(body.card, asUnit(r.unit));
        if (value === null)
          throw new HttpError(400, 'invalid_request', 'Accept a card with a value', [
            { path: 'body.card', message: 'is not a value of the deck' },
          ]);
        const it = await itemOf(c, a, r.item_id);
        await c.query(
          "UPDATE poker_rounds SET status = 'closed', closed_at = now(), accepted = $2 WHERE id = $1",
          [r.id, value],
        );
        await setEstimate(c, a, it, value, 'planning poker');
        return { body: await roundJson(c, a, await roundOf(c, a, r.id)) };
      }),
  });

  const cancel = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/poker/:roundId',
    summary: 'Close a round without an estimate (who started it, or an admin)',
    tags: ['planning'],
    params: roundParams,
    response: s.object({ ok: s.literal(true) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await roundOf(c, a, params.roundId);
        const r = await c.query(
          "UPDATE poker_rounds SET status = 'closed', closed_at = now() WHERE id = $1 AND status <> 'closed' AND (started_by = $2 OR $3)",
          [params.roundId, a.user.id, atLeast(a.role, 'admin')],
        );
        if (!r.rowCount)
          throw new HttpError(403, 'forbidden', 'Only who started the round or an admin closes it');
        return { body: { ok: true as const } };
      }),
  });

  const open = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/poker',
    summary: 'The tasks of a project with a poker round going, and whether you voted (guest)',
    tags: ['planning'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(
      s.object({
        roundId: s.string(),
        itemId: s.string(),
        ref: s.string(),
        title: s.string(),
        status: s.string(),
        votes: s.number({ integer: true }),
        voted: s.boolean(),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            id: string;
            item_id: string;
            ref: string;
            title: string;
            status: string;
            votes: string;
            voted: boolean;
          }>(
            `SELECT r.id, r.item_id, p.key || '-' || i.sequence AS ref, i.title, r.status,
                    (SELECT count(*) FROM poker_votes v WHERE v.round_id = r.id) AS votes,
                    EXISTS (SELECT 1 FROM poker_votes v WHERE v.round_id = r.id AND v.user_id = $2) AS voted
               FROM poker_rounds r JOIN items i ON i.id = r.item_id JOIN projects p ON p.id = i.project_id
              WHERE i.project_id = $1 AND r.status <> 'closed' ORDER BY r.created_at`,
            [params.projectId, a.user.id],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            roundId: r.id,
            itemId: r.item_id,
            ref: r.ref,
            title: r.title,
            status: r.status,
            votes: Number(r.votes),
            voted: r.voted,
          })),
        };
      }),
  });

  // ── a suggestion from similar finished tasks ──
  const suggest = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/items/:itemId/estimate-suggestion',
    summary:
      'An estimate from the finished tasks of the project that read alike, with what they took (guest)',
    tags: ['planning'],
    params: itemParams,
    response: s.object({
      unit: s.string(),
      value: s.nullable(s.number()),
      basis: s.string(),
      similar: s.array(
        s.object({
          ref: s.string(),
          title: s.string(),
          estimate: s.nullable(s.number()),
          hours: s.number(),
          score: s.number(),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const it = await itemOf(c, a, params.itemId);
        const unit = await unitOf(c, it.project_id);
        const hpp = await numberSetting(c, 'planning.hours_per_point', it.project_id);
        const done = (
          await c.query<{
            ref: string;
            title: string;
            description: string;
            kind: string;
            estimate: number | null;
            minutes: string;
          }>(
            `SELECT p.key || '-' || i.sequence AS ref, i.title, left(i.description, 4000) AS description, i.kind, i.estimate,
                    (SELECT coalesce(sum(t.minutes), 0) FROM time_entries t WHERE t.item_id = i.id) AS minutes
               FROM items i JOIN projects p ON p.id = i.project_id
              WHERE i.project_id = $1 AND i.id <> $2 AND i.completed_at IS NOT NULL
              ORDER BY i.completed_at DESC LIMIT 500`,
            [it.project_id, it.id],
          )
        ).rows;
        const mine = words(it.title + ' ' + it.title + ' ' + it.description);
        const similar: SimilarTask[] = done
          .map((d) => ({
            ref: d.ref,
            title: d.title,
            estimate: d.estimate,
            hours: Math.round((Number(d.minutes) / 60) * 10) / 10,
            // the title counts twice, the same kind a little more
            score:
              Math.round(
                (similarity(mine, words(d.title + ' ' + d.title + ' ' + d.description)) +
                  (d.kind === it.kind ? 0.05 : 0)) *
                  100,
              ) / 100,
          }))
          .filter((d) => d.score >= 0.15 && (d.estimate !== null || d.hours > 0))
          .sort((x, y) => y.score - x.score)
          .slice(0, 5);
        const out = suggestFrom(similar, unit, hpp);
        return { body: { unit, value: out.value, basis: out.basis, similar } };
      }),
  });

  // ── estimate vs actual ──
  const versus = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/estimate-vs-actual',
    summary:
      'Estimated against logged hours per task, for a sprint or the finished tasks of the last 90 days (guest)',
    tags: ['planning'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    query: s.object({ sprintId: s.optional(uuid) }),
    response: s.object({
      unit: s.string(),
      hoursPerPoint: s.number(),
      estimatedHours: s.number(),
      actualHours: s.number(),
      tasks: s.array(
        s.object({
          itemId: s.string(),
          ref: s.string(),
          title: s.string(),
          estimate: s.nullable(s.number()),
          estimatedHours: s.nullable(s.number()),
          actualHours: s.number(),
          /** actual over estimated; 1.5 is half again as long */
          ratio: s.nullable(s.number()),
        }),
      ),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const unit = await unitOf(c, params.projectId);
        const hpp = await numberSetting(c, 'planning.hours_per_point', params.projectId);
        const rows = (
          await c.query<{
            id: string;
            ref: string;
            title: string;
            estimate: number | null;
            minutes: string;
          }>(
            `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, i.estimate,
                    (SELECT coalesce(sum(t.minutes), 0) FROM time_entries t WHERE t.item_id = i.id) AS minutes
               FROM items i JOIN projects p ON p.id = i.project_id
              WHERE i.project_id = $1 AND ` +
              (query.sprintId
                ? 'i.sprint_id = $2'
                : "i.completed_at >= now() - interval '90 days' AND $2::uuid IS NULL") +
              ' ORDER BY i.sequence',
            [params.projectId, query.sprintId ?? null],
          )
        ).rows;
        const r1 = (x: number): number => Math.round(x * 10) / 10;
        const tasks = rows
          .map((r) => {
            const est = r.estimate === null ? null : estimateHours(r.estimate, unit, hpp);
            const act = r1(Number(r.minutes) / 60);
            return {
              itemId: r.id,
              ref: r.ref,
              title: r.title,
              estimate: r.estimate,
              estimatedHours: est,
              actualHours: act,
              ratio: est && act ? Math.round((act / est) * 100) / 100 : null,
            };
          })
          .filter((t) => t.estimate !== null || t.actualHours > 0)
          // the furthest over first
          .sort((x, y) => (y.ratio ?? 0) - (x.ratio ?? 0));
        return {
          body: {
            unit,
            hoursPerPoint: hpp,
            estimatedHours: r1(tasks.reduce((n, t) => n + (t.estimatedHours ?? 0), 0)),
            actualHours: r1(tasks.reduce((n, t) => n + t.actualHours, 0)),
            tasks,
          },
        };
      }),
  });

  return [current, start, vote, reveal, accept, cancel, open, suggest, versus];
}
