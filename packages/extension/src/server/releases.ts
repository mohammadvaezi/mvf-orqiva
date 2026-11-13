// ── [PCODE-207 | S15 | v0.1.0] T17.5 Releases from the terminal and VS Code: orq release, orq env, orq train ──
//    Why:  from the editor, the project's environments in one quick pick: what runs where, and the next
//          step for each (promote to the next one, decide a waiting promotion, roll back). The server
//          decides who may approve; the pick only offers the action.
import type { Api } from '../../../cli/src/loop/api';

export interface ReleaseSource {
  api: Api;
  workspaceId: string;
  projectId: string;
}

export interface PipelineJson {
  id: string;
  key: string;
  name: string;
  approver: { name: string } | null;
  running: { ref: string } | null;
  latest: { status: string; ref: string } | null;
  waiting: { id: string; ref: string; approver: string | null } | null;
}

export type ReleasePick =
  | { label: string; description: string; action: 'none' }
  | { label: string; description: string; action: 'promote'; envId: string }
  | { label: string; description: string; action: 'approve' | 'decline'; promotionId: string }
  | { label: string; description: string; action: 'rollback'; envId: string };

/** What can be done per environment, in pipeline order. */
export function releasePicks(envs: readonly PipelineJson[]): ReleasePick[] {
  const out: ReleasePick[] = [];
  envs.forEach((e, i) => {
    out.push({
      label: '$(server-environment) ' + e.name,
      description:
        (e.running?.ref ?? 'nothing running') +
        (e.latest?.status === 'failed' ? ' · last deploy failed' : '') +
        (e.approver ? ' · ' + e.approver.name + ' approves' : ''),
      action: 'none',
    });
    const next = envs[i + 1];
    if (e.waiting) {
      out.push({
        label: '$(check) Approve ' + e.waiting.ref + ' to ' + e.name,
        description: (e.waiting.approver ?? 'an admin') + ' decides',
        action: 'approve',
        promotionId: e.waiting.id,
      });
      out.push({
        label: '$(close) Decline ' + e.waiting.ref + ' to ' + e.name,
        description: 'with a note',
        action: 'decline',
        promotionId: e.waiting.id,
      });
    }
    if (next && e.running && !next.waiting && next.running?.ref !== e.running.ref)
      out.push({
        label: '$(arrow-right) Promote ' + e.running.ref + ' to ' + next.name,
        description: next.approver ? next.approver.name + ' approves first' : 'deploys at once',
        action: 'promote',
        envId: next.id,
      });
    if (e.latest)
      out.push({
        label: '$(history) Roll back ' + e.name,
        description: 'to what ran there before',
        action: 'rollback',
        envId: e.id,
      });
  });
  return out;
}

const W = (s: ReleaseSource, p: string): string => '/api/workspaces/' + s.workspaceId + p;

export const pipelineOf = (s: ReleaseSource): Promise<PipelineJson[]> =>
  s.api.call<PipelineJson[]>('GET', W(s, '/projects/' + s.projectId + '/pipeline'));

/** Runs the picked action; returns what to tell the developer. */
export async function runPick(s: ReleaseSource, pick: ReleasePick, text: string): Promise<string> {
  if (pick.action === 'promote') {
    const p = await s.api.call<{ status: string; ref: string; approver: string | null }>(
      'POST',
      W(s, '/environments/' + pick.envId + '/promote'),
      {},
    );
    return p.status === 'requested'
      ? 'Promotion of ' + p.ref + ' requested: ' + (p.approver ?? 'an admin') + ' approves.'
      : p.ref + ' deploys with the runner.';
  }
  if (pick.action === 'approve' || pick.action === 'decline') {
    await s.api.call('POST', W(s, '/promotions/' + pick.promotionId + '/decision'), {
      approve: pick.action === 'approve',
      ...(text.trim() ? { note: text.trim() } : {}),
    });
    return pick.action === 'approve' ? 'Approved: the runner deploys it.' : 'Declined.';
  }
  if (pick.action === 'rollback') {
    const r = await s.api.call<{ ref: string; from: string }>(
      'POST',
      W(s, '/environments/' + pick.envId + '/rollback'),
      { reason: text.trim() },
    );
    return 'Rolling back from ' + r.from + ' to ' + r.ref + '.';
  }
  return '';
}
