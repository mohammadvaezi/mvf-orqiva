// ── [PCODE-340 | S15 | v0.1.0] T34.2a Automatic alerts from probes and failed deploys; Sentry and Alertmanager sources with signed webhooks ──
//    Why:  alerts should not wait for someone to notice. A component whose probe fails three times in a
//          row, and a failed deploy, raise an alert by themselves and clear it when things work again.
//          Sentry and Prometheus Alertmanager post to an address of their own: Alertmanager with a bearer
//          token, Sentry with each body signed (HMAC-SHA256); anything else is turned away.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncidentSeverity } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { open, seal, SecretKeyMissing } from '../agents/secrets.js';
import { inSystem, inWorkspace } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';
import { ingestAlert, systemActor, type AlertIn } from './incidents.js';

const uuid = s.string({ format: 'uuid' });
/** Failed probes in a row before a component counts as down. */
export const PROBE_FAILURES = 3;

/** Alertmanager's severity label as ours. */
export function amSeverity(label: string | undefined): IncidentSeverity {
  const l = (label ?? '').toLowerCase();
  if (l === 'critical' || l === 'page' || l === 'sev1') return 'sev1';
  if (l === 'error' || l === 'high' || l === 'major' || l === 'sev2') return 'sev2';
  if (l === 'info' || l === 'low' || l === 'none' || l === 'sev4') return 'sev4';
  return 'sev3';
}

/** Sentry's level as ours: a fatal error pages, an error is noted. */
export function sentrySeverity(level: string | undefined): IncidentSeverity {
  const l = (level ?? '').toLowerCase();
  if (l === 'fatal') return 'sev2';
  if (l === 'error') return 'sev3';
  return 'sev4';
}

type Alertish = Pick<AlertIn, 'key' | 'severity' | 'title' | 'resolved' | 'details'>;

/** An Alertmanager webhook body: one alert per firing or resolved alert, keyed by its fingerprint. */
export function fromAlertmanager(body: Record<string, unknown>): Alertish[] {
  const alerts = Array.isArray(body['alerts']) ? (body['alerts'] as Record<string, unknown>[]) : [];
  return alerts.flatMap((a) => {
    const labels = (a['labels'] ?? {}) as Record<string, string>;
    const notes = (a['annotations'] ?? {}) as Record<string, string>;
    const fp =
      typeof a['fingerprint'] === 'string' ? a['fingerprint'] : (labels['alertname'] ?? '');
    if (!fp) return [];
    const title = (notes['summary'] || labels['alertname'] || 'Alert').slice(0, 200);
    return [
      {
        key: ('am:' + fp).slice(0, 200),
        severity: amSeverity(labels['severity']),
        title,
        resolved: a['status'] === 'resolved',
        details: {
          labels,
          description: notes['description'] ?? '',
          startsAt: a['startsAt'] ?? null,
        },
      },
    ];
  });
}

/** A Sentry webhook body (issue or issue alert): one alert per issue. */
export function fromSentry(body: Record<string, unknown>): Alertish[] {
  const data = (body['data'] ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const issue = data['issue'] ?? {};
  const event = data['event'] ?? {};
  const text = (...vs: unknown[]): string => {
    const v = vs.find((x) => typeof x === 'string' || typeof x === 'number');
    return v === undefined ? '' : String(v);
  };
  const id = text(issue['id'], event['issue_id']);
  if (!id) return [];
  const title = (text(issue['title'], event['title']) || 'Sentry issue').slice(0, 200);
  const level = text(issue['level'], event['level']) || 'error';
  return [
    {
      key: 'sentry:' + id,
      severity: sentrySeverity(level),
      title,
      resolved: body['action'] === 'resolved',
      details: {
        level,
        shortId: issue['shortId'] ?? null,
        link: issue['permalink'] ?? event['web_url'] ?? null,
      },
    },
  ];
}

/** Sentry's signature: HMAC-SHA256 of the body with the client secret, hex, compared in constant time. */
export function sentrySigned(rawBody: string, secret: string, signature: string): boolean {
  const want = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(want);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const sameSecret = (given: string, secret: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** After a probe: down after three failures in a row, cleared at the first good one. */
export async function probeAlert(pool: Pool, componentId: string, ok: boolean): Promise<void> {
  const comp = await inSystem(
    pool,
    async (c) =>
      (
        await c.query<{
          workspace_id: string;
          name: string;
          environment_id: string | null;
          project_id: string | null;
        }>(
          `SELECT sc.workspace_id, sc.name, sc.environment_id, e.project_id
           FROM status_components sc LEFT JOIN environments e ON e.id = sc.environment_id WHERE sc.id = $1`,
          [componentId],
        )
      ).rows[0],
  );
  if (!comp) return;
  await inWorkspace(pool, comp.workspace_id, async (c) => {
    const key = 'probe:' + componentId;
    if (ok) {
      const open = (
        await c.query("SELECT 1 FROM alerts WHERE dedupe_key = $1 AND status = 'open'", [key])
      ).rowCount;
      if (open)
        await ingestAlert(c, systemActor(comp.workspace_id, 'Status probe'), {
          source: 'probe',
          key,
          severity: 'sev2',
          title: comp.name + ' answers again',
          resolved: true,
        });
      return;
    }
    const recent = (
      await c.query<{ ok: boolean }>(
        'SELECT ok FROM status_checks WHERE component_id = $1 ORDER BY at DESC LIMIT $2',
        [componentId, PROBE_FAILURES],
      )
    ).rows;
    if (recent.length < PROBE_FAILURES || recent.some((r) => r.ok)) return;
    await ingestAlert(c, systemActor(comp.workspace_id, 'Status probe'), {
      source: 'probe',
      key,
      severity: 'sev2',
      title: comp.name + ' is not answering',
      projectId: comp.project_id,
      environmentId: comp.environment_id,
      details: { failures: PROBE_FAILURES },
    });
  });
}

/** After a deploy: a failure raises an alert for its environment, a success there clears it. */
export async function deployAlert(
  c: PoolClient,
  workspaceId: string,
  d: {
    id: string;
    project_id: string;
    environment_id: string;
    environment_name: string;
    project_key: string;
  },
  status: 'succeeded' | 'failed',
  error: string,
): Promise<void> {
  const key = 'deploy:' + d.environment_id;
  const production = /prod/i.test(d.environment_name);
  await ingestAlert(c, systemActor(workspaceId, 'Deploys'), {
    source: 'deploy',
    key,
    severity: production ? 'sev2' : 'sev3',
    title:
      (status === 'failed' ? 'Deploy failed: ' : 'Deploy works again: ') +
      d.project_key +
      ' ' +
      d.environment_name,
    projectId: d.project_id,
    environmentId: d.environment_id,
    resolved: status === 'succeeded',
    details: { deployId: d.id, error: error.slice(0, 500) },
  });
}

const sourceOut = s.object({
  id: s.string(),
  kind: s.enum(['sentry', 'alertmanager']),
  name: s.string(),
  projectId: s.nullable(s.string()),
  url: s.string(),
  received: s.number({ integer: true }),
  lastAt: s.nullable(s.string()),
  lastError: s.string(),
});
interface SourceRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  kind: 'sentry' | 'alertmanager';
  name: string;
  secret_sealed: string;
  received: number;
  last_at: Date | null;
  last_error: string;
}

export function monitoringRoutes(pool: Pool, deps: { publicUrl?: string } = {}): Route[] {
  const hookUrl = (id: string): string =>
    (deps.publicUrl ?? '').replace(/\/$/, '') + '/hooks/alerts/' + id;
  const json = (r: SourceRow) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    projectId: r.project_id,
    url: hookUrl(r.id),
    received: r.received,
    lastAt: r.last_at?.toISOString() ?? null,
    lastError: r.last_error,
  });
  const ws = s.object({ workspaceId: uuid });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/alert-sources',
    summary:
      'Sentry and Alertmanager sources and their webhook addresses; never their secrets (admin)',
    tags: ['incidents'],
    params: ws,
    response: s.array(sourceOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: (
          await c.query<SourceRow>('SELECT * FROM alert_sources ORDER BY created_at')
        ).rows.map(json),
      })),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/alert-sources',
    summary:
      'Add a Sentry or Alertmanager source: its address and its secret, shown only now (admin)',
    tags: ['incidents'],
    params: ws,
    body: s.object({
      kind: s.enum(['sentry', 'alertmanager']),
      name: s.string({ min: 1, max: 80 }),
      projectId: s.optional(uuid),
      // Sentry's client secret of the integration; generated when left out (Alertmanager)
      secret: s.optional(s.string({ min: 16, max: 200 })),
    }),
    response: s.object({ source: sourceOut, secret: s.string() }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        if (
          body.projectId &&
          !(await c.query('SELECT 1 FROM projects WHERE id = $1', [body.projectId])).rowCount
        )
          throw new HttpError(400, 'invalid_request', 'Unknown project', [
            { path: 'body.projectId', message: 'is not a project of this workspace' },
          ]);
        const secret = body.secret?.trim() ?? randomBytes(24).toString('base64url');
        let sealed: string;
        try {
          sealed = seal(secret);
        } catch (e) {
          if (e instanceof SecretKeyMissing) throw new HttpError(409, 'conflict', e.message);
          throw e;
        }
        const r = (
          await c.query<SourceRow>(
            `INSERT INTO alert_sources (workspace_id, project_id, kind, name, secret_sealed, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [a.workspaceId, body.projectId ?? null, body.kind, body.name.trim(), sealed, a.user.id],
          )
        ).rows[0];
        if (!r) throw new Error('source insert returned nothing');
        return { status: 201, body: { source: json(r), secret } };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/alert-sources/:sourceId',
    summary: 'Remove a source: its address stops taking alerts (admin)',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, sourceId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: {
          removed: Boolean(
            (await c.query('DELETE FROM alert_sources WHERE id = $1', [params.sourceId])).rowCount,
          ),
        },
      })),
  });

  const hook = route({
    method: 'POST',
    path: '/hooks/alerts/:sourceId',
    summary: 'Alerts from Sentry (signed body) or Alertmanager (bearer token); no sign-in',
    tags: ['incidents'],
    params: s.object({ sourceId: uuid }),
    body: s.anyObject(),
    response: s.object({ alerts: s.number({ integer: true }) }),
    status: 202,
    handler: async ({ params, body, req, rawBody }) => {
      const src = await inSystem(
        pool,
        async (c) =>
          (await c.query<SourceRow>('SELECT * FROM alert_sources WHERE id = $1', [params.sourceId]))
            .rows[0],
      );
      // one answer for a missing source and a wrong secret
      const refuse = (): never => {
        throw new HttpError(401, 'unauthorized', 'Not a known source or not its secret');
      };
      if (!src) return refuse();
      const secret = open(src.secret_sealed);
      if (src.kind === 'sentry') {
        const sig = req.headers['sentry-hook-signature'];
        if (typeof sig !== 'string' || !sentrySigned(rawBody ?? '', secret, sig)) return refuse();
      } else {
        const auth = req.headers.authorization ?? '';
        if (!auth.startsWith('Bearer ') || !sameSecret(auth.slice(7).trim(), secret))
          return refuse();
      }
      const alerts = src.kind === 'sentry' ? fromSentry(body) : fromAlertmanager(body);
      await inWorkspace(pool, src.workspace_id, async (c) => {
        for (const a of alerts)
          await ingestAlert(c, systemActor(src.workspace_id, src.name), {
            ...a,
            source: src.kind,
            projectId: src.project_id,
          });
        await c.query(
          'UPDATE alert_sources SET received = received + $2, last_at = now(), last_error = $3 WHERE id = $1',
          [src.id, alerts.length, alerts.length ? '' : 'the last body held no alert'],
        );
      });
      return { status: 202, body: { alerts: alerts.length } };
    },
  });

  return [list, create, remove, hook];
}
