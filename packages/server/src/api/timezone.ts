// ── [PCODE-248 | S15 | v0.1.0] T25.3 Custom roles, role conditions and project roles enforced ──
//    Why:  the workspace's time zone, read in one place: schedules start at its minutes and role conditions
//          hold in its hours. It is the time zone of the workspace's working hours setting.
import type { PoolClient } from 'pg';

export const DEFAULT_TIME_ZONE = 'Europe/Berlin';

export async function workspaceTimeZone(c: PoolClient, ws: string): Promise<string> {
  const v = (
    await c.query<{ value: { timeZone?: unknown } }>(
      "SELECT value FROM settings WHERE workspace_id = $1 AND scope_type = 'workspace' AND key = 'calendar.working_hours'",
      [ws],
    )
  ).rows[0]?.value;
  return typeof v?.timeZone === 'string' && v.timeZone ? v.timeZone : DEFAULT_TIME_ZONE;
}
