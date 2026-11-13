// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
// ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
// ── [PCODE-249 | S15 | v0.1.0] T25.4 Alerts and reminders: budgets, anomalies, doc watchers, stale flags and ideas ──
//    Why:  the settings people made now speak up, every few minutes, from the worker that already delivers
//          notices. A budget warns at its percentage and again when it is used up, once per period, to the
//          admins, whoever set it and whoever answers for its scope. A day whose AI spend is far above the
//          last two weeks alerts the admins once. The changes to a watched page, gathered while the page is
//          being worked on, become one notice per page and person after a quiet moment. A flag nobody changed
//          for longer than the workspace's setting reminds who made it; an idea that went quiet reminds who
//          filed it; each once, and again only after it moved. Everything goes through noticeNow: the inbox,
//          then phones and mail as each person's rules and quiet hours say.
// ── [PCODE-344 | S15 | v0.1.0] T34.3b Timer idle detection, time reminders, correction reasons for locked weeks ──
import { budgetStep, exposureText, spendAnomalies, usdMicrosToCents } from '@orqiva/shared';
import { timeReminders } from '../api/timealerts.js'; // [PCODE-344 | S15 | v0.1.0]
import type { Pool, PoolClient } from 'pg';
import { usedMicros, type BudgetRow } from '../api/costs.js';
import { inSystem, inWorkspace } from '../db/pool.js';
import { rateNow } from '../lib/money.js';
import { noticeNow, type PushDeps } from './dispatch.js';
import { recurRound } from '../api/flow.js'; // [PCODE-254 | S15 | v0.1.0]
import { slaRound } from '../api/details.js'; // [PCODE-255 | S15 | v0.1.0]
// [PCODE-322 | S15 | v0.1.0]
import {
  DEFAULT_FEEDS,
  feedWorkspaces,
  feedsDue,
  refreshFeeds,
  type FeedDeps,
} from '../security/feeds.js';
import { fxDue, refreshFx, type FxDeps } from '../lib/fx.js'; // [PCODE-327 | S15 | v0.1.0]

/** a watched page's changes wait this long after the last one */
export const WATCH_QUIET_MS = 2 * 60_000;
/** but a page worked on for long still tells its watchers this often */
export const WATCH_MAX_WAIT_MS = 15 * 60_000;
/** an unusual day must cost at least this much to alert (euro cents) */
export const ANOMALY_MIN_CENTS = 100;

type Kind = 'budget' | 'watch' | 'reminder' | 'security'; // [PCODE-322 | S15 | v0.1.0]
interface Alert {
  kind: Kind;
  userIds: string[];
  title: string;
  body: string;
  url: string;
  tag: string;
  object: { type: string; id: string };
  priority: 'urgent' | 'high' | 'normal';
  projectId: string | null;
}

export interface AlertCounts {
  budgets: number;
  anomalies: number;
  watch: number;
  reminders: number;
  /** [PCODE-254 | S15 | v0.1.0] tasks made by repeating templates */
  recurring: number;
  /** [PCODE-255 | S15 | v0.1.0] bugs past their fix time */
  slas: number;
  /** [PCODE-322 | S15 | v0.1.0] CVEs found in shipped versions, or found exploited */
  cves: number;
}

const eur = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',') + ' €';
const unique = (ids: (string | null | undefined)[]): string[] => [
  ...new Set(ids.filter((x): x is string => Boolean(x))),
];

async function admins(c: PoolClient): Promise<string[]> {
  return (
    await c.query<{ user_id: string }>(
      "SELECT user_id FROM workspace_members WHERE role IN ('owner', 'admin') AND suspended_at IS NULL",
    )
  ).rows.map((r) => r.user_id);
}

async function setting(c: PoolClient, ws: string, key: string, fallback: number): Promise<number> {
  const v = (
    await c.query<{ value: unknown }>(
      "SELECT value FROM settings WHERE workspace_id = $1 AND scope_type = 'workspace' AND key = $2",
      [ws, key],
    )
  ).rows[0]?.value;
  return typeof v === 'number' && v > 0 ? v : fallback;
}

const periodKey = (period: string, now: Date): string =>
  period === 'day'
    ? now.toISOString().slice(0, 10)
    : period === 'month'
      ? now.toISOString().slice(0, 7)
      : 'total';
const periodText = (period: string): string =>
  period === 'day' ? 'today' : period === 'month' ? 'this month' : 'in total';

/** Budgets at their warning or used up, once per period and level. */
async function budgetAlerts(c: PoolClient, ws: string, now: Date): Promise<Alert[]> {
  const list = (
    await c.query<
      BudgetRow & { created_by: string | null; name: string | null; owner: string | null }
    >(
      `SELECT b.*, NULL AS label,
              CASE b.scope_type WHEN 'project' THEN (SELECT key FROM projects WHERE id = b.scope_id)
                                WHEN 'agent' THEN (SELECT name FROM agents WHERE id = b.scope_id)
                                WHEN 'client' THEN (SELECT name FROM clients WHERE id = b.scope_id) END AS name,
              CASE b.scope_type WHEN 'agent' THEN (SELECT owner_id FROM agents WHERE id = b.scope_id)::text END AS owner
         FROM budgets b
        WHERE b.measure IN ('ai', 'total') AND b.period IN ('day', 'month', 'total')`,
    )
  ).rows;
  if (!list.length) return [];
  const rate = (await rateNow(c)).usdEur;
  const out: Alert[] = [];
  const team = await admins(c);
  for (const b of list) {
    const used = usdMicrosToCents(await usedMicros(c, b), rate);
    const amount = Number(b.amount_cents);
    const pct = Math.floor((used * 100) / amount);
    const level = budgetStep(pct, b.warn_pct); // [PCODE-351 | S15 | v0.1.0] half, the warning level, full
    if (!level) continue;
    const sent = await c.query(
      `INSERT INTO budget_alerts (workspace_id, budget_id, period_key, level, percent) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [ws, b.id, periodKey(b.period, now), level, pct],
    );
    if (!sent.rowCount) continue;
    // the project's leads answer for a project's budget
    const leads =
      b.scope_type === 'project'
        ? (
            await c.query<{ user_id: string }>(
              "SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'lead'",
              [b.scope_id],
            )
          ).rows.map((r) => r.user_id)
        : [];
    const scope = b.scope_type === 'workspace' ? 'the workspace' : (b.name ?? b.scope_type);
    out.push({
      kind: 'budget',
      userIds: unique([...team, b.created_by, b.owner, ...leads]),
      title:
        (level === 'full' ? 'Budget used up: ' : 'Budget at ' + String(pct) + ' %: ') +
        scope +
        ', ' +
        periodText(b.period),
      body:
        eur(used) +
        ' of ' +
        eur(amount) +
        ' spent on AI ' +
        periodText(b.period) +
        '.' +
        (b.hard_stop
          ? level === 'full'
            ? ' Agent runs in its scope stop until the budget grows or the period ends.'
            : ' Agent runs stop at 100 %.'
          : ''),
      url: '/tokens',
      tag: 'budget-' + b.id,
      object: { type: 'budget', id: b.id },
      priority: level === 'full' ? 'high' : 'normal',
      projectId: b.scope_type === 'project' ? b.scope_id : null,
    });
  }
  return out;
}

/** Today's AI spend far above the last two weeks: once a day. */
async function anomalyAlerts(c: PoolClient, ws: string): Promise<Alert[]> {
  const days = (
    await c.query<{ day: string; micros: string }>(
      `SELECT d::date::text AS day, coalesce(sum(r.cost_micros), 0) AS micros
         FROM generate_series(current_date - 13, current_date, interval '1 day') d
         LEFT JOIN agent_runs r ON r.created_at::date = d::date
        GROUP BY d ORDER BY d`,
    )
  ).rows;
  const rate = (await rateNow(c)).usdEur;
  const cents = days.map((d) => usdMicrosToCents(Number(d.micros), rate));
  const today = cents.length - 1;
  const todayCents = cents[today] ?? 0;
  if (todayCents < ANOMALY_MIN_CENTS || !spendAnomalies(cents).includes(today)) return [];
  const day = days[today]?.day ?? '';
  const sent = await c.query(
    'INSERT INTO spend_alerts (workspace_id, day, cents) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [ws, day, todayCents],
  );
  if (!sent.rowCount) return [];
  const others = cents.slice(0, today).filter((x) => x > 0);
  const avg = Math.round(others.reduce((a, b) => a + b, 0) / Math.max(1, others.length));
  const top = (
    await c.query<{ name: string; micros: string }>(
      `SELECT a.name, sum(r.cost_micros) AS micros FROM agent_runs r JOIN agents a ON a.id = r.agent_id
        WHERE r.created_at::date = current_date GROUP BY a.name ORDER BY sum(r.cost_micros) DESC LIMIT 1`,
    )
  ).rows[0];
  return [
    {
      kind: 'budget',
      userIds: await admins(c),
      title: 'Unusual AI spend today: ' + eur(todayCents),
      body:
        'The days before averaged ' +
        eur(avg) +
        '.' +
        (top ? ' Most of it: ' + top.name + '.' : '') +
        ' Pause the agents if this is not expected.',
      url: '/tokens',
      tag: 'spend-' + day,
      object: { type: 'spend', id: day },
      priority: 'high',
      projectId: null,
    },
  ];
}

interface WatchChange {
  who: string;
  what: string;
}

/** "Ada edited it 3 times · Bo restored a version" */
export function watchSummary(changes: readonly WatchChange[]): string {
  const counts = new Map<string, number>();
  for (const ch of changes) {
    const k = ch.who + ' ' + ch.what;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => (n > 1 ? k + ' (' + String(n) + ' times)' : k)).join(' · ');
}

/** The gathered changes of watched pages, once each page has been quiet for a moment. */
async function watchAlerts(c: PoolClient, now: Date): Promise<Alert[]> {
  const due = (
    await c.query<{
      page_id: string;
      user_id: string;
      changes: WatchChange[];
      title: string;
      project_id: string;
    }>(
      `DELETE FROM doc_watch_pending w USING doc_pages p
        WHERE p.id = w.page_id AND (w.last_at < $1 OR w.first_at < $2)
        RETURNING w.page_id, w.user_id, w.changes, p.title, p.project_id`,
      [new Date(now.getTime() - WATCH_QUIET_MS), new Date(now.getTime() - WATCH_MAX_WAIT_MS)],
    )
  ).rows;
  return due.map((d) => ({
    kind: 'watch',
    userIds: [d.user_id],
    title: d.title + ' changed',
    body: watchSummary(d.changes) + '.',
    url: '/projects/' + d.project_id + '/documents',
    tag: 'doc-' + d.page_id,
    object: { type: 'doc_page', id: d.page_id },
    priority: 'normal',
    projectId: d.project_id,
  }));
}

/** Flags unchanged and ideas quiet for longer than the workspace's settings, once until they move. */
async function reminders(c: PoolClient, ws: string, now: Date): Promise<Alert[]> {
  const out: Alert[] = [];
  const flagDays = await setting(c, ws, 'flags.stale_days', 30);
  const team = await admins(c);
  const flags = (
    await c.query<{
      id: string;
      key: string;
      project_id: string;
      project_key: string;
      created_by: string | null;
    }>(
      `UPDATE feature_flags f SET reminded_at = $1 FROM projects p
        WHERE p.id = f.project_id AND f.removed_at IS NULL AND f.updated_at < $1::timestamptz - make_interval(days => $2::int)
          AND (f.reminded_at IS NULL OR f.reminded_at < f.updated_at)
        RETURNING f.id, f.key, f.project_id, p.key AS project_key, f.created_by`,
      [now, flagDays],
    )
  ).rows;
  for (const f of flags)
    out.push({
      kind: 'reminder',
      userIds: f.created_by ? [f.created_by] : team,
      title:
        'Flag ' + f.key + ' in ' + f.project_key + ' unchanged for ' + String(flagDays) + ' days',
      body: 'Take it out of the code and remove it here, or change it to keep it on purpose.',
      url: '/projects/' + f.project_id + '/versions',
      tag: 'flag-' + f.id,
      object: { type: 'feature_flag', id: f.id },
      priority: 'normal',
      projectId: f.project_id,
    });
  const ideaDays = await setting(c, ws, 'ideas.stale_days', 14);
  const ideas = (
    await c.query<{
      id: string;
      number: number;
      title: string;
      project_id: string;
      project_key: string;
      created_by: string | null;
    }>(
      `UPDATE ideas i SET reminded_at = $1 FROM projects p
        WHERE p.id = i.project_id AND i.status IN ('new', 'interviewing', 'proposed') AND i.merged_into_id IS NULL
          AND i.last_activity_at < $1::timestamptz - make_interval(days => $2::int)
          AND (i.reminded_at IS NULL OR i.reminded_at < i.last_activity_at)
        RETURNING i.id, i.number, i.title, i.project_id, p.key AS project_key, i.created_by`,
      [now, ideaDays],
    )
  ).rows;
  for (const i of ideas)
    out.push({
      kind: 'reminder',
      userIds: i.created_by ? [i.created_by] : team,
      title: 'Idea ' + i.project_key + ' #' + String(i.number) + ' ' + i.title + ' went quiet',
      body:
        'Nothing happened for ' +
        String(ideaDays) +
        ' days. Decide it, answer its open questions, or decline it.',
      url: '/ideas/' + i.id,
      tag: 'idea-' + i.id,
      object: { type: 'idea', id: i.id },
      priority: 'normal',
      projectId: i.project_id,
    });
  // [PCODE-344 | S15 | v0.1.0] time not booked today, a week not submitted on Friday
  for (const r of await timeReminders(c, ws, now))
    out.push({
      kind: 'reminder',
      userIds: [r.userId],
      title: r.title,
      body: r.body,
      url: '/time',
      tag: 'time-' + r.kind + '-' + r.key,
      object: { type: 'timesheet', id: r.userId },
      priority: 'normal',
      projectId: null,
    });
  return out;
}

// [PCODE-322 | S15 | v0.1.0] a CVE in a version that shipped: the project's leads and the admins hear of it
// once, and once more when it is found exploited
async function cveAlerts(c: PoolClient): Promise<Alert[]> {
  const team = await admins(c);
  const rows = (
    await c.query<{
      id: string;
      project_id: string;
      project_key: string;
      cve: string;
      package: string;
      package_version: string;
      kev: boolean;
      first: boolean;
      releases: { version: string; environment: string | null }[];
      leads: string[];
    }>(
      `SELECT f.id, f.project_id, p.key AS project_key, f.cve, f.package, f.package_version, f.kev,
              f.shipped_alerted_at IS NULL AS first, x.releases,
              coalesce((SELECT array_agg(pm.user_id) FROM project_members pm WHERE pm.project_id = f.project_id AND pm.role = 'lead'), '{}') AS leads
         FROM findings f JOIN projects p ON p.id = f.project_id
         CROSS JOIN LATERAL (
           SELECT jsonb_agg(DISTINCT jsonb_build_object('version', r.version, 'environment', e.name)) AS releases
             FROM sboms b JOIN releases r ON r.id = b.release_id LEFT JOIN environments e ON e.id = r.environment_id,
                  jsonb_array_elements(b.components) comp
            WHERE b.project_id = f.project_id AND r.state = 'released'
              AND lower(comp->>'name') = lower(f.package) AND comp->>'version' = f.package_version) x
        WHERE f.status = 'open' AND f.cve <> '' AND f.package <> '' AND f.package_version <> ''
          AND x.releases IS NOT NULL
          AND (f.shipped_alerted_at IS NULL OR (f.kev AND f.kev_alerted_at IS NULL))`,
    )
  ).rows;
  const out: Alert[] = [];
  for (const r of rows) {
    const exploited = r.kev && !r.first;
    await c.query(
      'UPDATE findings SET shipped_alerted_at = coalesce(shipped_alerted_at, now()), kev_alerted_at = CASE WHEN kev THEN now() ELSE kev_alerted_at END WHERE id = $1',
      [r.id],
    );
    out.push({
      kind: 'security',
      userIds: [...new Set([...r.leads, ...team])],
      title:
        (exploited ? 'Exploited: ' : '') +
        r.cve +
        ' in ' +
        r.package +
        ' ' +
        r.package_version +
        ' is in a shipped version of ' +
        r.project_key,
      body: exposureText(r.cve, r.package, r.package_version, r.releases, r.kev),
      url: '/projects/' + r.project_id + '/security',
      tag: 'cve-' + r.id + (exploited ? '-kev' : ''),
      object: { type: 'finding', id: r.id },
      priority: r.kev ? 'urgent' : 'high',
      projectId: r.project_id,
    });
  }
  return out;
}

let feedTriedAt = 0;
let fxTriedAt = 0; // [PCODE-327 | S15 | v0.1.0]

/** One round over every workspace: find what is due, mark it sent, then tell people. */
export async function alertRound(
  pool: Pool,
  deps: PushDeps & {
    subject: string;
    feeds?: FeedDeps;
    // [PCODE-327 | S15 | v0.1.0] the ECB's daily rate; left out, no rate is fetched (tests)
    fx?: FxDeps;
    log?: (msg: string, data?: Record<string, unknown>) => void;
  },
  now: Date = new Date(),
): Promise<AlertCounts> {
  const counts: AlertCounts = {
    budgets: 0,
    anomalies: 0,
    watch: 0,
    reminders: 0,
    recurring: 0,
    slas: 0,
    cves: 0,
  };
  counts.recurring = await recurRound(pool, now);
  // [PCODE-322 | S15 | v0.1.0] the vulnerability feeds, once a day, for the workspaces that want them;
  // a failed try waits an hour
  if (now.getTime() - feedTriedAt >= 3600_000 && (await feedsDue(pool, now))) {
    const on = await feedWorkspaces(pool);
    if (on.length) {
      feedTriedAt = now.getTime();
      await refreshFeeds(pool, deps.feeds ?? DEFAULT_FEEDS, on).catch((e: unknown) => {
        deps.log?.('vulnerability feeds failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }
  }
  // [PCODE-327 | S15 | v0.1.0] the day's euro rate, once per working day; a failed try waits an hour
  if (deps.fx && now.getTime() - fxTriedAt >= 3600_000 && (await fxDue(pool, now))) {
    fxTriedAt = now.getTime();
    await refreshFx(pool, deps.fx).catch((e: unknown) => {
      deps.log?.('exchange rate failed', { error: e instanceof Error ? e.message : String(e) });
    });
  }
  // [PCODE-255 | S15 | v0.1.0] a bug past its fix time tells its assignee, else the admins
  for (const w of await slaRound(pool, now))
    for (const b of w.alerts) {
      counts.slas++;
      await noticeNow(
        pool,
        w.workspaceId,
        {
          inboxKind: 'reminder',
          userIds: b.userIds,
          title: b.title,
          body: b.body,
          url: '/items/' + b.itemId,
          tag: 'sla-' + b.itemId,
          object: { type: 'item', id: b.itemId },
          priority: 'high',
          projectId: b.projectId,
        },
        deps,
        () => now,
      );
    }
  const spaces = await inSystem(pool, async (c) =>
    (await c.query<{ id: string }>('SELECT id FROM workspaces')).rows.map((r) => r.id),
  );
  for (const ws of spaces) {
    const found = await inWorkspace(pool, ws, async (c) => {
      const b = await budgetAlerts(c, ws, now);
      const a = await anomalyAlerts(c, ws);
      const w = await watchAlerts(c, now);
      const r = await reminders(c, ws, now);
      const v = await cveAlerts(c); // [PCODE-322 | S15 | v0.1.0]
      counts.budgets += b.length;
      counts.anomalies += a.length;
      counts.watch += w.length;
      counts.reminders += r.length;
      counts.cves += v.length;
      return [...b, ...a, ...w, ...r, ...v];
    });
    for (const n of found)
      await noticeNow(
        pool,
        ws,
        {
          inboxKind: n.kind,
          userIds: n.userIds,
          title: n.title,
          body: n.body,
          url: n.url,
          tag: n.tag,
          object: n.object,
          priority: n.priority,
          projectId: n.projectId,
        },
        deps,
        () => now,
      );
  }
  return counts;
}
