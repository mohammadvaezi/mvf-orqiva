// ── [PCODE-344 | S15 | v0.1.0] T34.3b Timer idle detection, time reminders, correction reasons for locked weeks ──
//    Why:  people who track time forget it at the end of a busy day and forget to submit the week: after
//          17:00 on a workday with nothing booked, and from Friday 15:00 with the week not submitted, they
//          get one reminder each, in their own time zone, never on an approved day off.
import { reminderDue, weekOf } from '@orqiva/shared';
import type { PoolClient } from 'pg';
import { localParts } from '../mail/outbox.js';

export interface TimeReminder {
  userId: string;
  kind: 'day' | 'week';
  key: string;
  title: string;
  body: string;
}

/** The time reminders due now in one workspace (runs in it), each recorded so it is sent once. */
export async function timeReminders(c: PoolClient, ws: string, now: Date): Promise<TimeReminder[]> {
  const people = (
    await c.query<{ user_id: string; tz: string }>(
      `SELECT m.user_id, coalesce(mp.timezone, 'Europe/Berlin') AS tz
         FROM workspace_members m JOIN users u ON u.id = m.user_id
         LEFT JOIN member_profiles mp ON mp.user_id = m.user_id
        WHERE m.suspended_at IS NULL AND m.role IN ('member', 'admin', 'owner') AND NOT u.is_service
          AND EXISTS (SELECT 1 FROM time_entries e WHERE e.user_id = m.user_id AND e.day >= $1::date - 30)`,
      [now.toISOString().slice(0, 10)],
    )
  ).rows;
  const out: TimeReminder[] = [];
  const once = async (userId: string, kind: 'day' | 'week', key: string): Promise<boolean> =>
    Boolean(
      (
        await c.query(
          'INSERT INTO time_reminders (workspace_id, user_id, kind, key) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [ws, userId, kind, key],
        )
      ).rowCount,
    );
  for (const p of people) {
    const local = localParts(now, p.tz);
    if (reminderDue('day', local.day, local.hour)) {
      const booked = (
        await c.query(
          `SELECT 1 FROM time_entries WHERE user_id = $1 AND day = $2 AND (minutes > 0 OR ended_at IS NULL)
           UNION ALL
           SELECT 1 FROM absences WHERE user_id = $1 AND state = 'approved' AND NOT half_day AND starts_on <= $2 AND ends_on >= $2`,
          [p.user_id, local.day],
        )
      ).rowCount;
      if (!booked && (await once(p.user_id, 'day', local.day)))
        out.push({
          userId: p.user_id,
          kind: 'day',
          key: local.day,
          title: 'No time booked today',
          body: 'Book today’s hours while you still remember them.',
        });
    }
    if (reminderDue('week', local.day, local.hour)) {
      const monday = weekOf(local.day);
      const open = (
        await c.query(
          `SELECT 1 FROM time_entries e WHERE e.user_id = $1 AND e.day BETWEEN $2::date AND $2::date + 6 AND e.minutes > 0
              AND NOT EXISTS (SELECT 1 FROM timesheets s WHERE s.user_id = $1 AND s.week = $2 AND s.state IN ('submitted', 'approved'))
            LIMIT 1`,
          [p.user_id, monday],
        )
      ).rowCount;
      if (open && (await once(p.user_id, 'week', monday)))
        out.push({
          userId: p.user_id,
          kind: 'week',
          key: monday,
          title: 'Submit your week',
          body: 'Check this week’s hours and submit them for approval.',
        });
    }
  }
  return out;
}
