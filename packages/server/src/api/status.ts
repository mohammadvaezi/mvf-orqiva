// ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
// ── [PCODE-340 | S15 | v0.1.0] T34.2a Automatic alerts from probes and failed deploys; Sentry and Alertmanager sources with signed webhooks ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
//    Why:  the client's status page and their own portal domain. The team names a client's components;
//          those with a public https address are probed every minute, and the page shows each one's state,
//          30 days of uptime, the incidents the team chose to report to the client (with their updates)
//          and postmortems the team shared. A client's portal domain counts once a DNS TXT record proves
//          the client controls it; a TLS proxy asks the server which names it may get certificates for.
import { probeAlert } from './monitoring.js'; // [PCODE-340 | S15 | v0.1.0]
import { randomBytes } from 'node:crypto';
import { resolveTxt as dnsResolveTxt } from 'node:dns/promises';
import { durationText, localDay, severityText } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';
import { isPublicUrl } from './documents.js';
import { portalScope } from './portal.js';

const uuid = s.string({ format: 'uuid' });

export type DayState = 'ok' | 'slow' | 'down' | 'none';

/** A day's state from its probes: down below 95 % up, slow below 99.9 % or above 2 s typical latency. */
export function dayState(total: number, ok: number, avgLatencyMs: number | null): DayState {
  if (!total) return 'none';
  const pct = ok / total;
  if (pct < 0.95) return 'down';
  if (pct < 0.999 || (avgLatencyMs ?? 0) > 2000) return 'slow';
  return 'ok';
}

/** A component now: an open incident on its environment decides; else its last probe; else unknown. */
export function componentState(
  last: { ok: boolean; latencyMs: number | null; at: Date } | null,
  incidentSeverity: string | null,
  now = new Date(),
): 'working' | 'slow' | 'down' | 'unknown' {
  if (incidentSeverity === 'sev1' || incidentSeverity === 'sev2') return 'down';
  if (incidentSeverity) return 'slow';
  // no probe for ten minutes: nothing is known
  if (!last || now.getTime() - last.at.getTime() > 10 * 60_000) return 'unknown';
  if (!last.ok) return 'down';
  return (last.latencyMs ?? 0) > 2000 ? 'slow' : 'working';
}

export interface ProbeDeps {
  fetch?: typeof fetch;
  isPublic?: (url: string) => Promise<boolean>;
  now?: () => Date;
}

/** One round of probes: every component with an address is asked once; old results go. */
export async function probeAll(pool: Pool, deps: ProbeDeps = {}): Promise<number> {
  const doFetch = deps.fetch ?? fetch;
  const isPublic = deps.isPublic ?? isPublicUrl;
  const targets = await inSystem(
    pool,
    async (c) =>
      (
        await c.query<{ id: string; workspace_id: string; probe_url: string }>(
          'SELECT id, workspace_id, probe_url FROM status_components WHERE probe_url IS NOT NULL',
        )
      ).rows,
  );
  let n = 0;
  for (const t of targets) {
    let ok = false;
    let code: number | null = null;
    let latency: number | null = null;
    const started = Date.now();
    // only public https addresses: the server never probes its own network
    if (t.probe_url.startsWith('https://') && (await isPublic(t.probe_url))) {
      try {
        const res = await doFetch(t.probe_url, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
          headers: { 'user-agent': 'Orqiva status probe' },
        });
        code = res.status;
        ok = res.status < 400;
        latency = Date.now() - started;
      } catch {
        ok = false;
      }
    }
    await inSystem(pool, (c) =>
      c.query(
        'INSERT INTO status_checks (workspace_id, component_id, at, ok, latency_ms, code) VALUES ($1, $2, $3, $4, $5, $6)',
        [t.workspace_id, t.id, deps.now?.() ?? new Date(), ok, latency, code],
      ),
    );
    // [PCODE-340 | S15 | v0.1.0] three failures in a row raise an alert; the first good check clears it
    await probeAlert(pool, t.id, ok).catch(() => undefined);
    n += 1;
  }
  await inSystem(pool, (c) =>
    c.query("DELETE FROM status_checks WHERE at < now() - interval '31 days'"),
  );
  return n;
}

async function componentsOf(c: PoolClient, clientId: string) {
  return (
    await c.query<{
      id: string;
      name: string;
      environment_id: string | null;
      environment: string | null;
      environment_key: string | null; // [PCODE-341 | S15 | v0.1.0]
      probe_url: string | null;
      position: number;
    }>(
      `SELECT sc.id, sc.name, sc.environment_id, e.name AS environment, e.key AS environment_key, sc.probe_url, sc.position
         FROM status_components sc LEFT JOIN environments e ON e.id = sc.environment_id
        WHERE sc.client_id = $1 ORDER BY sc.position, sc.created_at`,
      [clientId],
    )
  ).rows;
}

/** [PCODE-341 | S15 | v0.1.0] What a status page shows; the public page leaves the postmortems out. */
export type StatusPageData = {
  incidents: Record<string, unknown>[];
  components: Record<string, unknown>[];
  postmortems: Record<string, unknown>[];
};

/** [PCODE-341 | S15 | v0.1.0] A client's status page: for the portal and, when the client opens it, for everyone. */
export async function statusPage(
  c: PoolClient,
  clientId: string,
  projectIds: string[],
  environmentKey: string | null = null,
): Promise<StatusPageData> {
  // [PCODE-341 | S15 | v0.1.0] one environment's page, when asked for
  const comps = (await componentsOf(c, clientId)).filter(
    (x) => !environmentKey || x.environment_key === environmentKey,
  );
  const ids = comps.map((x) => x.id);
  const days = (
    await c.query<{
      component_id: string;
      day: string;
      total: string;
      ok: string;
      latency: string | null;
    }>(
      `SELECT component_id, (at AT TIME ZONE 'Europe/Berlin')::date::text AS day, count(*) AS total,
            count(*) FILTER (WHERE ok) AS ok, avg(latency_ms) FILTER (WHERE ok) AS latency
           FROM status_checks WHERE component_id = ANY($1::uuid[]) AND at > now() - interval '30 days'
          GROUP BY 1, 2`,
      [ids],
    )
  ).rows;
  const last = (
    await c.query<{ component_id: string; ok: boolean; latency_ms: number | null; at: Date }>(
      `SELECT DISTINCT ON (component_id) component_id, ok, latency_ms, at FROM status_checks
          WHERE component_id = ANY($1::uuid[]) ORDER BY component_id, at DESC`,
      [ids],
    )
  ).rows;
  // incidents the team reports to this client: open, on its projects, with at least one client update
  const incidents = (
    await c.query<{
      id: string;
      number: number;
      title: string;
      severity: string;
      state: string;
      environment_id: string | null;
      declared_at: Date;
      body: string;
      next_update_at: Date | null;
      updated_at: Date;
    }>(
      `SELECT x.id, x.number, x.title, x.severity, x.state, x.environment_id, x.declared_at,
            u.body, u.next_update_at, u.created_at AS updated_at
           FROM incidents x JOIN LATERAL (
             SELECT body, next_update_at, created_at FROM incident_updates
              WHERE incident_id = x.id AND audience = 'client' ORDER BY created_at DESC LIMIT 1
           ) u ON true
          WHERE x.resolved_at IS NULL AND x.project_id = ANY($1::uuid[])
          ORDER BY x.declared_at DESC`,
      [projectIds],
    )
  ).rows;
  const postmortems = (
    await c.query<{
      id: string;
      number: number;
      title: string;
      severity: string;
      resolved_at: Date;
      postmortem: string;
    }>(
      `SELECT id, number, title, severity, resolved_at, postmortem FROM incidents
          WHERE postmortem_shared AND resolved_at IS NOT NULL AND project_id = ANY($1::uuid[])
            AND resolved_at > now() - interval '90 days'
          ORDER BY resolved_at DESC LIMIT 10`,
      [projectIds],
    )
  ).rows;
  const today = new Date();
  // days as the probes are bucketed: in Berlin time
  const dayList = Array.from({ length: 30 }, (_, i) =>
    localDay(new Date(today.getTime() - (29 - i) * 86_400_000)),
  );
  return {
    incidents: incidents.map((x) => ({
      id: x.id,
      title: x.title,
      severity: severityText(x.severity),
      state: x.state,
      update: x.body,
      updatedAt: x.updated_at.toISOString(),
      nextUpdateAt: x.next_update_at?.toISOString() ?? null,
      openFor: durationText((Date.now() - x.declared_at.getTime()) / 60_000),
    })),
    components: comps.map((comp) => {
      const mine = days.filter((d) => d.component_id === comp.id);
      const total = mine.reduce((n, d) => n + Number(d.total), 0);
      const ok = mine.reduce((n, d) => n + Number(d.ok), 0);
      const l = last.find((x) => x.component_id === comp.id);
      const inc = incidents.find(
        (x) => comp.environment_id && x.environment_id === comp.environment_id,
      );
      return {
        id: comp.id,
        name: comp.name,
        environment: comp.environment, // [PCODE-341 | S15 | v0.1.0]
        state: componentState(
          l ? { ok: l.ok, latencyMs: l.latency_ms, at: l.at } : null,
          inc?.severity ?? null,
        ),
        probed: comp.probe_url !== null,
        uptimePct: total ? Math.round((ok / total) * 10000) / 100 : null,
        days: dayList.map((day) => {
          const d = mine.find((x) => x.day === day);
          return {
            day,
            state: d
              ? dayState(
                  Number(d.total),
                  Number(d.ok),
                  d.latency === null ? null : Number(d.latency),
                )
              : 'none',
          };
        }),
      };
    }),
    postmortems: postmortems.map((p) => ({
      id: p.id,
      title: p.title,
      severity: severityText(p.severity),
      resolvedAt: p.resolved_at.toISOString(),
      text: p.postmortem,
    })),
  };
}

export interface StatusDeps {
  resolveTxt?: (name: string) => Promise<string[][]>;
}

export function statusRoutes(pool: Pool, deps: StatusDeps = {}): Route[] {
  const resolveTxt = deps.resolveTxt ?? dnsResolveTxt;

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/clients/:clientId/status-components',
    summary: 'The components on a client’s status page, with their last probe',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        if (a.clientId) throw new HttpError(403, 'forbidden', 'This is the team’s view');
        const rows = await componentsOf(c, params.clientId);
        const last = (
          await c.query<{ component_id: string; ok: boolean; latency_ms: number | null; at: Date }>(
            `SELECT DISTINCT ON (component_id) component_id, ok, latency_ms, at FROM status_checks
              WHERE component_id = ANY($1::uuid[]) ORDER BY component_id, at DESC`,
            [rows.map((r) => r.id)],
          )
        ).rows;
        return {
          body: {
            components: rows.map((r) => {
              const l = last.find((x) => x.component_id === r.id);
              return {
                id: r.id,
                name: r.name,
                environmentId: r.environment_id,
                environment: r.environment,
                probeUrl: r.probe_url,
                lastCheck: l ? { ok: l.ok, latencyMs: l.latency_ms, at: l.at.toISOString() } : null,
              };
            }),
            mayEdit: a.role === 'admin' || a.role === 'owner',
          },
        };
      }),
  });

  const add = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/clients/:clientId/status-components',
    summary:
      'Add a component to a client’s status page; with a public https address it is probed (admin)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    body: s.object({
      name: s.string({ min: 1, max: 80 }),
      environmentId: s.optional(uuid),
      probeUrl: s.optional(s.string({ max: 500 })),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const probe = body.probeUrl?.trim() || null;
        if (probe && (!probe.startsWith('https://') || !(await isPublicUrl(probe))))
          throw new HttpError(400, 'invalid_request', 'Probes reach public https addresses only', [
            { path: 'body.probeUrl', message: 'must be a public https address' },
          ]);
        const ok = (await c.query('SELECT 1 FROM clients WHERE id = $1', [params.clientId]))
          .rowCount;
        if (!ok) throw new HttpError(404, 'not_found', 'Client not found');
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO status_components (workspace_id, client_id, name, environment_id, probe_url, position)
             VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(position), 0) + 1 FROM status_components WHERE client_id = $2))
             RETURNING id`,
            [a.workspaceId, params.clientId, body.name.trim(), body.environmentId ?? null, probe],
          )
        ).rows[0]?.id;
        return { status: 201, body: { id } };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/status-components/:componentId',
    summary: 'Remove a component from a status page (admin)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, componentId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const n = (
          await c.query('DELETE FROM status_components WHERE id = $1', [params.componentId])
        ).rowCount;
        if (!n) throw new HttpError(404, 'not_found', 'Component not found');
        return { body: { removed: n } };
      }),
  });

  // ── own domains ──
  const domain = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/clients/:clientId/domain',
    summary:
      'The DNS record that proves a client’s portal domain, and whether it is verified (admin)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const cl = (
          await c.query<{
            portal_domain: string | null;
            domain_token: string | null;
            domain_verified_at: Date | null;
          }>('SELECT portal_domain, domain_token, domain_verified_at FROM clients WHERE id = $1', [
            params.clientId,
          ])
        ).rows[0];
        if (!cl) throw new HttpError(404, 'not_found', 'Client not found');
        let token = cl.domain_token;
        if (!token) {
          token = randomBytes(16).toString('hex');
          await c.query('UPDATE clients SET domain_token = $2 WHERE id = $1', [
            params.clientId,
            token,
          ]);
        }
        return {
          body: {
            domain: cl.portal_domain,
            verified: cl.domain_verified_at !== null,
            verifiedAt: cl.domain_verified_at?.toISOString() ?? null,
            record: cl.portal_domain
              ? {
                  type: 'TXT',
                  name: '_orqiva.' + cl.portal_domain,
                  value: 'orqiva-verify=' + token,
                }
              : null,
          },
        };
      }),
  });

  const verify = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/clients/:clientId/domain/verify',
    summary: 'Look up the DNS record and mark the portal domain verified when it matches (admin)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    body: s.object({}),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const cl = (
          await c.query<{ portal_domain: string | null; domain_token: string | null }>(
            'SELECT portal_domain, domain_token FROM clients WHERE id = $1',
            [params.clientId],
          )
        ).rows[0];
        if (!cl) throw new HttpError(404, 'not_found', 'Client not found');
        if (!cl.portal_domain || !cl.domain_token)
          throw new HttpError(
            409,
            'conflict',
            'Set the portal domain and open its DNS record first',
          );
        let records: string[] = [];
        try {
          // [PCODE-192 | S15 | v0.1.0] a record made before the rename (_prodengine.) still counts
          for (const name of ['_orqiva.', '_prodengine.']) {
            records = (await resolveTxt(name + cl.portal_domain).catch(() => [])).map((r) =>
              r.join(''),
            );
            if (records.length) break;
          }
        } catch {
          records = [];
        }
        const ok =
          records.includes('orqiva-verify=' + cl.domain_token) ||
          records.includes('prodengine-verify=' + cl.domain_token);
        if (ok)
          await c.query('UPDATE clients SET domain_verified_at = now() WHERE id = $1', [
            params.clientId,
          ]);
        return {
          body: {
            verified: ok,
            found: records.filter((r) => /^(orqiva|prodengine)-verify=/.test(r)),
            message: ok
              ? cl.portal_domain + ' is verified; its certificate is issued on the first visit'
              : records.length
                ? 'The record is there but holds another value'
                : 'No record found yet; DNS changes can take a while',
          },
        };
      }),
  });

  // a TLS proxy (Caddy's on-demand TLS) asks before it gets a certificate for a name
  const tlsAllow = route({
    method: 'GET',
    path: '/internal/tls/allow',
    summary:
      'Whether the proxy may get a certificate for a name: verified portal domains and this server’s own',
    tags: ['clients'],
    query: s.object({ domain: s.string({ min: 1, max: 253 }) }),
    response: s.anyObject(),
    handler: async ({ query }) => {
      const name = query.domain.trim().toLowerCase();
      const own = (() => {
        try {
          return new URL(process.env['ORQIVA_PUBLIC_URL'] ?? '').hostname.toLowerCase();
        } catch {
          return '';
        }
      })();
      const known =
        name === own ||
        Boolean(
          await inSystem(
            pool,
            async (c) =>
              (
                await c.query(
                  'SELECT 1 FROM clients WHERE portal_domain = $1 AND domain_verified_at IS NOT NULL',
                  [name],
                )
              ).rowCount,
          ),
        );
      if (!known) throw new HttpError(404, 'not_found', 'Not a domain of this server');
      return { body: { allowed: true } };
    },
  });

  // ── the portal ──
  const portalStatus = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/status',
    summary:
      'The client’s components with state and 30 days of uptime, reported incidents, shared postmortems',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ clientId: s.optional(uuid) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        return { body: await statusPage(c, ctx.clientId, ctx.projectIds) };
      }),
  });

  return [list, add, remove, domain, verify, tlsAllow, portalStatus];
}
