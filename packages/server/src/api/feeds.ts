// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
//    Why:  an admin sees whether the feeds are on and when they were last read, and reads them now. They
//          stay off until an admin switches them on in the settings, because EPSS is sent the CVE ids.
import type { Pool } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { refreshFeeds, type FeedDeps } from '../security/feeds.js';
import { asMember } from './access.js';
import { settingFor } from './settingvalue.js';

const uuid = s.string({ format: 'uuid' });

export function feedRoutes(pool: Pool, feeds: FeedDeps): Route[] {
  const params = s.object({ workspaceId: uuid });
  const status = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/security/feeds',
    summary:
      'Whether the vulnerability feeds are on, when they were last read, what they know of this workspace’s CVEs',
    tags: ['security'],
    params,
    response: s.object({
      on: s.boolean(),
      lastAt: s.nullable(s.string()),
      cves: s.number({ integer: true }),
      known: s.number({ integer: true }),
      exploited: s.number({ integer: true }),
    }),
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c) => {
        const on = (await settingFor(c, 'security.vuln_feeds', null)) === true;
        const r = (
          await c.query<{ cves: string; known: string; exploited: string; last: Date | null }>(
            `SELECT count(DISTINCT upper(f.cve)) AS cves, count(DISTINCT x.cve) AS known,
                    count(DISTINCT x.cve) FILTER (WHERE x.kev) AS exploited, max(x.updated_at) AS last
               FROM findings f LEFT JOIN cve_facts x ON x.cve = upper(f.cve)
              WHERE f.cve ILIKE 'CVE-%' AND f.status IN ('open', 'accepted')`,
          )
        ).rows[0];
        return {
          body: {
            on,
            lastAt: r?.last?.toISOString() ?? null,
            cves: Number(r?.cves ?? 0),
            known: Number(r?.known ?? 0),
            exploited: Number(r?.exploited ?? 0),
          },
        };
      }),
  });

  const refresh = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/security/feeds/refresh',
    summary: 'Read the EPSS and known-exploited feeds now for this workspace’s CVEs (admin)',
    tags: ['security'],
    params,
    response: s.object({
      cves: s.number({ integer: true }),
      kev: s.number({ integer: true }),
      epss: s.number({ integer: true }),
      findings: s.number({ integer: true }),
    }),
    handler: async ({ params: p, req }) => {
      await asMember(pool, req, p.workspaceId, 'admin', async (c) => {
        if ((await settingFor(c, 'security.vuln_feeds', null)) !== true)
          throw new HttpError(
            409,
            'conflict',
            'Switch the vulnerability feeds on in Settings first: EPSS is sent the CVE ids',
          );
      });
      try {
        return { body: await refreshFeeds(pool, feeds, [p.workspaceId]) };
      } catch (e) {
        throw new HttpError(
          502,
          'bad_gateway',
          'The feeds could not be read: ' + (e instanceof Error ? e.message : String(e)),
        );
      }
    },
  });

  return [status, refresh];
}
