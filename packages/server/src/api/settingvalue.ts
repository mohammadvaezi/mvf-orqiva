// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
// ── [PCODE-252 | S15 | v0.1.0] T26.1 Estimation: units, async planning poker, suggestions from similar tasks, estimate vs actual ──
//    Why:  a setting as it applies to one project: the project's own value, else the workspace's, else the
//          default. Routes that act on a setting read it here, so they agree with the settings page.
import { settingDef } from '@orqiva/shared';
import type { PoolClient } from 'pg';

export async function settingFor(
  c: PoolClient,
  key: string,
  projectId: string | null,
  // [PCODE-255 | S15 | v0.1.0] needed outside a workspace's transaction (system mode sees every workspace)
  workspaceId: string | null = null,
): Promise<unknown> {
  const rows = (
    await c.query<{ scope_type: string; value: unknown }>(
      `SELECT scope_type, value FROM settings
        WHERE key = $1 AND (scope_type = 'workspace' OR (scope_type = 'project' AND scope_id = $2))
          AND ($3::uuid IS NULL OR workspace_id = $3)`,
      [key, projectId, workspaceId],
    )
  ).rows;
  return (
    rows.find((r) => r.scope_type === 'project')?.value ??
    rows.find((r) => r.scope_type === 'workspace')?.value ??
    settingDef(key)?.default
  );
}

export async function numberSetting(
  c: PoolClient,
  key: string,
  projectId: string | null,
): Promise<number> {
  const v = await settingFor(c, key, projectId);
  return typeof v === 'number' ? v : Number(settingDef(key)?.default ?? 0);
}
