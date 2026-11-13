// ── [PCODE-306 | S15 | v0.1.0] T31.6 Versions from commits: conventional commits, tags and components per path ──
// ── [PCODE-205 | S15 | v0.1.0] T17.3 Release agent with release tools, approved release notes, changelogs per release, project and train ──
// ── [PCODE-203 | S15 | v0.1.0] T17.1 Release trains on the server: releases of several projects, freeze, go/no-go, ship with deploys, rollback ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-178 | S15 | v0.1.0] B4.4 Versions tab and Releases page live in the web app: pull requests, releases with go/no-go, notes, flags, DORA, overview ──
// ── [PCODE-175 | S15 | v0.1.0] B4.1 Test and Versions on the server: suites, steps, configs, evidence, flaky, Playwright, pull requests, releases, notes, flags, DORA ──
//    Why:  the Versions tab of the approved design. Pull requests show size, reviews and checks, and warn
//          when one is stale or names no task. A release collects tasks under a version (suggested from
//          what it contains), freezes, ships to an environment or is rolled back; its contents show the
//          tests and open findings behind it, and its notes are written for the team and for the client.
//          Feature flags name their task and where they are on. DORA numbers come from the deploys.
import { compareVersions, doraMetrics, nextVersion, releaseNotes } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access, type ProjectRow } from './access.js';
// [PCODE-176 | S15 | v0.1.0]
import { checkPolicies, mayOverride, refreshFindings } from './posture.js';
// [PCODE-203 | S15 | v0.1.0] shipping and rolling back deploy
import { queueDeploy } from './deploys.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
export const STALE_PR_DAYS = 7;
export const STALE_FLAG_DAYS = 30;

/** XS to XL from the lines a pull request changes. */
export const sizeOf = (lines: number): string =>
  lines < 10 ? 'XS' : lines < 100 ? 'S' : lines < 400 ? 'M' : lines < 1000 ? 'L' : 'XL';

const prOut = s.object({
  id: s.string(),
  number: s.number({ integer: true }),
  title: s.string(),
  url: s.string(),
  author: s.string(),
  branch: s.string(),
  base: s.string(),
  repo: s.string(),
  state: s.string(),
  draft: s.boolean(),
  additions: s.number({ integer: true }),
  deletions: s.number({ integer: true }),
  changedFiles: s.number({ integer: true }),
  size: s.string(),
  reviewState: s.string(),
  checksState: s.string(),
  itemId: s.nullable(s.string()),
  itemRef: s.nullable(s.string()),
  stale: s.boolean(),
  noTask: s.boolean(),
  openedAt: s.string(),
  updatedAt: s.string(),
  mergedAt: s.nullable(s.string()),
});

interface ReleaseRow {
  id: string;
  project_id: string;
  version: string;
  name: string;
  component: string; // [PCODE-306 | S15 | v0.1.0]
  train: string;
  hotfix_of: string | null;
  state: string;
  freeze_at: Date | null;
  target_date: string | null;
  notes_team: string;
  notes_client: string;
  environment_id: string | null;
  environment_name: string | null;
  released_by_name: string | null;
  released_at: Date | null;
  created_at: Date;
  items: string;
  done: string;
  // [PCODE-205 | S15 | v0.1.0] who approved the notes, and whether an agent wrote them
  notes_approved_by_name: string | null;
  notes_approved_at: Date | null;
  notes_by_agent: boolean;
}
const RELEASE_SELECT = `SELECT r.id, r.project_id, r.version, r.name, r.component, r.train, r.hotfix_of, r.state, r.freeze_at, r.target_date::text AS target_date,
       r.notes_team, r.notes_client, r.environment_id, na.name AS notes_approved_by_name, r.notes_approved_at, r.notes_by_agent, e.name AS environment_name, u.name AS released_by_name, r.released_at, r.created_at,
       (SELECT count(*) FROM release_items x WHERE x.release_id = r.id) AS items,
       (SELECT count(*) FROM release_items x JOIN items i ON i.id = x.item_id JOIN project_states st ON st.id = i.state_id
         WHERE x.release_id = r.id AND st.grp IN ('completed', 'cancelled')) AS done
  FROM releases r LEFT JOIN environments e ON e.id = r.environment_id LEFT JOIN users u ON u.id = r.released_by
  LEFT JOIN users na ON na.id = r.notes_approved_by`;
const releaseOut = s.object({
  id: s.string(),
  version: s.string(),
  name: s.string(),
  component: s.string(), // [PCODE-306 | S15 | v0.1.0] empty for the project's own line
  train: s.string(),
  hotfixOf: s.nullable(s.string()),
  state: s.string(),
  freezeAt: s.nullable(s.string()),
  frozen: s.boolean(),
  targetDate: s.nullable(s.string()),
  notesTeam: s.string(),
  notesClient: s.string(),
  // [PCODE-205 | S15 | v0.1.0]
  notesApprovedBy: s.nullable(s.string()),
  notesApprovedAt: s.nullable(s.string()),
  notesByAgent: s.boolean(),
  environmentId: s.nullable(s.string()),
  environmentName: s.nullable(s.string()),
  releasedBy: s.nullable(s.string()),
  releasedAt: s.nullable(s.string()),
  items: s.number({ integer: true }),
  done: s.number({ integer: true }),
  createdAt: s.string(),
});
const releaseJson = (r: ReleaseRow): Infer<typeof releaseOut> => ({
  id: r.id,
  version: r.version,
  name: r.name,
  component: r.component, // [PCODE-306 | S15 | v0.1.0]
  train: r.train,
  hotfixOf: r.hotfix_of,
  state: r.state,
  freezeAt: r.freeze_at?.toISOString() ?? null,
  frozen:
    r.state === 'frozen' ||
    (r.state === 'planned' && r.freeze_at !== null && r.freeze_at.getTime() <= Date.now()),
  targetDate: r.target_date,
  notesTeam: r.notes_team,
  notesClient: r.notes_client,
  notesApprovedBy: r.notes_approved_by_name, // [PCODE-205 | S15 | v0.1.0]
  notesApprovedAt: r.notes_approved_at?.toISOString() ?? null,
  notesByAgent: r.notes_by_agent,
  environmentId: r.environment_id,
  environmentName: r.environment_name,
  releasedBy: r.released_by_name,
  releasedAt: r.released_at?.toISOString() ?? null,
  items: Number(r.items),
  done: Number(r.done),
  createdAt: r.created_at.toISOString(),
});

export async function releaseOf(
  c: PoolClient,
  a: Access,
  id: string,
): Promise<ReleaseRow & { project: ProjectRow }> {
  const r = (await c.query<ReleaseRow>(RELEASE_SELECT + ' WHERE r.id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Release not found');
  try {
    return { ...r, project: await requireProject(c, a, r.project_id) };
  } catch {
    throw new HttpError(404, 'not_found', 'Release not found');
  }
}

export async function releaseEvent(
  c: PoolClient,
  a: Access,
  project: ProjectRow,
  change: { from: unknown; to: unknown },
): Promise<void> {
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb: 'updated',
      object: { type: 'project', id: project.id, label: project.key },
      changes: { release: change },
    },
    { projectId: project.id },
  );
}

// ── [PCODE-203 | S15 | v0.1.0] shipping and rolling back, for one release and for a train ──
export type ReleaseWithProject = ReleaseRow & { project: ProjectRow };

/** The release policies that block a release, as sentences per policy. */
export async function releaseViolations(
  c: PoolClient,
  r: { id: string; project_id: string },
): Promise<string[]> {
  await refreshFindings(c, r.project_id);
  return (await checkPolicies(c, r.project_id, 'release', r.id))
    .filter((x) => x.violations.length)
    .map((x) => x.policy + ': ' + x.violations.join('; '));
}

/** Marks a release shipped (notes written when empty) and queues its deploy when it has an environment. */
export async function shipRelease(
  c: PoolClient,
  a: Access,
  r: ReleaseWithProject,
  environmentId: string | null,
  trigger: string,
): Promise<string | null> {
  const items = (
    await c.query<{ ref: string; title: string; kind: string; breaking: boolean }>(
      "SELECT p.key || '-' || i.sequence AS ref, i.title, i.kind, x.breaking FROM release_items x JOIN items i ON i.id = x.item_id JOIN projects p ON p.id = i.project_id WHERE x.release_id = $1 ORDER BY i.sequence",
      [r.id],
    )
  ).rows;
  const date = new Date().toISOString().slice(0, 10);
  await c.query(
    `UPDATE releases SET state = 'released', released_at = now(), released_by = $2, environment_id = coalesce($3, environment_id),
            notes_team = CASE WHEN notes_team = '' THEN $4 ELSE notes_team END, notes_client = CASE WHEN notes_client = '' THEN $5 ELSE notes_client END
      WHERE id = $1`,
    [
      r.id,
      a.user.id,
      environmentId,
      releaseNotes(r.version, items, 'team', date),
      releaseNotes(r.version, items, 'client', date),
    ],
  );
  const env = environmentId ?? r.environment_id;
  if (!env) return null;
  const run = await queueDeploy(c, a, env, r.version, trigger);
  await c.query('UPDATE deploy_runs SET release_id = $2 WHERE id = $1', [run.id, r.id]);
  return run.id;
}

/** The version that last ran well on an environment before a version came: what a rollback redeploys. */
export async function previousGoodRef(
  c: PoolClient,
  environmentId: string,
  notRef: string,
): Promise<string | null> {
  return (
    (
      await c.query<{ ref: string }>(
        `SELECT ref FROM deploy_runs WHERE environment_id = $1 AND status = 'succeeded' AND ref <> $2 AND ref <> ''
          AND created_at < coalesce((SELECT min(created_at) FROM deploy_runs WHERE environment_id = $1 AND ref = $2), now())
          ORDER BY finished_at DESC NULLS LAST LIMIT 1`,
        [environmentId, notRef],
      )
    ).rows[0]?.ref ?? null
  );
}

/** Rolls a shipped release back, with the reason; its environment redeploys what ran there before. */
export async function rollbackRelease(
  c: PoolClient,
  a: Access,
  r: ReleaseWithProject,
  reason: string,
  trigger: string,
): Promise<{ deployId: string | null; ref: string | null }> {
  await c.query(
    "UPDATE releases SET state = 'rolled_back', notes_team = notes_team || $2 WHERE id = $1",
    [r.id, '\n\n## Rolled back\n\n' + reason.trim() + '\n'],
  );
  if (!r.environment_id) return { deployId: null, ref: null };
  const ref = await previousGoodRef(c, r.environment_id, r.version);
  if (!ref) return { deployId: null, ref: null };
  const run = await queueDeploy(c, a, r.environment_id, ref, trigger);
  await c.query('UPDATE deploy_runs SET release_id = $2 WHERE id = $1', [run.id, r.id]);
  return { deployId: run.id, ref };
}

/** The version the project's last shipped release had. */
async function lastReleased(c: PoolClient, projectId: string): Promise<string | null> {
  const all = (
    await c.query<{ version: string }>(
      "SELECT version FROM releases WHERE project_id = $1 AND state = 'released'",
      [projectId],
    )
  ).rows.map((r) => r.version);
  return all.sort(compareVersions).at(-1) ?? null;
}

// [PCODE-178 | S15 | v0.1.0] a new version builds on the highest one that exists, planned ones too
/** The highest version of the project in any state: the next suggestion must not exist already. */
async function highestVersion(c: PoolClient, projectId: string): Promise<string | null> {
  const all = // [PCODE-306 | S15 | v0.1.0] the project's own line; components have theirs
    (
      await c.query<{ version: string }>(
        "SELECT version FROM releases WHERE project_id = $1 AND component = ''",
        [projectId],
      )
    ).rows.map((r) => r.version);
  return all.sort(compareVersions).at(-1) ?? null;
}

/** The production environment: one named production, prod or live, else the last in order. */
async function productionOf(
  c: PoolClient,
  projectId: string,
): Promise<{ id: string; name: string } | null> {
  return (
    (
      await c.query<{ id: string; name: string }>(
        `SELECT id, name FROM environments WHERE project_id = $1
          ORDER BY (key IN ('production', 'prod', 'live')) DESC, position DESC, created_at DESC LIMIT 1`,
        [projectId],
      )
    ).rows[0] ?? null
  );
}

interface FlagRow {
  id: string;
  key: string;
  description: string;
  item_id: string | null;
  item_ref: string | null;
  enabled: Record<string, boolean>;
  created_at: Date;
  updated_at: Date;
}
const flagOut = s.object({
  id: s.string(),
  key: s.string(),
  description: s.string(),
  itemId: s.nullable(s.string()),
  itemRef: s.nullable(s.string()),
  enabled: s.anyObject(),
  ageDays: s.number({ integer: true }),
  stale: s.boolean(),
  updatedAt: s.string(),
});
/** A flag is stale when nobody changed it for 30 days and it is the same everywhere: on (remove it) or off (dead). */
export function flagStale(
  enabled: Record<string, boolean>,
  updatedAt: Date,
  now = Date.now(),
): boolean {
  const v = Object.values(enabled);
  return (
    now - updatedAt.getTime() > STALE_FLAG_DAYS * 86_400_000 &&
    (v.length === 0 || v.every((x) => x) || v.every((x) => !x))
  );
}
const flagJson = (f: FlagRow) => ({
  id: f.id,
  key: f.key,
  description: f.description,
  itemId: f.item_id,
  itemRef: f.item_ref,
  enabled: f.enabled,
  ageDays: Math.floor((Date.now() - f.created_at.getTime()) / 86_400_000),
  stale: flagStale(f.enabled, f.updated_at),
  updatedAt: f.updated_at.toISOString(),
});
const FLAG_SELECT = `SELECT f.id, f.key, f.description, f.item_id, p.key || '-' || i.sequence AS item_ref, f.enabled, f.created_at, f.updated_at
  FROM feature_flags f LEFT JOIN items i ON i.id = f.item_id LEFT JOIN projects p ON p.id = i.project_id`;

export function versionRoutes(pool: Pool): Route[] {
  const pulls = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/pull-requests',
    summary: 'The project’s pull requests: open first, with size, reviews, checks and warnings',
    tags: ['versions'],
    params: projectParams,
    query: s.object({ state: s.optional(s.enum(['open', 'all'])) }),
    response: s.array(prOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            id: string;
            number: number;
            title: string;
            url: string;
            author: string;
            branch: string;
            base: string;
            repo: string;
            state: string;
            draft: boolean;
            additions: number;
            deletions: number;
            changed_files: number;
            review_state: string;
            checks_state: string;
            item_id: string | null;
            item_ref: string | null;
            opened_at: Date;
            updated_at: Date;
            merged_at: Date | null;
          }>(
            `SELECT x.*, g.repo, p.key || '-' || i.sequence AS item_ref FROM pull_requests x
               JOIN git_connections g ON g.id = x.connection_id LEFT JOIN items i ON i.id = x.item_id LEFT JOIN projects p ON p.id = i.project_id
              WHERE x.project_id = $1 AND ($2 = 'all' OR x.state = 'open')
              ORDER BY x.state = 'open' DESC, x.updated_at DESC LIMIT 300`,
            [params.projectId, query.state ?? 'open'],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            number: r.number,
            title: r.title,
            url: r.url,
            author: r.author,
            branch: r.branch,
            base: r.base,
            repo: r.repo,
            state: r.state,
            draft: r.draft,
            additions: r.additions,
            deletions: r.deletions,
            changedFiles: r.changed_files,
            size: sizeOf(r.additions + r.deletions),
            reviewState: r.review_state,
            checksState: r.checks_state,
            itemId: r.item_id,
            itemRef: r.item_ref,
            stale:
              r.state === 'open' &&
              Date.now() - r.updated_at.getTime() > STALE_PR_DAYS * 86_400_000,
            noTask: r.item_id === null,
            openedAt: r.opened_at.toISOString(),
            updatedAt: r.updated_at.toISOString(),
            mergedAt: r.merged_at?.toISOString() ?? null,
          })),
        };
      }),
  });

  // ── releases ──
  const releases = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/releases',
    summary:
      'The project’s releases, newest version first, and the version the next one should get',
    tags: ['versions'],
    params: projectParams,
    response: s.object({
      releases: s.array(releaseOut),
      lastReleased: s.nullable(s.string()),
      suggested: s.string(),
      unreleased: s.number({ integer: true }),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<ReleaseRow>(RELEASE_SELECT + ' WHERE r.project_id = $1', [params.projectId])
        ).rows.sort((x, y) => compareVersions(y.version, x.version));
        const last = await lastReleased(c, params.projectId);
        // finished tasks no release has shipped yet decide the suggestion
        const open = (
          await c.query<{ kind: string }>(
            `SELECT i.kind FROM items i JOIN project_states st ON st.id = i.state_id
              WHERE i.project_id = $1 AND st.grp = 'completed'
                AND NOT EXISTS (SELECT 1 FROM release_items x JOIN releases r ON r.id = x.release_id WHERE x.item_id = i.id AND r.state = 'released')`,
            [params.projectId],
          )
        ).rows;
        return {
          body: {
            releases: rows.map(releaseJson),
            lastReleased: last,
            suggested: nextVersion(
              await highestVersion(c, params.projectId),
              open.map((o) => ({ kind: o.kind, breaking: false })),
            ),
            unreleased: open.length,
          },
        };
      }),
  });

  const createRelease = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/releases',
    summary: 'Plan a release; without a version it gets the suggested one (member)',
    tags: ['versions'],
    params: projectParams,
    body: s.object({
      version: s.optional(s.string({ min: 5, max: 40 })),
      name: s.optional(s.string({ max: 120 })),
      train: s.optional(s.string({ max: 60 })),
      targetDate: s.optional(s.string({ min: 10, max: 10 })),
      hotfixOf: s.optional(uuid),
      freezeAt: s.optional(s.string({ format: 'date-time' })),
    }),
    response: releaseOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        if (body.version && !VERSION.test(body.version))
          throw new HttpError(
            400,
            'invalid_request',
            'Versions are semantic: 1.4.2 or 2.0.0-rc.1',
            [{ path: 'body.version', message: 'is not a semantic version' }],
          );
        if (body.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate))
          throw new HttpError(400, 'invalid_request', 'Dates are written YYYY-MM-DD', [
            { path: 'body.targetDate', message: 'is not a date' },
          ]);
        let version = body.version;
        if (body.hotfixOf) {
          const base = await releaseOf(c, a, body.hotfixOf);
          if (base.project_id !== p.id || base.state !== 'released')
            throw new HttpError(
              400,
              'invalid_request',
              'A hotfix follows a shipped release of this project',
              [{ path: 'body.hotfixOf', message: 'is not a shipped release of this project' }],
            );
          version ??= nextVersion(base.version, [{ kind: 'bug', breaking: false }]);
        }
        version ??= nextVersion(await highestVersion(c, p.id), []);
        // [PCODE-306 | S15 | v0.1.0] the project's own line; components have theirs
        const taken = await c.query(
          "SELECT 1 FROM releases WHERE project_id = $1 AND version = $2 AND component = ''",
          [p.id, version],
        );
        if (taken.rowCount)
          throw new HttpError(409, 'conflict', 'Version ' + version + ' exists already');
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO releases (workspace_id, project_id, version, name, train, hotfix_of, target_date, freeze_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
            [
              a.workspaceId,
              p.id,
              version,
              body.name?.trim() ?? '',
              body.train?.trim() ?? '',
              body.hotfixOf ?? null,
              body.targetDate ?? null,
              body.freezeAt ?? null,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        await releaseEvent(c, a, p, { from: null, to: version + ' planned' });
        return { status: 201, body: releaseJson(await releaseOf(c, a, id ?? '')) };
      }),
  });

  const relParams = s.object({ workspaceId: uuid, releaseId: uuid });
  const contentOut = s.object({
    release: releaseOut,
    items: s.array(
      s.object({
        id: s.string(),
        ref: s.string(),
        title: s.string(),
        kind: s.string(),
        stateGroup: s.string(),
        breaking: s.boolean(),
        tests: s.number({ integer: true }),
        testsPassing: s.number({ integer: true }),
        testsFailing: s.number({ integer: true }),
        pullRequests: s.number({ integer: true }),
      }),
    ),
    tests: s.object({
      cases: s.number({ integer: true }),
      passing: s.number({ integer: true }),
      failing: s.number({ integer: true }),
      untested: s.number({ integer: true }),
    }),
    findings: s.object({
      critical: s.number({ integer: true }),
      high: s.number({ integer: true }),
      medium: s.number({ integer: true }),
      low: s.number({ integer: true }),
    }),
    flags: s.array(s.object({ key: s.string(), enabled: s.anyObject() })),
    suggested: s.string(),
    /** the last shipped release of the line this one follows */
    previous: s.nullable(s.string()),
  });
  const contents = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/releases/:releaseId',
    summary:
      'A release with its tasks, the tests behind them, open findings, flags and the version its contents suggest',
    tags: ['versions'],
    params: relParams,
    response: contentOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        const items = (
          await c.query<{
            id: string;
            ref: string;
            title: string;
            kind: string;
            grp: string;
            breaking: boolean;
            tests: string;
            passing: string;
            failing: string;
            prs: string;
          }>(
            `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, i.kind, st.grp, x.breaking,
                    (SELECT count(*) FROM test_cases tc WHERE tc.item_id = i.id) AS tests,
                    (SELECT count(*) FROM test_cases tc WHERE tc.item_id = i.id AND (SELECT tr.status FROM test_results tr WHERE tr.case_id = tc.id ORDER BY tr.at DESC LIMIT 1) = 'passed') AS passing,
                    (SELECT count(*) FROM test_cases tc WHERE tc.item_id = i.id AND (SELECT tr.status FROM test_results tr WHERE tr.case_id = tc.id ORDER BY tr.at DESC LIMIT 1) = 'failed') AS failing,
                    (SELECT count(*) FROM pull_requests pr WHERE pr.item_id = i.id) AS prs
               FROM release_items x JOIN items i ON i.id = x.item_id JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
              WHERE x.release_id = $1 ORDER BY x.breaking DESC, i.kind, i.sequence`,
            [r.id],
          )
        ).rows;
        const findings = (
          await c.query<{ severity: string; n: string }>(
            "SELECT severity, count(*) AS n FROM findings WHERE project_id = $1 AND status = 'open' GROUP BY severity",
            [r.project_id],
          )
        ).rows;
        const sev = (k: string): number => Number(findings.find((f) => f.severity === k)?.n ?? 0);
        const flags = (
          await c.query<{ key: string; enabled: Record<string, boolean> }>(
            'SELECT f.key, f.enabled FROM feature_flags f JOIN release_items x ON x.item_id = f.item_id WHERE x.release_id = $1 AND f.removed_at IS NULL',
            [r.id],
          )
        ).rows;
        const previous = r.hotfix_of
          ? ((
              await c.query<{ version: string }>('SELECT version FROM releases WHERE id = $1', [
                r.hotfix_of,
              ])
            ).rows[0]?.version ?? null)
          : await lastReleased(c, r.project_id);
        const sumTests = items.reduce((n, i) => n + Number(i.tests), 0);
        const passing = items.reduce((n, i) => n + Number(i.passing), 0);
        const failing = items.reduce((n, i) => n + Number(i.failing), 0);
        return {
          body: {
            release: releaseJson(r),
            items: items.map((i) => ({
              id: i.id,
              ref: i.ref,
              title: i.title,
              kind: i.kind,
              stateGroup: i.grp,
              breaking: i.breaking,
              tests: Number(i.tests),
              testsPassing: Number(i.passing),
              testsFailing: Number(i.failing),
              pullRequests: Number(i.prs),
            })),
            tests: { cases: sumTests, passing, failing, untested: sumTests - passing - failing },
            findings: {
              critical: sev('critical'),
              high: sev('high'),
              medium: sev('medium'),
              low: sev('low'),
            },
            flags: flags.map((f) => ({ key: f.key, enabled: f.enabled })),
            suggested: nextVersion(
              previous,
              items.map((i) => ({ kind: i.kind, breaking: i.breaking })),
            ),
            previous,
          },
        };
      }),
  });

  const changeRelease = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/releases/:releaseId',
    summary:
      'Rename, re-version, set the train, the dates or the notes of a release not yet shipped (member)',
    tags: ['versions'],
    params: relParams,
    body: s.object({
      version: s.optional(s.string({ min: 5, max: 40 })),
      name: s.optional(s.string({ max: 120 })),
      train: s.optional(s.string({ max: 60 })),
      targetDate: s.optional(s.nullable(s.string({ min: 10, max: 10 }))),
      freezeAt: s.optional(s.nullable(s.string({ format: 'date-time' }))),
      notesTeam: s.optional(s.string({ max: 100_000 })),
      notesClient: s.optional(s.string({ max: 100_000 })),
    }),
    response: releaseOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        const shipped = r.state === 'released' || r.state === 'rolled_back';
        if (
          shipped &&
          (body.version ||
            body.train !== undefined ||
            body.targetDate !== undefined ||
            body.freezeAt !== undefined)
        )
          throw new HttpError(
            409,
            'conflict',
            'A shipped release keeps its version and dates; only its name and notes change',
          );
        if (body.version && !VERSION.test(body.version))
          throw new HttpError(400, 'invalid_request', 'Versions are semantic: 1.4.2', [
            { path: 'body.version', message: 'is not a semantic version' },
          ]);
        if (body.version && body.version !== r.version) {
          // [PCODE-306 | S15 | v0.1.0] within the release's own line
          const taken = await c.query(
            'SELECT 1 FROM releases WHERE project_id = $1 AND version = $2 AND component = $3',
            [r.project_id, body.version, r.component],
          );
          if (taken.rowCount)
            throw new HttpError(409, 'conflict', 'Version ' + body.version + ' exists already');
        }
        await c.query(
          `UPDATE releases SET version = coalesce($2, version), name = coalesce($3, name), train = coalesce($4, train),
                  target_date = CASE WHEN $5 THEN $6::date ELSE target_date END, freeze_at = CASE WHEN $7 THEN $8::timestamptz ELSE freeze_at END,
                  notes_team = coalesce($9, notes_team), notes_client = coalesce($10, notes_client),
                  -- [PCODE-205 | S15 | v0.1.0] changed notes ask for approval again
                  notes_approved_by = CASE WHEN $9::text IS NULL AND $10::text IS NULL THEN notes_approved_by END,
                  notes_approved_at = CASE WHEN $9::text IS NULL AND $10::text IS NULL THEN notes_approved_at END,
                  notes_by_agent = CASE WHEN $9::text IS NULL AND $10::text IS NULL THEN notes_by_agent ELSE false END
            WHERE id = $1`,
          [
            r.id,
            body.version ?? null,
            body.name?.trim() ?? null,
            body.train?.trim() ?? null,
            body.targetDate !== undefined,
            body.targetDate ?? null,
            body.freezeAt !== undefined,
            body.freezeAt ?? null,
            body.notesTeam ?? null,
            body.notesClient ?? null,
          ],
        );
        return { body: releaseJson(await releaseOf(c, a, r.id)) };
      }),
  });

  const addItems = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/items',
    summary: 'Put tasks into a release; a frozen release takes only hotfixes and bugs (member)',
    tags: ['versions'],
    params: relParams,
    body: s.object({
      itemIds: s.array(uuid, { min: 1, max: 500 }),
      breaking: s.optional(s.boolean()),
    }),
    response: releaseOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        if (r.state === 'released' || r.state === 'rolled_back')
          throw new HttpError(409, 'conflict', 'The release has shipped; plan the next one');
        const rows = (
          await c.query<{ id: string; kind: string }>(
            'SELECT id, kind FROM items WHERE project_id = $1 AND id = ANY($2::uuid[])',
            [r.project_id, body.itemIds],
          )
        ).rows;
        if (rows.length !== new Set(body.itemIds).size)
          throw new HttpError(
            400,
            'invalid_request',
            'Every task belongs to the release’s project',
            [{ path: 'body.itemIds', message: 'names a task of another project' }],
          );
        const frozen = releaseJson(r).frozen;
        if (frozen && rows.some((x) => x.kind !== 'bug'))
          throw new HttpError(409, 'conflict', 'The release is frozen: only bug fixes go in now');
        for (const x of rows)
          await c.query(
            'INSERT INTO release_items (workspace_id, release_id, item_id, breaking, added_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (release_id, item_id) DO UPDATE SET breaking = $4',
            [a.workspaceId, r.id, x.id, body.breaking ?? false, a.user.id],
          );
        await releaseEvent(c, a, r.project, {
          from: null,
          to: String(rows.length) + ' tasks into ' + r.version,
        });
        return { body: releaseJson(await releaseOf(c, a, r.id)) };
      }),
  });
  const removeItem = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/items/:itemId',
    summary: 'Take a task out of a release not yet shipped (member)',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, releaseId: uuid, itemId: uuid }),
    response: releaseOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        if (r.state === 'released' || r.state === 'rolled_back')
          throw new HttpError(
            409,
            'conflict',
            'The release has shipped; its contents stay as shipped',
          );
        await c.query('DELETE FROM release_items WHERE release_id = $1 AND item_id = $2', [
          r.id,
          params.itemId,
        ]);
        return { body: releaseJson(await releaseOf(c, a, r.id)) };
      }),
  });

  const stateChange = (action: 'freeze' | 'release' | 'rollback') =>
    route({
      method: 'POST',
      path: '/api/workspaces/:workspaceId/releases/:releaseId/' + action,
      summary:
        action === 'freeze'
          ? 'Freeze a release: from now on only bug fixes go in (member)'
          : action === 'release'
            ? 'Ship a release, to an environment if named; its notes are written when empty (member)'
            : 'Roll a shipped release back, with the reason (member)',
      tags: ['versions'],
      params: relParams,
      body: s.optional(
        // [PCODE-176 | S15 | v0.1.0] override: an admin ships despite policy violations, with the reason
        s.object({
          environmentId: s.optional(uuid),
          reason: s.optional(s.string({ max: 2000 })),
          override: s.optional(s.boolean()),
        }),
      ),
      response: releaseOut,
      handler: ({ params, body, req }) =>
        asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
          const r = await releaseOf(c, a, params.releaseId);
          if (action === 'freeze') {
            if (r.state !== 'planned')
              throw new HttpError(
                409,
                'conflict',
                'Only a planned release freezes; this one is ' + r.state,
              );
            await c.query(
              "UPDATE releases SET state = 'frozen', freeze_at = coalesce(freeze_at, now()) WHERE id = $1",
              [r.id],
            );
          } else if (action === 'release') {
            if (r.state !== 'planned' && r.state !== 'frozen')
              throw new HttpError(409, 'conflict', 'This release is ' + r.state);
            // [PCODE-203 | S15 | v0.1.0] a release on a train ships with its train
            const onTrain = (
              await c.query<{ name: string }>(
                'SELECT t.name FROM releases r JOIN release_trains t ON t.id = r.train_id WHERE r.id = $1',
                [r.id],
              )
            ).rows[0];
            if (onTrain)
              throw new HttpError(
                409,
                'conflict',
                r.version + ' ships with the train ' + onTrain.name + '; ship the train',
              );
            // [PCODE-176 | S15 | v0.1.0] the release policies gate the release
            const failing = await releaseViolations(c, r);
            if (failing.length) {
              const why = failing.join(' | ');
              if (!body?.override)
                throw new HttpError(409, 'conflict', 'Release policies block this release: ' + why);
              if (!mayOverride(a))
                throw new HttpError(
                  403,
                  'forbidden',
                  'Only an admin ships despite the release policies',
                );
              if (!body.reason?.trim())
                throw new HttpError(
                  400,
                  'invalid_request',
                  'Say why the release ships despite its policies',
                  [{ path: 'body.reason', message: 'is required to override' }],
                );
              await c.query('UPDATE releases SET notes_team = notes_team || $2 WHERE id = $1', [
                r.id,
                '\n\n## Shipped despite policies\n\n' +
                  why +
                  '\n\nReason: ' +
                  body.reason.trim() +
                  '\n',
              ]);
            }
            if (body?.environmentId) {
              const env = (
                await c.query<{ project_id: string }>(
                  'SELECT project_id FROM environments WHERE id = $1',
                  [body.environmentId],
                )
              ).rows[0];
              if (env?.project_id !== r.project_id)
                throw new HttpError(
                  400,
                  'invalid_request',
                  'The environment belongs to another project',
                  [
                    {
                      path: 'body.environmentId',
                      message: 'is not an environment of this project',
                    },
                  ],
                );
            }
            // [PCODE-203 | S15 | v0.1.0] shipping queues the deploy of the version
            await shipRelease(c, a, r, body?.environmentId ?? null, 'release ' + r.version);
          } else {
            if (r.state !== 'released')
              throw new HttpError(409, 'conflict', 'Only a shipped release rolls back');
            if (!body?.reason?.trim())
              throw new HttpError(400, 'invalid_request', 'Say why it is rolled back', [
                { path: 'body.reason', message: 'is required' },
              ]);
            // [PCODE-203 | S15 | v0.1.0] rolling back redeploys what ran there before
            await rollbackRelease(c, a, r, body.reason, 'rollback of ' + r.version);
          }
          const after = await releaseOf(c, a, r.id);
          await releaseEvent(c, a, r.project, {
            from: r.version + ' ' + r.state,
            to: after.version + ' ' + after.state,
          });
          return { body: releaseJson(after) };
        }),
    });

  const writeNotes = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/notes',
    summary:
      'Write the release notes again from the contents, for the team and the client (member)',
    tags: ['versions'],
    params: relParams,
    response: releaseOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        const items = (
          await c.query<{ ref: string; title: string; kind: string; breaking: boolean }>(
            "SELECT p.key || '-' || i.sequence AS ref, i.title, i.kind, x.breaking FROM release_items x JOIN items i ON i.id = x.item_id JOIN projects p ON p.id = i.project_id WHERE x.release_id = $1 ORDER BY i.sequence",
            [r.id],
          )
        ).rows;
        const date = r.released_at?.toISOString().slice(0, 10) ?? r.target_date ?? undefined;
        await c.query(
          'UPDATE releases SET notes_team = $2, notes_client = $3, notes_approved_by = NULL, notes_approved_at = NULL, notes_by_agent = false WHERE id = $1',
          [
            r.id,
            releaseNotes(r.version, items, 'team', date),
            releaseNotes(r.version, items, 'client', date),
          ],
        );
        return { body: releaseJson(await releaseOf(c, a, r.id)) };
      }),
  });

  const itemReleases = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/items/:itemId/releases',
    summary: 'Which releases carry a task: is the fix in 1.4.x?',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    response: s.array(
      s.object({
        id: s.string(),
        version: s.string(),
        state: s.string(),
        releasedAt: s.nullable(s.string()),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const it = (
          await c.query<{ project_id: string }>('SELECT project_id FROM items WHERE id = $1', [
            params.itemId,
          ])
        ).rows[0];
        if (!it) throw new HttpError(404, 'not_found', 'Item not found');
        await requireProject(c, a, it.project_id);
        const rows = (
          await c.query<{ id: string; version: string; state: string; released_at: Date | null }>(
            'SELECT r.id, r.version, r.state, r.released_at FROM release_items x JOIN releases r ON r.id = x.release_id WHERE x.item_id = $1',
            [params.itemId],
          )
        ).rows.sort((x, y) => compareVersions(x.version, y.version));
        return {
          body: rows.map((r) => ({
            id: r.id,
            version: r.version,
            state: r.state,
            releasedAt: r.released_at?.toISOString() ?? null,
          })),
        };
      }),
  });

  // ── feature flags ──
  const flags = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/flags',
    summary: 'The project’s feature flags with their task, where they are on, and which are stale',
    tags: ['versions'],
    params: projectParams,
    response: s.array(flagOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return {
          body: (
            await c.query<FlagRow>(
              FLAG_SELECT + ' WHERE f.project_id = $1 AND f.removed_at IS NULL ORDER BY f.key',
              [params.projectId],
            )
          ).rows.map(flagJson),
        };
      }),
  });
  const checkEnabled = async (
    c: PoolClient,
    projectId: string,
    enabled: Record<string, unknown> | undefined,
  ): Promise<void> => {
    if (!enabled) return;
    const keys = new Set(
      (
        await c.query<{ key: string }>('SELECT key FROM environments WHERE project_id = $1', [
          projectId,
        ])
      ).rows.map((r) => r.key),
    );
    for (const [k, v] of Object.entries(enabled))
      if (!keys.has(k) || typeof v !== 'boolean')
        throw new HttpError(
          400,
          'invalid_request',
          'Name the project’s environments with true or false',
          [
            {
              path: 'body.enabled.' + k,
              message: keys.has(k)
                ? 'must be true or false'
                : 'is not an environment of this project',
            },
          ],
        );
  };
  const checkItem = async (
    c: PoolClient,
    projectId: string,
    itemId: string | null | undefined,
  ): Promise<void> => {
    if (!itemId) return;
    const it = (
      await c.query<{ project_id: string }>('SELECT project_id FROM items WHERE id = $1', [itemId])
    ).rows[0];
    if (it?.project_id !== projectId)
      throw new HttpError(400, 'invalid_request', 'The task belongs to another project', [
        { path: 'body.itemId', message: 'is not a task of this project' },
      ]);
  };
  const addFlag = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/flags',
    summary: 'Add a feature flag for a task (member)',
    tags: ['versions'],
    params: projectParams,
    body: s.object({
      key: s.string({ min: 2, max: 80 }),
      description: s.optional(s.string({ max: 1000 })),
      itemId: s.optional(s.nullable(uuid)),
      enabled: s.optional(s.anyObject()),
    }),
    response: flagOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        if (!/^[a-z][a-z0-9_.-]{1,79}$/.test(body.key))
          throw new HttpError(400, 'invalid_request', 'Flag keys are lower case: new-checkout', [
            { path: 'body.key', message: 'is not a flag key' },
          ]);
        await checkItem(c, p.id, body.itemId);
        await checkEnabled(c, p.id, body.enabled);
        const taken = await c.query(
          'SELECT 1 FROM feature_flags WHERE project_id = $1 AND key = $2',
          [p.id, body.key],
        );
        if (taken.rowCount)
          throw new HttpError(409, 'conflict', 'The flag ' + body.key + ' exists already');
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO feature_flags (workspace_id, project_id, key, description, item_id, enabled, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [
              a.workspaceId,
              p.id,
              body.key,
              body.description?.trim() ?? '',
              body.itemId ?? null,
              JSON.stringify(body.enabled ?? {}),
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        const row = (await c.query<FlagRow>(FLAG_SELECT + ' WHERE f.id = $1', [id])).rows[0];
        if (!row) throw new Error('flag vanished');
        return { status: 201, body: flagJson(row) };
      }),
  });
  const flagOf = async (
    c: PoolClient,
    a: Access,
    id: string,
  ): Promise<{ id: string; project_id: string }> => {
    const f = (
      await c.query<{ id: string; project_id: string }>(
        'SELECT id, project_id FROM feature_flags WHERE id = $1 AND removed_at IS NULL',
        [id],
      )
    ).rows[0];
    if (!f) throw new HttpError(404, 'not_found', 'Flag not found');
    await requireProject(c, a, f.project_id);
    return f;
  };
  const changeFlag = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/flags/:flagId',
    summary: 'Turn a flag on or off per environment, or change its task or description (member)',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, flagId: uuid }),
    body: s.object({
      description: s.optional(s.string({ max: 1000 })),
      itemId: s.optional(s.nullable(uuid)),
      enabled: s.optional(s.anyObject()),
    }),
    response: flagOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const f = await flagOf(c, a, params.flagId);
        await checkItem(c, f.project_id, body.itemId);
        await checkEnabled(c, f.project_id, body.enabled);
        await c.query(
          `UPDATE feature_flags SET description = coalesce($2, description), item_id = CASE WHEN $3 THEN $4::uuid ELSE item_id END,
                  enabled = CASE WHEN $5::jsonb IS NULL THEN enabled ELSE enabled || $5::jsonb END, updated_at = now() WHERE id = $1`,
          [
            f.id,
            body.description?.trim() ?? null,
            body.itemId !== undefined,
            body.itemId ?? null,
            body.enabled ? JSON.stringify(body.enabled) : null,
          ],
        );
        const row = (await c.query<FlagRow>(FLAG_SELECT + ' WHERE f.id = $1', [f.id])).rows[0];
        if (!row) throw new Error('flag vanished');
        return { body: flagJson(row) };
      }),
  });
  const removeFlag = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/flags/:flagId',
    summary: 'Remove a flag once its code is gone (member)',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, flagId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const f = await flagOf(c, a, params.flagId);
        await c.query('UPDATE feature_flags SET removed_at = now() WHERE id = $1', [f.id]);
        return { body: { removed: true } };
      }),
  });

  // ── DORA ──
  const dora = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/dora',
    summary:
      'Deploy frequency, lead time, change failure rate and time to restore, over the last days, for the production environment',
    tags: ['versions'],
    params: projectParams,
    query: s.object({ days: s.optional(s.string({ min: 1, max: 3 })) }),
    response: s.object({
      days: s.number({ integer: true }),
      environment: s.nullable(s.object({ id: s.string(), name: s.string() })),
      deploysPerWeek: s.number(),
      leadTimeHours: s.nullable(s.number()),
      changeFailureRate: s.nullable(s.number()),
      timeToRestoreHours: s.nullable(s.number()),
      prMergeHours: s.nullable(s.number()),
      deploys: s.number({ integer: true }),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const days = Math.max(7, Math.min(365, Number(query.days ?? 30) || 30));
        const env = await productionOf(c, params.projectId);
        const deploys = env
          ? (
              await c.query<{ status: string; created_at: Date; finished_at: Date | null }>(
                'SELECT status, created_at, finished_at FROM deploy_runs WHERE environment_id = $1 AND created_at > now() - make_interval(days => $2) ORDER BY created_at',
                [env.id, days],
              )
            ).rows
          : [];
        // lead time: a shipped task's first commit (or its creation) to its release
        const leads = (
          await c.query<{ h: string }>(
            `SELECT extract(epoch FROM (r.released_at - coalesce((SELECT min(g.at) FROM item_git_links g WHERE g.item_id = i.id AND g.kind = 'commit'), i.created_at))) / 3600 AS h
               FROM releases r JOIN release_items x ON x.release_id = r.id JOIN items i ON i.id = x.item_id
              WHERE r.project_id = $1 AND r.released_at IS NOT NULL AND r.released_at > now() - make_interval(days => $2)`,
            [params.projectId, days],
          )
        ).rows.map((r) => Math.max(0, Number(r.h)));
        const merges = (
          await c.query<{ h: string }>(
            "SELECT extract(epoch FROM (merged_at - opened_at)) / 3600 AS h FROM pull_requests WHERE project_id = $1 AND state = 'merged' AND merged_at > now() - make_interval(days => $2)",
            [params.projectId, days],
          )
        ).rows.map((r) => Number(r.h));
        const m = doraMetrics(
          deploys.map((d) => ({
            status: d.status,
            createdAt: d.created_at.toISOString(),
            finishedAt: d.finished_at?.toISOString() ?? null,
          })),
          leads,
          days,
        );
        const sorted = [...merges].sort((x, y) => x - y);
        const mid = sorted.length
          ? Math.round((sorted[Math.floor((sorted.length - 1) / 2)] ?? 0) * 10) / 10
          : null;
        return {
          body: { days, environment: env, ...m, prMergeHours: mid, deploys: deploys.length },
        };
      }),
  });

  // [PCODE-178 | S15 | v0.1.0] the Releases page: every visible project's next release and what is live
  const overview = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/release-overview',
    summary:
      'Every project the caller may see: its next release with readiness, the last shipped version and open pull requests',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(
      s.object({
        projectId: s.string(),
        key: s.string(),
        name: s.string(),
        next: s.nullable(releaseOut),
        lastReleased: s.nullable(
          s.object({ id: s.string(), version: s.string(), releasedAt: s.nullable(s.string()) }),
        ),
        openPulls: s.number({ integer: true }),
        planned: s.number({ integer: true }),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const projects = (
          await c.query<{ id: string; key: string; name: string; pulls: string }>(
            `SELECT p.id, p.key, p.name,
                    (SELECT count(*) FROM pull_requests x WHERE x.project_id = p.id AND x.state = 'open') AS pulls
               FROM projects p
              WHERE p.archived_at IS NULL AND ($1 <> 'guest' OR guest_sees_project(p.id, $2))
              ORDER BY p.name`,
            [a.role, a.user.id],
          )
        ).rows;
        const all = (
          await c.query<ReleaseRow>(RELEASE_SELECT + ' WHERE r.project_id = ANY($1::uuid[])', [
            projects.map((p) => p.id),
          ])
        ).rows;
        return {
          body: projects.map((p) => {
            const mine = all.filter((r) => r.project_id === p.id);
            const open = mine
              .filter((r) => r.state === 'planned' || r.state === 'frozen')
              .sort((x, y) => compareVersions(x.version, y.version));
            const shipped = mine
              .filter((r) => r.state === 'released')
              .sort((x, y) => compareVersions(x.version, y.version))
              .at(-1);
            return {
              projectId: p.id,
              key: p.key,
              name: p.name,
              next: open[0] ? releaseJson(open[0]) : null,
              lastReleased: shipped
                ? {
                    id: shipped.id,
                    version: shipped.version,
                    releasedAt: shipped.released_at?.toISOString() ?? null,
                  }
                : null,
              openPulls: Number(p.pulls),
              planned: open.length,
            };
          }),
        };
      }),
  });

  return [
    pulls,
    releases,
    createRelease,
    contents,
    changeRelease,
    addItems,
    removeItem,
    stateChange('freeze'),
    stateChange('release'),
    stateChange('rollback'),
    writeNotes,
    itemReleases,
    flags,
    addFlag,
    changeFlag,
    removeFlag,
    dora,
    overview,
  ];
}
