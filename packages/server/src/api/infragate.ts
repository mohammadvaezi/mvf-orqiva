// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-133 | S15 | v0.1.0] Add infrastructure templates and deploy from a gate ──
//    Why:  the infrastructure stage joined to the lifecycle. Signing a gate deploys the environments that
//          wait for it (staging on G1), and deploys are G2's evidence: "provisioned" is met when every
//          environment of the project has a successful deploy, "verified" when every one's last deploy
//          passed its health check. Measured from runs, never ticked by hand by the system on a hunch.
import type { Actor } from '@orqiva/shared';
import type { PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import type { Access } from './access.js';
import { queueDeploy } from './deploys.js';

/** The gate that environments are provisioned and verified under. */
export const ENV_GATE = 'g2';

/** Queues a deploy of every environment of the project that waits for this gate; returns how many. */
export async function deployOnGate(
  c: PoolClient,
  a: Pick<Access, 'workspaceId'> & { user: { id: string; name: string } },
  projectId: string,
  gateKey: string,
): Promise<number> {
  const envs = (
    await c.query<{ id: string }>(
      `SELECT e.id FROM environments e
        WHERE e.project_id = $1 AND e.deploy_on_gate = $2
          AND NOT EXISTS (SELECT 1 FROM deploy_runs d WHERE d.environment_id = e.id AND d.status IN ('queued', 'running'))
        ORDER BY e.position`,
      [projectId, gateKey],
    )
  ).rows;
  for (const e of envs) await queueDeploy(c, a, e.id, '', 'gate:' + gateKey);
  return envs.length;
}

interface EnvState {
  name: string;
  last_ok: string | null;
  last_ok_at: Date | null;
  health_url: string;
  health_ok: boolean;
}

/** After a deploy ends: ticks G2's criteria when the project's deploys now show them met. */
export async function afterDeploy(
  c: PoolClient,
  workspaceId: string,
  actor: Actor,
  projectId: string,
): Promise<string[]> {
  const envs = (
    await c.query<EnvState>(
      `SELECT e.name, e.health_url, last.id AS last_ok, last.finished_at AS last_ok_at,
              coalesce((SELECT st.status = 'ok' FROM deploy_steps st
                         WHERE st.run_id = last.id AND st.name = 'Health check'), false) AS health_ok
         FROM environments e
         LEFT JOIN LATERAL (SELECT d.id, d.finished_at FROM deploy_runs d
                             WHERE d.environment_id = e.id AND d.status = 'succeeded'
                             ORDER BY d.finished_at DESC LIMIT 1) last ON true
        WHERE e.project_id = $1 ORDER BY e.position`,
      [projectId],
    )
  ).rows;
  if (!envs.length) return [];
  const ticked: string[] = [];
  const when = (d: Date | null): string =>
    d ? d.toISOString().slice(0, 16).replace('T', ' ') : '';
  const tick = async (criterion: string, evidence: string): Promise<void> => {
    const r = await c.query(
      `UPDATE gate_criteria SET met = true, evidence = $4, met_by = NULL, met_at = now()
        WHERE project_id = $1 AND gate_key = $2 AND criterion_key = $3 AND NOT met`,
      [projectId, ENV_GATE, criterion, evidence.slice(0, 2000)],
    );
    if (!r.rowCount) return;
    ticked.push(criterion);
    const p = (
      await c.query<{ key: string }>('SELECT key FROM projects WHERE id = $1', [projectId])
    ).rows[0];
    await recordEvent(
      c,
      workspaceId,
      {
        actor,
        verb: 'updated',
        object: { type: 'gate', id: projectId + ':' + ENV_GATE, label: (p?.key ?? '') + ' G2' },
        parent: { type: 'project', id: projectId, label: p?.key ?? '' },
        changes: { criterion: { from: null, to: criterion } },
      },
      { projectId },
    );
  };
  if (envs.every((e) => e.last_ok))
    await tick(
      'provisioned',
      'Deployed: ' +
        envs
          .map(
            (e) =>
              e.name +
              ' (deploy ' +
              (e.last_ok ?? '').slice(0, 8) +
              ', ' +
              when(e.last_ok_at) +
              ')',
          )
          .join('; '),
    );
  if (envs.every((e) => e.last_ok && e.health_url && e.health_ok))
    await tick(
      'verified',
      'Health checks passed: ' + envs.map((e) => e.name + ' ' + e.health_url).join('; '),
    );
  return ticked;
}
