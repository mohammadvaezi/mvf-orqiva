// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-343 | S15 | v0.1.0] T34.3a Hour budgets with alerts, time reports by person, sprint and task, DATEV export ──
//    Why:  a project or a client is sold so many hours; the admins hear when time crosses the warning level
//          and when it is used up, once per period. Time is looked at by person, sprint, task, project or
//          client over any range of days, and the billable amounts go to the tax adviser as a DATEV file.
import { datevBuchungsstapel, hourBudgetAlert, localDay, toCsv } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, type Access } from './access.js';
import { pricedEntries, type ReportEntry } from './time.js';

const uuid = s.string({ format: 'uuid' });
const day = s.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ });
const isAdmin = (a: Access): boolean => a.role === 'admin' || a.role === 'owner';
const mayReport = (a: Access): boolean =>
  isAdmin(a) || a.role === 'billing' || a.role === 'auditor';

interface BudgetRow {
  id: string;
  workspace_id: string;
  scope_type: 'project' | 'client';
  scope_id: string;
  period: 'month' | 'total';
  hours: string;
  warn_pct: number;
  warned_key: string | null;
  over_key: string | null;
  half_key: string | null; // [PCODE-351 | S15 | v0.1.0]
  label: string | null;
}

const BUDGET_SELECT = `SELECT b.id, b.workspace_id, b.scope_type, b.scope_id, b.period, b.hours, b.warn_pct, b.warned_key, b.over_key, b.half_key,
    CASE WHEN b.scope_type = 'project' THEN p.key || ' ' || p.name ELSE cl.name END AS label
  FROM hour_budgets b
  LEFT JOIN projects p ON b.scope_type = 'project' AND p.id = b.scope_id
  LEFT JOIN clients cl ON b.scope_type = 'client' AND cl.id = b.scope_id`;

/** '2026-10' for a monthly budget this month, 'total' for one that never resets. */
const periodKey = (period: 'month' | 'total', now: Date): string =>
  period === 'month' ? localDay(now).slice(0, 7) : 'total';

const nextDay = (d: string): string => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

/** The hours booked against a budget in its period. */
async function usedHours(c: PoolClient, b: BudgetRow, now: Date): Promise<number> {
  const month = periodKey('month', now);
  const from = b.period === 'month' ? month + '-01' : null;
  const end = new Date(month + '-01T00:00:00Z');
  end.setUTCMonth(end.getUTCMonth() + 1);
  const to = from ? end.toISOString().slice(0, 10) : null;
  const m = (
    await c.query<{ m: string }>(
      `SELECT coalesce(sum(e.minutes), 0) AS m FROM time_entries e JOIN projects p ON p.id = e.project_id
        WHERE e.workspace_id = $1 AND (CASE WHEN $2 = 'project' THEN p.id = $3 ELSE p.client_id = $3 END)
          AND ($4::date IS NULL OR e.day >= $4) AND ($5::date IS NULL OR e.day < $5)`,
      [b.workspace_id, b.scope_type, b.scope_id, from, to],
    )
  ).rows[0]?.m;
  return Math.round((Number(m ?? 0) / 60) * 100) / 100;
}

const hoursText = (h: number): string => String(Math.round(h * 10) / 10).replace('.', ',');

/** After time is written on a project: its budgets and its client's warn the admins, once per period. */
export async function checkHourBudgets(
  pool: Pool,
  workspaceId: string,
  projectId: string,
  now = new Date(),
): Promise<number> {
  return inSystem(pool, async (c) => {
    const budgets = (
      await c.query<BudgetRow>(
        BUDGET_SELECT +
          ` WHERE b.workspace_id = $1 AND ((b.scope_type = 'project' AND b.scope_id = $2)
              OR (b.scope_type = 'client' AND b.scope_id = (SELECT client_id FROM projects WHERE id = $2)))`,
        [workspaceId, projectId],
      )
    ).rows;
    let sent = 0;
    for (const b of budgets) {
      const used = await usedHours(c, b, now);
      const key = periodKey(b.period, now);
      const hours = Number(b.hours);
      const alert = hourBudgetAlert(
        {
          hours,
          warnPct: b.warn_pct,
          warnedKey: b.warned_key,
          overKey: b.over_key,
          halfKey: b.half_key,
        },
        used,
        key,
      );
      if (!alert) continue;
      await c.query(
        alert === 'over'
          ? 'UPDATE hour_budgets SET over_key = $2, warned_key = $2, half_key = $2 WHERE id = $1'
          : alert === 'warn'
            ? 'UPDATE hour_budgets SET warned_key = $2, half_key = $2 WHERE id = $1'
            : 'UPDATE hour_budgets SET half_key = $2 WHERE id = $1', // [PCODE-351 | S15 | v0.1.0]
        [b.id, key],
      );
      const admins = (
        await c.query<{ user_id: string }>(
          "SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role IN ('admin', 'owner')",
          [workspaceId],
        )
      ).rows.map((r) => r.user_id);
      const when = b.period === 'month' ? ' this month' : '';
      const title =
        (b.label ?? 'A budget') +
        (alert === 'over'
          ? ': hour budget used up'
          : ': ' + String(Math.round((used / hours) * 100)) + ' % of the hour budget');
      const detail =
        hoursText(used) +
        ' of ' +
        hoursText(hours) +
        ' h booked' +
        when +
        '.' +
        (alert === 'over' ? ' Agree more hours with the client or stop booking here.' : '');
      for (const u of admins)
        await c.query(
          `INSERT INTO inbox_items (workspace_id, user_id, kind, project_id, object_type, object_id, title, detail, priority)
           VALUES ($1, $2, 'budget', $3, $4, $5, $6, $7, $8)`,
          [
            workspaceId,
            u,
            b.scope_type === 'project' ? b.scope_id : null,
            b.scope_type,
            b.scope_id,
            title.slice(0, 300),
            detail,
            alert === 'over' ? 'high' : 'normal',
          ],
        );
      sent += admins.length;
    }
    return sent;
  });
}

export type BreakdownBy = 'person' | 'sprint' | 'task' | 'project' | 'client';

/** Entries summed by one of their sides, largest first. */
export function breakdown(
  priced: readonly ReportEntry[],
  by: BreakdownBy,
): { key: string; label: string; minutes: number; billableMinutes: number; cents: number }[] {
  const side = (e: ReportEntry): [string, string] => {
    if (by === 'person') return [e.user_id, e.user_name];
    if (by === 'sprint') return [e.sprint_id ?? '-', e.sprint_name ?? 'No sprint'];
    if (by === 'project') return [e.project_id ?? '-', e.project_key ?? 'No project'];
    if (by === 'client') return [e.client_id ?? '-', e.client_name ?? 'Internal'];
    return e.item_id
      ? [e.item_id, (e.item_ref ?? '') + ' ' + (e.title ?? '')]
      : ['label:' + e.label, e.label || 'Other work'];
  };
  const out = new Map<
    string,
    { key: string; label: string; minutes: number; billableMinutes: number; cents: number }
  >();
  for (const e of priced) {
    const [key, label] = side(e);
    const row = out.get(key) ?? { key, label, minutes: 0, billableMinutes: 0, cents: 0 };
    row.minutes += e.minutes;
    if (e.billable) row.billableMinutes += e.minutes;
    row.cents += e.cents;
    out.set(key, row);
  }
  return [...out.values()].sort((x, y) => y.minutes - x.minutes || x.label.localeCompare(y.label));
}

const hoursCsv = (m: number): string => (m / 60).toFixed(2).replace('.', ',');
const euroCsv = (c: number): string => (c / 100).toFixed(2).replace('.', ',');

export function timeReportRoutes(pool: Pool): Route[] {
  const ws = s.object({ workspaceId: uuid });
  const range = s.object({
    from: day,
    to: day,
    by: s.optional(s.enum(['person', 'sprint', 'task', 'project', 'client'])),
  });
  const reporting = (a: Access): void => {
    if (!mayReport(a)) throw new HttpError(403, 'forbidden', 'Reports are for admins and billing');
  };
  const checkRange = (from: string, to: string): void => {
    if (to < from)
      throw new HttpError(400, 'invalid_request', 'The range ends before it starts', [
        { path: 'query.to', message: 'is before from' },
      ]);
  };

  const budgetJson = async (c: PoolClient, b: BudgetRow, now: Date) => {
    const used = await usedHours(c, b, now);
    const hours = Number(b.hours);
    return {
      id: b.id,
      scopeType: b.scope_type,
      scopeId: b.scope_id,
      label: b.label ?? '(removed)',
      period: b.period,
      hours,
      warnPct: b.warn_pct,
      usedHours: used,
      pct: Math.round((used / hours) * 100),
    };
  };

  const listBudgets = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/time/hour-budgets',
    summary: 'Hour budgets of projects and clients with the hours used in their period',
    tags: ['time'],
    params: ws,
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        reporting(a);
        const now = new Date();
        const rows = (await c.query<BudgetRow>(BUDGET_SELECT + ' ORDER BY label')).rows;
        const out = [];
        for (const b of rows) out.push(await budgetJson(c, b, now));
        return { body: { budgets: out } };
      }),
  });

  const saveBudget = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/time/hour-budgets',
    summary: 'Set the hours of a project or a client, per month or in total (admin)',
    tags: ['time'],
    params: ws,
    body: s.object({
      scopeType: s.enum(['project', 'client']),
      scopeId: uuid,
      period: s.enum(['month', 'total']),
      hours: s.number({ min: 0.5, max: 100_000 }),
      warnPct: s.optional(s.number({ integer: true, min: 1, max: 100 })),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const known = (
          await c.query(
            body.scopeType === 'project'
              ? 'SELECT 1 FROM projects WHERE id = $1'
              : 'SELECT 1 FROM clients WHERE id = $1',
            [body.scopeId],
          )
        ).rowCount;
        if (!known) throw new HttpError(404, 'not_found', 'No such ' + body.scopeType);
        // a changed budget may warn again
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO hour_budgets (workspace_id, scope_type, scope_id, period, hours, warn_pct, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (workspace_id, scope_type, scope_id, period)
             DO UPDATE SET hours = EXCLUDED.hours, warn_pct = EXCLUDED.warn_pct, warned_key = NULL, over_key = NULL, half_key = NULL
             RETURNING id`,
            [
              a.workspaceId,
              body.scopeType,
              body.scopeId,
              body.period,
              body.hours,
              body.warnPct ?? 80,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        const b = (await c.query<BudgetRow>(BUDGET_SELECT + ' WHERE b.id = $1', [id])).rows[0];
        if (!b) throw new Error('hour budget insert returned nothing');
        return { body: await budgetJson(c, b, new Date()) };
      }),
  });

  const removeBudget = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/time/hour-budgets/:budgetId',
    summary: 'Remove an hour budget (admin)',
    tags: ['time'],
    params: s.object({ workspaceId: uuid, budgetId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: {
          removed: Boolean(
            (await c.query('DELETE FROM hour_budgets WHERE id = $1', [params.budgetId])).rowCount,
          ),
        },
      })),
  });

  const report = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/time/breakdown',
    summary:
      'Hours, billable hours and amount for a range of days, by person, sprint, task, project or client',
    tags: ['time'],
    params: ws,
    query: range,
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        reporting(a);
        checkRange(query.from, query.to);
        const priced = await pricedEntries(c, query.from, nextDay(query.to));
        const rows = breakdown(priced, query.by ?? 'person');
        return {
          body: {
            from: query.from,
            to: query.to,
            by: query.by ?? 'person',
            minutes: rows.reduce((n, r) => n + r.minutes, 0),
            billableMinutes: rows.reduce((n, r) => n + r.billableMinutes, 0),
            cents: rows.reduce((n, r) => n + r.cents, 0),
            rows,
          },
        };
      }),
  });

  const reportCsv = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/time/breakdown.csv',
    summary: 'The breakdown as CSV',
    tags: ['time'],
    params: ws,
    query: range,
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        reporting(a);
        checkRange(query.from, query.to);
        const by = query.by ?? 'person';
        const rows = breakdown(await pricedEntries(c, query.from, nextDay(query.to)), by);
        const head = {
          person: 'Person',
          sprint: 'Sprint',
          task: 'Task',
          project: 'Project',
          client: 'Client',
        }[by];
        const csv = toCsv([
          [head, 'Hours', 'Billable hours', 'Amount €'],
          ...rows.map((r) => [
            r.label,
            hoursCsv(r.minutes),
            hoursCsv(r.billableMinutes),
            euroCsv(r.cents),
          ]),
        ]);
        return {
          body: {},
          file: {
            data: Buffer.from('﻿' + csv, 'utf8'),
            contentType: 'text/csv; charset=utf-8',
            name: 'time-by-' + by + '-' + query.from + '-' + query.to + '.csv',
          },
        };
      }),
  });

  const datev = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/time/datev.csv',
    summary:
      'The billable amounts of a range per client and project as a DATEV Buchungsstapel (admin, billing)',
    tags: ['time'],
    params: ws,
    query: s.object({
      from: day,
      to: day,
      revenueAccount: s.string({ pattern: /^[0-9]{4,8}$/ }),
      consultant: s.string({ pattern: /^[0-9]{4,7}$/ }),
      client: s.string({ pattern: /^[0-9]{1,5}$/ }),
    }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        if (!isAdmin(a) && a.role !== 'billing')
          throw new HttpError(403, 'forbidden', 'The DATEV export is for admins and billing');
        checkRange(query.from, query.to);
        const priced = (await pricedEntries(c, query.from, nextDay(query.to))).filter(
          (e) => e.billable && e.client_id && e.cents > 0,
        );
        const accounts = new Map(
          (
            await c.query<{ id: string; datev_account: string | null }>(
              'SELECT id, datev_account FROM clients',
            )
          ).rows.map((r) => [r.id, r.datev_account]),
        );
        const groups = new Map<
          string,
          { client: string; name: string; project: string; minutes: number; cents: number }
        >();
        for (const e of priced) {
          const k = (e.client_id ?? '') + '|' + (e.project_id ?? '');
          const g = groups.get(k) ?? {
            client: e.client_id ?? '',
            name: e.client_name ?? '',
            project: e.project_key ?? '',
            minutes: 0,
            cents: 0,
          };
          g.minutes += e.minutes;
          g.cents += e.cents;
          groups.set(k, g);
        }
        const doc = 'ORQ' + query.to.slice(0, 7).replace('-', '');
        const rows = [...groups.values()]
          .sort((x, y) => x.name.localeCompare(y.name) || x.project.localeCompare(y.project))
          .map((g, i) => ({
            cents: g.cents,
            account: accounts.get(g.client) ?? '10000',
            contra: query.revenueAccount,
            date: query.to,
            document: doc + '-' + String(i + 1),
            text: 'Leistungen ' + g.name + ' ' + g.project + ' ' + hoursCsv(g.minutes) + ' h',
          }));
        const file = datevBuchungsstapel(
          {
            consultant: query.consultant,
            client: query.client,
            fiscalYearStart: query.from.slice(0, 4) + '-01-01',
            from: query.from,
            to: query.to,
            label: 'Leistungen ' + query.from.slice(0, 7),
            now: new Date(),
          },
          rows,
        );
        return {
          body: {},
          file: {
            // DATEV reads Windows-1252; the texts here keep to Latin-1
            data: Buffer.from(file, 'latin1'),
            contentType: 'text/csv; charset=windows-1252',
            name: 'EXTF_Buchungsstapel_' + query.from + '_' + query.to + '.csv',
          },
        };
      }),
  });

  const clientAccount = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/clients/:clientId/datev-account',
    summary: 'The client’s debtor account for the DATEV export (admin)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    body: s.object({ account: s.nullable(s.string({ pattern: /^[0-9]{4,9}$/ })) }),
    response: s.object({ account: s.nullable(s.string()) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const n = (
          await c.query('UPDATE clients SET datev_account = $2 WHERE id = $1', [
            params.clientId,
            body.account,
          ])
        ).rowCount;
        if (!n) throw new HttpError(404, 'not_found', 'Client not found');
        return { body: { account: body.account } };
      }),
  });

  return [listBudgets, saveBudget, removeBudget, report, reportCsv, datev, clientAccount];
}
