// ── [PCODE-429 | S15 | v0.1.0] T37 low: A very short timer says why it booked nothing ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
// ── [PCODE-187 | S15 | v0.1.0] B7.3 Time live: timer from the active task, weekly timesheets with approval and lock, rates, absences, reports per client ──
//    Why:  Time as people use it: a timer on the task they work on (or their IDE session, which the
//          database turns into time when it ends), a week to correct and submit, a manager who approves
//          and locks it (the rates of that moment are kept), absences that are visible to the team and
//          reduce capacity, and a monthly report per client with people and AI cost against the budget.
//          A forgotten timer stops at 19:00 of the day it started and says so.
// ── [PCODE-343 | S15 | v0.1.0] T34.3a Hour budgets with alerts, time reports by person, sprint and task, DATEV export ──
// ── [PCODE-344 | S15 | v0.1.0] T34.3b Timer idle detection, time reminders, correction reasons for locked weeks ──
import {
  absenceWorkdays,
  autoStopAt,
  daysOf,
  isoWeek,
  localDay,
  pickRate,
  toCsv,
  usdMicrosToCents,
  weekOf,
  type RateRow,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js'; // [PCODE-344 | S15 | v0.1.0]
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { rateNow } from '../lib/money.js';
import { actorOf, asMember, requireProject, type Access } from './access.js';
import { checkHourBudgets } from './timereports.js'; // [PCODE-343 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = s.string({ pattern: DAY_RE });
const isAdmin = (a: Access): boolean => a.role === 'admin' || a.role === 'owner';
const mayReport = (a: Access): boolean =>
  isAdmin(a) || a.role === 'billing' || a.role === 'auditor';

function teamOnly(a: Access): void {
  if (a.role === 'guest' || a.role === 'auditor' || a.role === 'billing')
    throw new HttpError(403, 'forbidden', 'Time is kept by the team');
}

/** The manager in a person's profile; admins approve for everyone. */
async function managerOf(c: PoolClient, userId: string): Promise<string | null> {
  return (
    (
      await c.query<{ manager_id: string | null }>(
        'SELECT manager_id FROM member_profiles WHERE user_id = $1',
        [userId],
      )
    ).rows[0]?.manager_id ?? null
  );
}

/** The only admin of a workspace has no one to ask: they approve their own week and time off. */
async function soleAdmin(c: PoolClient, a: Access): Promise<boolean> {
  if (!isAdmin(a)) return false;
  const n = (
    await c.query<{ n: string }>(
      "SELECT count(*) AS n FROM workspace_members WHERE role IN ('admin', 'owner') AND suspended_at IS NULL",
    )
  ).rows[0]?.n;
  return Number(n ?? 0) <= 1;
}

async function mayApproveFor(c: PoolClient, a: Access, userId: string): Promise<boolean> {
  if (userId === a.user.id) return soleAdmin(c, a);
  if (isAdmin(a)) return true;
  return (await managerOf(c, userId)) === a.user.id && userId !== a.user.id;
}

/** Whose time a request is about: one's own, or someone one approves for. */
async function whose(c: PoolClient, a: Access, userId: string | undefined): Promise<string> {
  const id = userId ?? a.user.id;
  if (id !== a.user.id && !(await mayApproveFor(c, a, id)))
    throw new HttpError(403, 'forbidden', 'Only their manager or an admin sees someone’s time');
  return id;
}

async function sheetState(c: PoolClient, userId: string, d: string): Promise<string> {
  return (
    (
      await c.query<{ state: string }>(
        'SELECT state FROM timesheets WHERE user_id = $1 AND week = $2',
        [userId, weekOf(d)],
      )
    ).rows[0]?.state ?? 'open'
  );
}

async function requireOpen(c: PoolClient, userId: string, d: string): Promise<void> {
  const st = await sheetState(c, userId, d);
  if (st === 'submitted' || st === 'approved')
    throw new HttpError(
      409,
      'conflict',
      // [PCODE-344 | S15 | v0.1.0] or correct it with a reason
      st === 'approved'
        ? 'This week is approved and locked; give a reason to correct it'
        : 'This week is submitted; ask for it back, or give a reason to correct it',
    );
}

interface Running {
  id: string;
  user_id: string;
  started_at: Date;
  idle_minutes: number; // [PCODE-344 | S15 | v0.1.0]
}

/** Ends a running timer at `end` (a forgotten one at 19:00 of its day). */
async function finishTimer(c: PoolClient, t: Running, now: Date): Promise<void> {
  const stopAt = autoStopAt(t.started_at);
  const end = stopAt < now ? stopAt : now;
  const minutes = Math.min(
    1440,
    Math.max(0, Math.ceil((end.getTime() - t.started_at.getTime()) / 60_000) - t.idle_minutes), // [PCODE-344 | S15 | v0.1.0]
  );
  const st = await sheetState(c, t.user_id, localDay(t.started_at));
  await c.query(
    `UPDATE time_entries SET ended_at = $2, minutes = $3, auto_stopped = $4, after_lock = $5, updated_at = now()
      WHERE id = $1`,
    [t.id, end, minutes, stopAt < now, st === 'submitted' || st === 'approved'],
  );
}

async function runningOf(c: PoolClient, userId: string): Promise<Running | undefined> {
  return (
    await c.query<Running>(
      'SELECT id, user_id, started_at, idle_minutes FROM time_entries WHERE user_id = $1 AND started_at IS NOT NULL AND ended_at IS NULL',
      [userId],
    )
  ).rows[0];
}

/** A timer forgotten overnight stops by itself the next time anyone looks. */
async function stopStale(c: PoolClient, userId: string): Promise<void> {
  const t = await runningOf(c, userId);
  const now = new Date();
  if (t && autoStopAt(t.started_at) < now) await finishTimer(c, t, now);
}

async function itemInfo(
  c: PoolClient,
  a: Access,
  itemId: string,
): Promise<{ projectId: string; billable: boolean }> {
  const it = (
    await c.query<{ project_id: string; client_id: string | null }>(
      'SELECT i.project_id, p.client_id FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = $1',
      [itemId],
    )
  ).rows[0];
  if (!it) throw new HttpError(404, 'not_found', 'Task not found');
  await requireProject(c, a, it.project_id);
  return { projectId: it.project_id, billable: it.client_id !== null };
}

async function loadRates(c: PoolClient): Promise<RateRow[]> {
  return (
    await c.query<{
      scope_type: RateRow['scopeType'];
      scope_key: string;
      kind: RateRow['kind'];
      cents_per_hour: string;
      valid_from: string;
    }>(
      'SELECT scope_type, scope_key, kind, cents_per_hour, valid_from::text AS valid_from FROM rates',
    )
  ).rows.map((r) => ({
    scopeType: r.scope_type,
    scopeKey: r.scope_key,
    kind: r.kind,
    centsPerHour: Number(r.cents_per_hour),
    validFrom: r.valid_from,
  }));
}

interface EntryRow {
  id: string;
  item_id: string | null;
  item_ref: string | null;
  item_title: string | null;
  project_id: string | null;
  project_key: string | null;
  client_name: string | null;
  label: string;
  day: string;
  minutes: number;
  billable: boolean;
  source: string;
  started_at: Date | null;
  ended_at: Date | null;
  auto_stopped: boolean;
  after_lock: boolean;
  idle_minutes: number; // [PCODE-344 | S15 | v0.1.0]
  note: string;
}

const ENTRY_SELECT = `SELECT e.id, e.item_id, p.key || '-' || i.sequence AS item_ref, i.title AS item_title,
    e.project_id, p.key AS project_key, cl.name AS client_name, e.label, e.day::text AS day, e.minutes, e.billable,
    e.source, e.started_at, e.ended_at, e.auto_stopped, e.after_lock, e.note, e.idle_minutes
  FROM time_entries e LEFT JOIN items i ON i.id = e.item_id LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN clients cl ON cl.id = p.client_id`;

const rowKey = (e: { item_id: string | null; project_id: string | null; label: string }): string =>
  e.item_id ?? (e.project_id ?? '') + '|' + e.label;

/** [PCODE-189 | S15 | v0.1.0] One entry of a month, with its rate and amount. */
export interface PricedEntry {
  user_id: string;
  user_name: string;
  role: string;
  day: string;
  minutes: number;
  billable: boolean;
  rate_cents: string | null;
  project_id: string | null;
  project_key: string | null;
  client_id: string | null;
  client_name: string | null;
  item_ref: string | null;
  title: string | null;
  label: string;
  approved: boolean;
  rate: number | null;
  cents: number;
}

export interface MonthReport {
  month: string;
  from: string;
  to: string;
  priced: PricedEntry[];
  body: {
    month: string;
    minutes: number;
    billableMinutes: number;
    toInvoiceCents: number;
    unapprovedMinutes: number;
    agentMinutes: number;
    agentCents: number;
    unpriced: number;
    clients: {
      clientId: string | null;
      name: string;
      minutes: number;
      billableMinutes: number;
      rateCents: number | null;
      peopleCents: number;
      aiCents: number;
      totalCents: number;
      budgetCents: number | null;
      usedCents: number;
    }[];
  };
}

/** [PCODE-189 | S15 | v0.1.0] A month of time per client, priced: the report, its CSV and invoices use it. */
/** [PCODE-343 | S15 | v0.1.0] The time entries of a period with their billable rate and amount, sprint and task. */
export interface ReportRow {
  user_id: string;
  user_name: string;
  role: string;
  day: string;
  minutes: number;
  billable: boolean;
  rate_cents: string | null;
  project_id: string | null;
  project_key: string | null;
  client_id: string | null;
  client_name: string | null;
  item_id: string | null;
  item_ref: string | null;
  title: string | null;
  sprint_id: string | null;
  sprint_name: string | null;
  label: string;
  approved: boolean;
}
export type ReportEntry = ReportRow & { rate: number | null; cents: number };

export async function pricedEntries(
  c: PoolClient,
  from: string,
  to: string,
): Promise<ReportEntry[]> {
  const rates = await loadRates(c);
  const entries = (
    await c.query<ReportRow>(
      `SELECT e.user_id, u.name AS user_name, coalesce(m.role, 'member') AS role, e.day::text AS day, e.minutes, e.billable,
          e.rate_cents, e.project_id, p.key AS project_key, p.client_id, cl.name AS client_name,
          e.item_id, p.key || '-' || i.sequence AS item_ref, i.title, i.sprint_id, sp.name AS sprint_name, e.label,
          EXISTS (SELECT 1 FROM timesheets s WHERE s.user_id = e.user_id AND s.state = 'approved'
            AND s.week = e.day - (extract(isodow FROM e.day)::integer - 1)) AS approved
         FROM time_entries e JOIN users u ON u.id = e.user_id LEFT JOIN workspace_members m ON m.user_id = e.user_id
         LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN clients cl ON cl.id = p.client_id
         LEFT JOIN items i ON i.id = e.item_id LEFT JOIN sprints sp ON sp.id = i.sprint_id
        WHERE e.day >= $1 AND e.day < $2 AND e.minutes > 0
        ORDER BY e.day, u.name`,
      [from, to],
    )
  ).rows;
  return entries.map((e) => {
    const rate =
      e.rate_cents !== null
        ? Number(e.rate_cents)
        : pickRate(
            rates,
            { userId: e.user_id, role: e.role, clientId: e.client_id, projectId: e.project_id },
            'billable',
            e.day,
          );
    return {
      ...e,
      rate,
      cents: e.billable && rate !== null ? Math.round((e.minutes * rate) / 60) : 0,
    };
  });
}

export async function monthReport(c: PoolClient, month: string): Promise<MonthReport> {
  const from = month + '-01';
  const toD = new Date(from + 'T00:00:00Z');
  toD.setUTCMonth(toD.getUTCMonth() + 1);
  const to = toD.toISOString().slice(0, 10);
  const priced = await pricedEntries(c, from, to); // [PCODE-343 | S15 | v0.1.0]
  const fx = await rateNow(c);
  const ai = (
    await c.query<{ client_id: string | null; micros: string; seconds: string }>(
      `SELECT p.client_id, coalesce(sum(r.cost_micros), 0) AS micros,
          coalesce(sum(extract(epoch FROM (r.finished_at - r.started_at))), 0) AS seconds
         FROM agent_runs r LEFT JOIN projects p ON p.id = r.project_id
        WHERE r.created_at >= $1 AND r.created_at < $2 GROUP BY p.client_id`,
      [from, to],
    )
  ).rows;
  const budgets = (
    await c.query<{ scope_id: string; amount_cents: string }>(
      "SELECT scope_id, amount_cents FROM budgets WHERE scope_type = 'client' AND measure IN ('total', 'time') AND period IN ('total', 'month')",
    )
  ).rows;
  const spentBefore = (
    await c.query<{ client_id: string; cents: string }>(
      `SELECT p.client_id, coalesce(sum(e.minutes * e.rate_cents / 60), 0) AS cents
         FROM time_entries e JOIN projects p ON p.id = e.project_id
        WHERE p.client_id IS NOT NULL AND e.billable AND e.day < $1 GROUP BY p.client_id`,
      [from],
    )
  ).rows;
  const clientIds = [...new Set(priced.map((e) => e.client_id))];
  for (const x of ai) if (!clientIds.includes(x.client_id)) clientIds.push(x.client_id);
  const clients = clientIds
    .map((id) => {
      const mine = priced.filter((e) => e.client_id === id);
      const minutes = mine.reduce((n, e) => n + e.minutes, 0);
      const billableMinutes = mine.filter((e) => e.billable).reduce((n, e) => n + e.minutes, 0);
      const peopleCents = mine.reduce((n, e) => n + e.cents, 0);
      const aiRow = ai.find((x) => x.client_id === id);
      const aiCents = usdMicrosToCents(Number(aiRow?.micros ?? 0), fx.usdEur);
      const budget = id ? budgets.find((b) => b.scope_id === id) : undefined;
      const before = Number(spentBefore.find((x) => x.client_id === id)?.cents ?? 0);
      return {
        clientId: id,
        name: id ? (mine[0]?.client_name ?? 'Client') : 'Internal',
        minutes,
        billableMinutes,
        rateCents: billableMinutes ? Math.round((peopleCents * 60) / billableMinutes) : null,
        peopleCents,
        aiCents: id ? aiCents : 0,
        totalCents: peopleCents + (id ? aiCents : 0),
        budgetCents: budget ? Number(budget.amount_cents) : null,
        usedCents: before + peopleCents + (id ? aiCents : 0),
      };
    })
    .sort((x, y) =>
      x.clientId === null ? 1 : y.clientId === null ? -1 : y.totalCents - x.totalCents,
    );
  const allMinutes = priced.reduce((n, e) => n + e.minutes, 0);
  const billableAll = priced.filter((e) => e.billable).reduce((n, e) => n + e.minutes, 0);
  return {
    month,
    from,
    to,
    priced,
    body: {
      month,
      minutes: allMinutes,
      billableMinutes: billableAll,
      toInvoiceCents: clients.filter((x) => x.clientId).reduce((n, x) => n + x.totalCents, 0),
      unapprovedMinutes: priced.filter((e) => !e.approved).reduce((n, e) => n + e.minutes, 0),
      agentMinutes: Math.round(ai.reduce((n, x) => n + Number(x.seconds), 0) / 60),
      agentCents: usdMicrosToCents(
        ai.reduce((n, x) => n + Number(x.micros), 0),
        fx.usdEur,
      ),
      unpriced: priced.filter((e) => e.billable && e.rate === null).length,
      clients,
    },
  };
}

export function timeRoutes(pool: Pool): Route[] {
  const week = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/time/week',
    summary: 'A person’s week: hours per task and day, the timer, absences, the sheet’s state',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ week: s.optional(day), userId: s.optional(uuid) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const userId = await whose(c, a, query.userId);
        await stopStale(c, userId);
        const monday = weekOf(query.week ?? localDay(new Date()));
        const days = daysOf(monday);
        const entries = (
          await c.query<EntryRow>(
            ENTRY_SELECT +
              ' WHERE e.user_id = $1 AND e.day BETWEEN $2 AND $3 ORDER BY e.created_at',
            [userId, days[0], days[6]],
          )
        ).rows;
        const timerRow = (
          await c.query<EntryRow>(
            ENTRY_SELECT +
              ' WHERE e.user_id = $1 AND e.started_at IS NOT NULL AND e.ended_at IS NULL',
            [userId],
          )
        ).rows[0];
        const rows = new Map<
          string,
          {
            key: string;
            itemId: string | null;
            itemRef: string | null;
            title: string;
            projectId: string | null;
            projectKey: string | null;
            clientName: string | null;
            label: string;
            billable: boolean;
            minutes: number[];
            sources: string[];
          }
        >();
        const flags: { day: string; text: string }[] = [];
        for (const e of entries) {
          if (e.started_at && !e.ended_at) continue;
          const k = rowKey(e);
          const r = rows.get(k) ?? {
            key: k,
            itemId: e.item_id,
            itemRef: e.item_ref,
            title: e.item_title ?? (e.label || e.project_key || 'Time'),
            projectId: e.project_id,
            projectKey: e.project_key,
            clientName: e.client_name,
            label: e.label,
            billable: e.billable,
            minutes: [0, 0, 0, 0, 0, 0, 0],
            sources: [],
          };
          const i = days.indexOf(e.day);
          if (i >= 0) r.minutes[i] = (r.minutes[i] ?? 0) + e.minutes;
          if (!r.sources.includes(e.source)) r.sources.push(e.source);
          rows.set(k, r);
          if (e.auto_stopped)
            flags.push({
              day: e.day,
              text: 'A timer ran until 19:00 and was stopped: keep the time?',
            });
          if (e.after_lock)
            flags.push({
              day: e.day,
              text: 'Time from the IDE arrived after the week was submitted',
            });
        }
        const perDay = days.map((_, i) =>
          [...rows.values()].reduce((n, r) => n + (r.minutes[i] ?? 0), 0),
        );
        const absences = (
          await c.query<{
            id: string;
            starts_on: string;
            ends_on: string;
            half_day: boolean;
            kind: string;
            state: string;
          }>(
            `SELECT id, starts_on::text AS starts_on, ends_on::text AS ends_on, half_day, kind, state FROM absences
              WHERE user_id = $1 AND state <> 'declined' AND starts_on <= $3 AND ends_on >= $2 ORDER BY starts_on`,
            [userId, days[0], days[6]],
          )
        ).rows;
        days.forEach((d, i) => {
          if ((perDay[i] ?? 0) > 600) flags.push({ day: d, text: 'More than 10 hours on one day' });
          if (
            (perDay[i] ?? 0) > 0 &&
            absences.some(
              (x) => x.state === 'approved' && !x.half_day && d >= x.starts_on && d <= x.ends_on,
            )
          )
            flags.push({ day: d, text: 'Hours booked on a day off' });
        });
        const sheet = (
          await c.query<{
            state: string;
            note: string;
            decided_at: Date | null;
            decider: string | null;
          }>(
            `SELECT s.state, s.note, s.decided_at, u.name AS decider FROM timesheets s LEFT JOIN users u ON u.id = s.decided_by
              WHERE s.user_id = $1 AND s.week = $2`,
            [userId, monday],
          )
        ).rows[0];
        const person = (
          await c.query<{ name: string; capacity: string | null; manager: string | null }>(
            `SELECT u.name, mp.capacity_hours_week AS capacity, m.name AS manager FROM users u
               LEFT JOIN member_profiles mp ON mp.user_id = u.id LEFT JOIN users m ON m.id = mp.manager_id
              WHERE u.id = $1`,
            [userId],
          )
        ).rows[0];
        const awayDays = absences
          .filter((x) => x.state === 'approved')
          .reduce(
            (n, x) =>
              n +
              absenceWorkdays(
                { startsOn: x.starts_on, endsOn: x.ends_on, halfDay: x.half_day },
                days,
              ),
            0,
          );
        const weekly =
          person?.capacity === null || person?.capacity === undefined
            ? 40
            : Number(person.capacity);
        const list = [...rows.values()];
        // [PCODE-344 | S15 | v0.1.0] corrections made after the week was submitted
        const corrections = (
          await c.query<{
            day: string;
            title: string;
            before_minutes: number;
            after_minutes: number;
            reason: string;
            created_at: Date;
          }>(
            `SELECT x.day::text AS day, coalesce(p.key || '-' || i.sequence || ' ' || i.title, nullif(x.label, ''), p.key, 'Time') AS title,
                x.before_minutes, x.after_minutes, x.reason, x.created_at
               FROM time_corrections x LEFT JOIN items i ON i.id = x.item_id LEFT JOIN projects p ON p.id = x.project_id
              WHERE x.user_id = $1 AND x.day BETWEEN $2 AND $3 ORDER BY x.created_at`,
            [userId, days[0], days[6]],
          )
        ).rows.map((x) => ({
          day: x.day,
          title: x.title,
          before: x.before_minutes,
          after: x.after_minutes,
          reason: x.reason,
          at: x.created_at.toISOString(),
        }));
        return {
          body: {
            corrections, // [PCODE-344 | S15 | v0.1.0]
            week: monday,
            weekNo: isoWeek(monday),
            days,
            user: { id: userId, name: person?.name ?? '' },
            approver: person?.manager ?? null,
            state: sheet?.state ?? 'open',
            note: sheet?.note ?? '',
            decidedBy: sheet?.decider ?? null,
            decidedAt: sheet?.decided_at?.toISOString() ?? null,
            timer: timerRow
              ? {
                  id: timerRow.id,
                  itemId: timerRow.item_id,
                  itemRef: timerRow.item_ref,
                  title: timerRow.item_title ?? timerRow.label,
                  clientName: timerRow.client_name,
                  billable: timerRow.billable,
                  startedAt: timerRow.started_at?.toISOString() ?? '',
                  source: timerRow.source,
                  idleMinutes: timerRow.idle_minutes, // [PCODE-344 | S15 | v0.1.0]
                }
              : null,
            rows: list,
            perDay,
            total: perDay.reduce((x, y) => x + y, 0),
            billable: list
              .filter((r) => r.billable)
              .reduce((n, r) => n + r.minutes.reduce((x, y) => x + y, 0), 0),
            capacityMinutes: Math.round((weekly * 60 * Math.max(0, 5 - awayDays)) / 5),
            absences: absences.map((x) => ({
              id: x.id,
              startsOn: x.starts_on,
              endsOn: x.ends_on,
              halfDay: x.half_day,
              kind: x.kind,
              state: x.state,
            })),
            flags,
          },
        };
      }),
  });

  const startTimer = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/time/timer',
    summary: 'Start the timer on a task (or a label); a running one stops first',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      itemId: s.optional(uuid),
      label: s.optional(s.string({ max: 200 })),
      billable: s.optional(s.boolean()),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        if (!body.itemId && !body.label?.trim())
          throw new HttpError(400, 'invalid_request', 'Which task is it for?', [
            { path: 'body.itemId', message: 'a task or a label is required' },
          ]);
        const now = new Date();
        const running = await runningOf(c, a.user.id);
        if (running) await finishTimer(c, running, now);
        const info = body.itemId ? await itemInfo(c, a, body.itemId) : null;
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO time_entries (workspace_id, user_id, item_id, project_id, label, day, billable, source, started_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'timer', $8) RETURNING id`,
            [
              a.workspaceId,
              a.user.id,
              body.itemId ?? null,
              info?.projectId ?? null,
              body.label?.trim() ?? '',
              localDay(now),
              body.billable ?? info?.billable ?? false,
              now,
            ],
          )
        ).rows[0]?.id;
        return { status: 201, body: { id, startedAt: now.toISOString() } };
      }),
  });

  const stopTimer = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/time/timer/stop',
    summary: 'Stop the running timer; its time lands on the day it started',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({}),
    response: s.anyObject(),
    // [PCODE-343 | S15 | v0.1.0] then the hour budgets of its project and client
    handler: async ({ params, req }) => {
      const touched: { project: string | null } = { project: null };
      const out = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const running = await runningOf(c, a.user.id);
        if (!running) throw new HttpError(409, 'conflict', 'No timer is running');
        touched.project =
          (
            await c.query<{ project_id: string | null }>(
              'SELECT project_id FROM time_entries WHERE id = $1',
              [running.id],
            )
          ).rows[0]?.project_id ?? null;
        // [PCODE-429 | S15 | v0.1.0] under a minute is a slip of the finger, not work: nothing is booked
        const now = new Date();
        if (now.getTime() - running.started_at.getTime() < 60_000) {
          await c.query('DELETE FROM time_entries WHERE id = $1', [running.id]);
          touched.project = null;
          return { body: { id: running.id, minutes: 0, dropped: true } };
        }
        await finishTimer(c, running, now);
        const m = (
          await c.query<{ minutes: number }>('SELECT minutes FROM time_entries WHERE id = $1', [
            running.id,
          ])
        ).rows[0];
        return { body: { id: running.id, minutes: m?.minutes ?? 0 } };
      });
      if (touched.project) await checkHourBudgets(pool, params.workspaceId, touched.project);
      return out;
    },
  });

  const cell = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/time/cell',
    summary:
      'Set the hours of one task (or label) on one day; the difference is kept as manual time',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      day,
      minutes: s.number({ integer: true, min: 0, max: 1440 }),
      itemId: s.optional(s.nullable(uuid)),
      projectId: s.optional(s.nullable(uuid)),
      label: s.optional(s.string({ max: 200 })),
      billable: s.optional(s.boolean()),
      note: s.optional(s.string({ max: 2000 })),
      reason: s.optional(s.string({ min: 3, max: 500 })), // [PCODE-344 | S15 | v0.1.0]
    }),
    response: s.anyObject(),
    // [PCODE-343 | S15 | v0.1.0] then the hour budgets of its project and client
    handler: async ({ params, body, req }) => {
      const touched: { project: string | null } = { project: null };
      // [PCODE-344 | S15 | v0.1.0] a correction of a locked week, to tell its approver about afterwards
      const corrected: { text: string; to: string[]; user: string } = {
        text: '',
        to: [],
        user: '',
      };
      const out = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const st = await sheetState(c, a.user.id, body.day);
        const locked = st === 'submitted' || st === 'approved';
        if (!body.reason?.trim()) await requireOpen(c, a.user.id, body.day);
        const label = body.label?.trim() ?? '';
        let projectId = body.projectId ?? null;
        let billable = body.billable;
        if (body.itemId) {
          const info = await itemInfo(c, a, body.itemId);
          projectId = info.projectId;
          billable ??= info.billable;
        } else if (projectId) {
          await requireProject(c, a, projectId);
          billable ??= Boolean(
            (
              await c.query('SELECT 1 FROM projects WHERE id = $1 AND client_id IS NOT NULL', [
                projectId,
              ])
            ).rowCount,
          );
        } else if (!label)
          throw new HttpError(400, 'invalid_request', 'Which task is it for?', [
            { path: 'body.itemId', message: 'a task, a project or a label is required' },
          ]);
        const same = `user_id = $1 AND day = $2 AND item_id IS NOT DISTINCT FROM $3
          AND (item_id IS NOT NULL OR (project_id IS NOT DISTINCT FROM $4 AND label = $5))`;
        const args = [a.user.id, body.day, body.itemId ?? null, projectId, label];
        const before = Number(
          (
            await c.query<{ n: string }>(
              `SELECT coalesce(sum(minutes), 0) AS n FROM time_entries WHERE ${same}`,
              args,
            )
          ).rows[0]?.n ?? 0,
        );
        const tracked = Number(
          (
            await c.query<{ n: string }>(
              `SELECT coalesce(sum(minutes), 0) AS n FROM time_entries WHERE ${same} AND source <> 'manual'`,
              args,
            )
          ).rows[0]?.n ?? 0,
        );
        if (body.minutes < tracked)
          throw new HttpError(
            409,
            'conflict',
            'The timer and the IDE recorded ' +
              String(Math.round((tracked / 60) * 100) / 100).replace('.', ',') +
              ' h here; remove those entries to book less',
          );
        await c.query(`DELETE FROM time_entries WHERE ${same} AND source = 'manual'`, args);
        if (body.minutes > tracked)
          await c.query(
            `INSERT INTO time_entries (workspace_id, user_id, item_id, project_id, label, day, minutes, billable, note, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual')`,
            [
              a.workspaceId,
              a.user.id,
              body.itemId ?? null,
              projectId,
              label,
              body.day,
              body.minutes - tracked,
              billable ?? false,
              body.note ?? '',
            ],
          );
        if (billable !== undefined)
          await c.query(`UPDATE time_entries SET billable = $6 WHERE ${same}`, [...args, billable]);
        touched.project = projectId;
        // [PCODE-344 | S15 | v0.1.0] the correction is kept; an approved week goes back for approval
        if (locked && body.reason && before !== body.minutes) {
          await c.query(
            `INSERT INTO time_corrections (workspace_id, user_id, day, item_id, project_id, label, before_minutes, after_minutes, reason, sheet_state)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              a.workspaceId,
              a.user.id,
              body.day,
              body.itemId ?? null,
              projectId,
              label,
              before,
              body.minutes,
              body.reason.trim(),
              st,
            ],
          );
          if (st === 'approved')
            await c.query(
              "UPDATE timesheets SET state = 'submitted', submitted_at = now() WHERE user_id = $1 AND week = $2",
              [a.user.id, weekOf(body.day)],
            );
          const manager = await managerOf(c, a.user.id);
          const admins = (
            await c.query<{ user_id: string }>(
              "SELECT user_id FROM workspace_members WHERE role IN ('admin', 'owner') AND suspended_at IS NULL",
            )
          ).rows.map((r) => r.user_id);
          const h = (m: number): string =>
            String(Math.round((m / 60) * 100) / 100).replace('.', ',');
          corrected.to = (manager ? [manager] : admins).filter((u) => u !== a.user.id);
          corrected.user = a.user.id;
          corrected.text =
            a.user.name +
            ' corrected ' +
            body.day.slice(8, 10) +
            '.' +
            body.day.slice(5, 7) +
            '. from ' +
            h(before) +
            ' h to ' +
            h(body.minutes) +
            ' h' +
            (st === 'approved' ? '; the week needs your approval again' : '') +
            '. Reason: ' +
            body.reason.trim();
        }
        return { body: { day: body.day, minutes: body.minutes } };
      });
      if (touched.project) await checkHourBudgets(pool, params.workspaceId, touched.project);
      if (corrected.to.length)
        await inSystem(pool, async (c) => {
          for (const u of corrected.to)
            await c.query(
              `INSERT INTO inbox_items (workspace_id, user_id, kind, object_type, object_id, title, detail, priority)
               VALUES ($1, $2, 'approval', 'timesheet', $3, 'A locked week was corrected', $4, 'normal')`,
              [params.workspaceId, u, corrected.user, corrected.text.slice(0, 4000)],
            );
        });
      return out;
    },
  });

  // [PCODE-344 | S15 | v0.1.0] time away from a running timer comes off it
  const idle = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/time/timer/idle',
    summary: 'Take the time since one was away off the running timer',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({ awayFrom: s.string({ max: 40 }) }),
    response: s.object({ idleMinutes: s.number() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const running = await runningOf(c, a.user.id);
        if (!running) throw new HttpError(409, 'conflict', 'No timer is running');
        const from = new Date(body.awayFrom);
        if (Number.isNaN(from.getTime()))
          throw new HttpError(400, 'invalid_request', 'When were you away?', [
            { path: 'body.awayFrom', message: 'is not a time' },
          ]);
        const now = new Date();
        const start = from < running.started_at ? running.started_at : from;
        const away = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60_000));
        const total = Math.min(1440, running.idle_minutes + away);
        await c.query(
          'UPDATE time_entries SET idle_minutes = $2, updated_at = now() WHERE id = $1',
          [running.id, total],
        );
        return { body: { idleMinutes: total } };
      }),
  });

  const removeEntry = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/time/entries/:entryId',
    summary: 'Remove one of one’s own entries in an open week',
    tags: ['time'],
    params: s.object({ workspaceId: uuid, entryId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const e = (
          await c.query<{ day: string }>(
            'SELECT day::text AS day FROM time_entries WHERE id = $1 AND user_id = $2',
            [params.entryId, a.user.id],
          )
        ).rows[0];
        if (!e) throw new HttpError(404, 'not_found', 'Entry not found');
        await requireOpen(c, a.user.id, e.day);
        await c.query('DELETE FROM time_entries WHERE id = $1', [params.entryId]);
        return { body: { removed: 1 } };
      }),
  });

  const submit = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/time/week/submit',
    summary: 'Submit one’s week for approval; it stays as it is until it is approved or returned',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({ week: day, note: s.optional(s.string({ max: 2000 })) }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const monday = weekOf(body.week);
        await requireOpen(c, a.user.id, monday);
        const running = await runningOf(c, a.user.id);
        if (running && weekOf(localDay(running.started_at)) === monday)
          await finishTimer(c, running, new Date());
        await c.query(
          `INSERT INTO timesheets (workspace_id, user_id, week, state, submitted_at, note) VALUES ($1, $2, $3, 'submitted', now(), $4)
           ON CONFLICT (workspace_id, user_id, week) DO UPDATE SET state = 'submitted', submitted_at = now(), note = EXCLUDED.note,
             decided_by = NULL, decided_at = NULL`,
          [a.workspaceId, a.user.id, monday, body.note ?? ''],
        );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: {
            type: 'timesheet',
            id: a.user.id,
            label: a.user.name + ' · week ' + String(isoWeek(monday)),
          },
          changes: { state: { from: 'open', to: 'submitted' }, week: { from: null, to: monday } },
        });
        return { body: { week: monday, state: 'submitted' } };
      }),
  });

  const approvals = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/time/approvals',
    summary:
      'Weeks waiting for one’s approval (a manager’s people; admins: everyone) and recent decisions',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const rows = (
          await c.query<{
            user_id: string;
            name: string;
            week: string;
            state: string;
            submitted_at: Date | null;
            decided_at: Date | null;
            minutes: string;
            billable: string;
            late: string;
            capacity: string | null;
          }>(
            `SELECT s.user_id, u.name, s.week::text AS week, s.state, s.submitted_at, s.decided_at,
                (SELECT coalesce(sum(minutes), 0) FROM time_entries e WHERE e.user_id = s.user_id AND e.day BETWEEN s.week AND s.week + 6) AS minutes,
                (SELECT coalesce(sum(minutes), 0) FROM time_entries e WHERE e.user_id = s.user_id AND e.day BETWEEN s.week AND s.week + 6 AND e.billable) AS billable,
                (SELECT count(*) FROM time_entries e WHERE e.user_id = s.user_id AND e.day BETWEEN s.week AND s.week + 6 AND (e.after_lock OR e.auto_stopped)) AS late,
                mp.capacity_hours_week AS capacity
               FROM timesheets s JOIN users u ON u.id = s.user_id LEFT JOIN member_profiles mp ON mp.user_id = s.user_id
              WHERE (s.user_id <> $1 OR $3) AND ($2 OR mp.manager_id = $1)
                AND (s.state = 'submitted' OR s.decided_at > now() - interval '14 days')
              ORDER BY (s.state = 'submitted') DESC, s.week DESC, u.name LIMIT 100`,
            [a.user.id, isAdmin(a), await soleAdmin(c, a)],
          )
        ).rows;
        const absences = (
          await c.query<{ user_id: string; starts_on: string; ends_on: string; half_day: boolean }>(
            "SELECT user_id, starts_on::text AS starts_on, ends_on::text AS ends_on, half_day FROM absences WHERE state = 'approved'",
          )
        ).rows;
        return {
          body: {
            weeks: rows.map((r) => {
              const away = absences
                .filter((x) => x.user_id === r.user_id)
                .reduce(
                  (n, x) =>
                    n +
                    absenceWorkdays(
                      { startsOn: x.starts_on, endsOn: x.ends_on, halfDay: x.half_day },
                      daysOf(r.week),
                    ),
                  0,
                );
              const weekly = r.capacity === null ? 40 : Number(r.capacity);
              const minutes = Number(r.minutes);
              const notes: string[] = [];
              if (minutes > weekly * 60) notes.push('over ' + String(weekly) + ' h');
              if (away)
                notes.push(
                  String(away).replace('.', ',') + (away === 1 ? ' day' : ' days') + ' absence',
                );
              if (Number(r.late)) notes.push('timer or IDE time to check');
              return {
                userId: r.user_id,
                name: r.name,
                week: r.week,
                weekNo: isoWeek(r.week),
                state: r.state,
                minutes,
                billable: Number(r.billable),
                notes,
              };
            }),
          },
        };
      }),
  });

  const decide = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/time/approvals/decision',
    summary: 'Approve and lock a submitted week (rates are kept), or return it with a note',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      userId: uuid,
      week: day,
      decision: s.enum(['approved', 'returned']),
      note: s.optional(s.string({ max: 2000 })),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        if (!(await mayApproveFor(c, a, body.userId)))
          throw new HttpError(403, 'forbidden', 'Their manager or an admin approves a week');
        const monday = weekOf(body.week);
        const st = await sheetState(c, body.userId, monday);
        if (st !== 'submitted')
          throw new HttpError(409, 'conflict', 'This week is not waiting for approval');
        if (body.decision === 'returned' && !body.note?.trim())
          throw new HttpError(400, 'invalid_request', 'Say what to correct', [
            { path: 'body.note', message: 'is required when returning a week' },
          ]);
        if (body.decision === 'approved') {
          // the rates of this moment stay with the hours
          const rates = await loadRates(c);
          const person = (
            await c.query<{ role: string; cost: string | null }>(
              `SELECT m.role, mp.cost_rate_cents AS cost FROM workspace_members m
                 LEFT JOIN member_profiles mp ON mp.user_id = m.user_id WHERE m.user_id = $1`,
              [body.userId],
            )
          ).rows[0];
          const entries = (
            await c.query<{
              id: string;
              day: string;
              project_id: string | null;
              client_id: string | null;
            }>(
              `SELECT e.id, e.day::text AS day, e.project_id, p.client_id FROM time_entries e
                 LEFT JOIN projects p ON p.id = e.project_id
                WHERE e.user_id = $1 AND e.day BETWEEN $2 AND $3`,
              [body.userId, monday, daysOf(monday)[6]],
            )
          ).rows;
          for (const e of entries) {
            const who = {
              userId: body.userId,
              role: person?.role ?? 'member',
              clientId: e.client_id,
              projectId: e.project_id,
            };
            const cost =
              pickRate(rates, who, 'cost', e.day) ?? (person?.cost ? Number(person.cost) : null);
            await c.query(
              'UPDATE time_entries SET rate_cents = $2, cost_cents = $3, after_lock = false WHERE id = $1',
              [e.id, pickRate(rates, who, 'billable', e.day), cost],
            );
          }
        }
        await c.query(
          `UPDATE timesheets SET state = $3, decided_by = $4, decided_at = now(), note = $5
            WHERE user_id = $1 AND week = $2`,
          [body.userId, monday, body.decision, a.user.id, body.note?.trim() ?? ''],
        );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: body.decision === 'approved' ? 'approved' : 'rejected',
          object: { type: 'timesheet', id: body.userId, label: 'week ' + String(isoWeek(monday)) },
          changes: {
            state: { from: 'submitted', to: body.decision },
            week: { from: null, to: monday },
          },
        });
        return { body: { userId: body.userId, week: monday, state: body.decision } };
      }),
  });

  // ── absences ──
  const absences = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/time/absences',
    summary:
      'Absences of the team from a day on (the kind is shown to the person, managers and admins)',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ from: s.optional(day) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const from = query.from ?? localDay(new Date());
        const rows = (
          await c.query<{
            id: string;
            user_id: string;
            name: string;
            starts_on: string;
            ends_on: string;
            half_day: boolean;
            kind: string;
            state: string;
            note: string;
            manager_id: string | null;
          }>(
            `SELECT x.id, x.user_id, u.name, x.starts_on::text AS starts_on, x.ends_on::text AS ends_on, x.half_day,
                x.kind, x.state, x.note, mp.manager_id
               FROM absences x JOIN users u ON u.id = x.user_id LEFT JOIN member_profiles mp ON mp.user_id = x.user_id
              WHERE x.ends_on >= $1 AND x.state <> 'declined' ORDER BY x.starts_on, u.name LIMIT 200`,
            [from],
          )
        ).rows;
        return {
          body: {
            absences: rows.map((x) => {
              const close = x.user_id === a.user.id || isAdmin(a) || x.manager_id === a.user.id;
              return {
                id: x.id,
                userId: x.user_id,
                name: x.name,
                startsOn: x.starts_on,
                endsOn: x.ends_on,
                halfDay: x.half_day,
                // a colleague sees that someone is away, not why
                kind: close ? x.kind : 'away',
                note: close ? x.note : '',
                state: x.state,
                mine: x.user_id === a.user.id,
                mayDecide:
                  x.state === 'requested' &&
                  x.user_id !== a.user.id &&
                  (isAdmin(a) || x.manager_id === a.user.id),
              };
            }),
          },
        };
      }),
  });

  const addAbsence = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/time/absences',
    summary:
      'Ask for time off (or record sick days, which need no approval); admins record for others',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      startsOn: day,
      endsOn: day,
      halfDay: s.optional(s.boolean()),
      kind: s.enum(['holiday', 'sick', 'appointment', 'other']),
      note: s.optional(s.string({ max: 500 })),
      userId: s.optional(uuid),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const userId = body.userId ?? a.user.id;
        if (userId !== a.user.id && !isAdmin(a))
          throw new HttpError(403, 'forbidden', 'Admins record absences for others');
        if (body.endsOn < body.startsOn)
          throw new HttpError(400, 'invalid_request', 'The absence ends before it starts', [
            { path: 'body.endsOn', message: 'is before startsOn' },
          ]);
        if (body.halfDay && body.endsOn !== body.startsOn)
          throw new HttpError(400, 'invalid_request', 'Half a day is one day', [
            { path: 'body.halfDay', message: 'needs startsOn = endsOn' },
          ]);
        const self =
          userId === a.user.id && (await soleAdmin(c, a)) && !(await managerOf(c, userId));
        const state =
          body.kind === 'sick' || userId !== a.user.id || self ? 'approved' : 'requested';
        const id =
          (
            await c.query<{ id: string }>(
              `INSERT INTO absences (workspace_id, user_id, starts_on, ends_on, half_day, kind, state, note, decided_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
              [
                a.workspaceId,
                userId,
                body.startsOn,
                body.endsOn,
                body.halfDay ?? false,
                body.kind,
                state,
                body.note ?? '',
                state === 'approved' ? a.user.id : null,
              ],
            )
          ).rows[0]?.id ?? '';
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'created',
          object: { type: 'absence', id, label: body.startsOn + ' – ' + body.endsOn },
          changes: { state: { from: null, to: state } },
        });
        return { status: 201, body: { id, state } };
      }),
  });

  const decideAbsence = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/time/absences/:absenceId/decision',
    summary: 'Approve or decline time off (the person’s manager or an admin)',
    tags: ['time'],
    params: s.object({ workspaceId: uuid, absenceId: uuid }),
    body: s.object({ decision: s.enum(['approved', 'declined']) }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const x = (
          await c.query<{ user_id: string; state: string; starts_on: string; ends_on: string }>(
            'SELECT user_id, state, starts_on::text AS starts_on, ends_on::text AS ends_on FROM absences WHERE id = $1',
            [params.absenceId],
          )
        ).rows[0];
        if (!x) throw new HttpError(404, 'not_found', 'Absence not found');
        if (!(await mayApproveFor(c, a, x.user_id)))
          throw new HttpError(403, 'forbidden', 'Their manager or an admin decides on time off');
        if (x.state !== 'requested')
          throw new HttpError(409, 'conflict', 'This absence is decided');
        await c.query('UPDATE absences SET state = $2, decided_by = $3 WHERE id = $1', [
          params.absenceId,
          body.decision,
          a.user.id,
        ]);
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: body.decision === 'approved' ? 'approved' : 'rejected',
          object: { type: 'absence', id: params.absenceId, label: x.starts_on + ' – ' + x.ends_on },
          changes: { state: { from: 'requested', to: body.decision } },
        });
        return { body: { id: params.absenceId, state: body.decision } };
      }),
  });

  const removeAbsence = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/time/absences/:absenceId',
    summary: 'Withdraw one’s own absence (admins: anyone’s)',
    tags: ['time'],
    params: s.object({ workspaceId: uuid, absenceId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const n = (
          await c.query('DELETE FROM absences WHERE id = $1 AND (user_id = $2 OR $3)', [
            params.absenceId,
            a.user.id,
            isAdmin(a),
          ])
        ).rowCount;
        if (!n) throw new HttpError(404, 'not_found', 'Absence not found');
        return { body: { removed: n } };
      }),
  });

  // ── rates ──
  const rateOut = s.object({
    id: s.string(),
    scopeType: s.string(),
    scopeKey: s.string(),
    scopeLabel: s.string(),
    kind: s.string(),
    centsPerHour: s.number(),
    validFrom: s.string(),
  });
  const rates = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/time/rates',
    summary: 'Billable and cost rates per hour (admin, billing, auditor)',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(rateOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        if (!mayReport(a))
          throw new HttpError(403, 'forbidden', 'Rates are for admins and billing');
        const rows = (
          await c.query<{
            id: string;
            scope_type: string;
            scope_key: string;
            kind: string;
            cents_per_hour: string;
            valid_from: string;
            label: string | null;
          }>(
            `SELECT r.id, r.scope_type, r.scope_key, r.kind, r.cents_per_hour, r.valid_from::text AS valid_from,
                CASE r.scope_type
                  WHEN 'person' THEN (SELECT name FROM users WHERE id::text = r.scope_key)
                  WHEN 'client' THEN (SELECT name FROM clients WHERE id::text = r.scope_key)
                  WHEN 'project' THEN (SELECT key FROM projects WHERE id::text = r.scope_key)
                  WHEN 'role' THEN r.scope_key ELSE 'Everyone' END AS label
               FROM rates r ORDER BY r.kind, r.scope_type, r.valid_from DESC`,
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            scopeType: r.scope_type,
            scopeKey: r.scope_key,
            scopeLabel: r.label ?? '—',
            kind: r.kind,
            centsPerHour: Number(r.cents_per_hour),
            validFrom: r.valid_from,
          })),
        };
      }),
  });

  const addRate = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/time/rates',
    summary: 'Add a rate valid from a day (admin); a later one for the same scope takes over then',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      scopeType: s.enum(['workspace', 'role', 'person', 'client', 'project']),
      scopeKey: s.optional(s.string({ max: 120 })),
      kind: s.enum(['billable', 'cost']),
      centsPerHour: s.number({ integer: true, min: 0, max: 100_000_00 }),
      validFrom: s.optional(day),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const key = body.scopeType === 'workspace' ? '' : (body.scopeKey ?? '').trim();
        if (body.scopeType !== 'workspace' && !key)
          throw new HttpError(400, 'invalid_request', 'Whose rate is it?', [
            { path: 'body.scopeKey', message: 'is required for this scope' },
          ]);
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO rates (workspace_id, scope_type, scope_key, kind, cents_per_hour, valid_from)
             VALUES ($1, $2, $3, $4, $5, coalesce($6::date, current_date)) RETURNING id`,
            [
              a.workspaceId,
              body.scopeType,
              key,
              body.kind,
              body.centsPerHour,
              body.validFrom ?? null,
            ],
          )
        ).rows[0]?.id;
        return { status: 201, body: { id } };
      }),
  });

  const removeRate = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/time/rates/:rateId',
    summary: 'Remove a rate (admin); approved weeks keep the rate they were approved with',
    tags: ['time'],
    params: s.object({ workspaceId: uuid, rateId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const n = (await c.query('DELETE FROM rates WHERE id = $1', [params.rateId])).rowCount;
        if (!n) throw new HttpError(404, 'not_found', 'Rate not found');
        return { body: { removed: n } };
      }),
  });

  // ── reports ──
  const MONTH = s.string({ pattern: /^\d{4}-\d{2}$/ });
  const report = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/time/report',
    summary: 'A month per client: hours, billable share, people and AI cost, against the budget',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ month: s.optional(MONTH) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        if (!mayReport(a))
          throw new HttpError(403, 'forbidden', 'Reports are for admins and billing');
        return {
          body: (await monthReport(c, query.month ?? localDay(new Date()).slice(0, 7))).body,
        };
      }),
  });

  const exportCsv = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/time/report.csv',
    summary:
      'A month’s time as CSV: day, person, client, project, task, hours, billable, rate, amount',
    tags: ['time'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ month: s.optional(MONTH) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        if (!mayReport(a))
          throw new HttpError(403, 'forbidden', 'Reports are for admins and billing');
        const r = await monthReport(c, query.month ?? localDay(new Date()).slice(0, 7));
        const money = (cents: number | null): string =>
          cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');
        const csv = toCsv([
          [
            'Day',
            'Person',
            'Client',
            'Project',
            'Task',
            'Hours',
            'Billable',
            'Rate €/h',
            'Amount €',
            'Approved',
          ],
          ...r.priced.map((e) => [
            e.day,
            e.user_name,
            e.client_name ?? 'Internal',
            e.project_key ?? '',
            e.item_ref ? e.item_ref + ' ' + (e.title ?? '') : e.label,
            (e.minutes / 60).toFixed(2).replace('.', ','),
            e.billable ? 'yes' : 'no',
            money(e.rate),
            e.billable ? money(e.cents) : '',
            e.approved ? 'yes' : 'no',
          ]),
        ]);
        return {
          body: {},
          file: {
            data: Buffer.from('﻿' + csv, 'utf8'),
            contentType: 'text/csv; charset=utf-8',
            name: 'time-' + r.month + '.csv',
          },
        };
      }),
  });

  return [
    week,
    startTimer,
    stopTimer,
    idle, // [PCODE-344 | S15 | v0.1.0]
    cell,
    removeEntry,
    submit,
    approvals,
    decide,
    absences,
    addAbsence,
    decideAbsence,
    removeAbsence,
    rates,
    addRate,
    removeRate,
    report,
    exportCsv,
  ];
}
