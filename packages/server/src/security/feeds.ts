// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
//    Why:  the findings' EPSS score and known-exploited mark come from the public feeds, for workspaces
//          whose admins switched them on: the CISA catalog is downloaded whole (nothing is sent), EPSS is
//          asked for the CVEs those workspaces' findings name. Once a day, or now when an admin asks. The
//          facts go into the findings and their risk scores follow.
import { epssUrls, parseEpss, parseKev } from '@orqiva/shared';
import type { Pool } from 'pg';
import { refreshFindings } from '../api/posture.js';
import { settingFor } from '../api/settingvalue.js';
import { inSystem, inWorkspace } from '../db/pool.js';

export interface FeedDeps {
  fetch: typeof fetch;
  kevUrl: string;
  epssUrl: string;
}

export const DEFAULT_FEEDS: FeedDeps = {
  fetch: (input, init) => fetch(input, init),
  kevUrl: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
  epssUrl: 'https://api.first.org/data/v1/epss',
};

/** A day between two runs of the daily refresh. */
export const FEED_EVERY_MS = 24 * 3600_000;

export interface FeedResult {
  cves: number;
  kev: number;
  epss: number;
  /** findings whose facts changed */
  findings: number;
}

const getJson = async (deps: FeedDeps, url: string): Promise<unknown> => {
  const res = await deps.fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Orqiva' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error((url.split('?')[0] ?? url) + ' answered ' + String(res.status));
  return res.json();
};

/** The workspaces whose admins switched the feeds on. */
export async function feedWorkspaces(pool: Pool): Promise<string[]> {
  const all = await inSystem(pool, async (c) =>
    (await c.query<{ id: string }>('SELECT id FROM workspaces')).rows.map((r) => r.id),
  );
  const on: string[] = [];
  for (const ws of all)
    if (
      await inWorkspace(
        pool,
        ws,
        async (c) => (await settingFor(c, 'security.vuln_feeds', null)) === true,
      )
    )
      on.push(ws);
  return on;
}

/** Reads the feeds for the CVEs of the given workspaces and puts the facts into their findings. */
export async function refreshFeeds(
  pool: Pool,
  deps: FeedDeps,
  workspaceIds: readonly string[],
): Promise<FeedResult> {
  const cves = new Set<string>();
  for (const ws of workspaceIds)
    for (const cve of await inWorkspace(pool, ws, async (c) =>
      (
        await c.query<{ cve: string }>(
          "SELECT DISTINCT upper(cve) AS cve FROM findings WHERE cve ILIKE 'CVE-%' AND status IN ('open', 'accepted')",
        )
      ).rows.map((r) => r.cve),
    ))
      cves.add(cve);
  const result: FeedResult = { cves: cves.size, kev: 0, epss: 0, findings: 0 };
  if (!cves.size) return result;
  const kev = parseKev(await getJson(deps, deps.kevUrl));
  const scores = new Map<string, { epss: number; percentile: number }>();
  for (const url of epssUrls(deps.epssUrl, [...cves]))
    for (const e of parseEpss(await getJson(deps, url))) scores.set(e.cve, e);
  await inSystem(pool, async (c) => {
    for (const cve of cves) {
      const k = kev.get(cve);
      const e = scores.get(cve);
      if (k) result.kev++;
      if (e) result.epss++;
      await c.query(
        `INSERT INTO cve_facts (cve, epss, epss_percentile, kev, kev_added, kev_due, ransomware, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (cve) DO UPDATE SET epss = coalesce($2, cve_facts.epss), epss_percentile = coalesce($3, cve_facts.epss_percentile),
           kev = $4, kev_added = $5, kev_due = $6, ransomware = $7, updated_at = now()`,
        [
          cve,
          e?.epss ?? null,
          e?.percentile ?? null,
          Boolean(k),
          k?.added || null,
          k?.due || null,
          k?.ransomware ?? false,
        ],
      );
    }
  });
  for (const ws of workspaceIds)
    result.findings += await inWorkspace(pool, ws, async (c) => {
      const changed = (
        await c.query<{ project_id: string }>(
          `UPDATE findings f SET epss = coalesce(x.epss, f.epss), kev = x.kev
             FROM cve_facts x
            WHERE upper(f.cve) = x.cve AND (f.epss IS DISTINCT FROM coalesce(x.epss, f.epss) OR f.kev <> x.kev)
            RETURNING f.project_id`,
        )
      ).rows;
      for (const p of new Set(changed.map((r) => r.project_id))) await refreshFindings(c, p);
      return changed.length;
    });
  return result;
}

/** Whether the daily refresh is due: never ran, or a day ago. */
export async function feedsDue(pool: Pool, now: Date): Promise<boolean> {
  const last = await inSystem(
    pool,
    async (c) =>
      (await c.query<{ at: Date | null }>('SELECT max(updated_at) AS at FROM cve_facts')).rows[0]
        ?.at,
  );
  return !last || now.getTime() - last.getTime() >= FEED_EVERY_MS;
}
