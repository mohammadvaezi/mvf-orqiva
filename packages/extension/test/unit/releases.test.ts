// ── [PCODE-207 | S15 | v0.1.0] T17.5 Releases from the terminal and VS Code: orq release, orq env, orq train ──
//    Why:  the quick pick offers per environment what can be done next, and each action sends the right call.
import { describe, expect, it } from 'vitest';
import type { Api } from '../../../cli/src/loop/api';
import { releasePicks, runPick, type PipelineJson } from '../../src/server/releases';

const envs: PipelineJson[] = [
  {
    id: 'e1',
    key: 'staging',
    name: 'Staging',
    approver: null,
    running: { ref: '1.4.0' },
    latest: { status: 'succeeded', ref: '1.4.0' },
    waiting: null,
  },
  {
    id: 'e2',
    key: 'production',
    name: 'Production',
    approver: { name: 'Bob' },
    running: { ref: '1.3.8' },
    latest: { status: 'succeeded', ref: '1.3.8' },
    waiting: null,
  },
];

describe('releases in VS Code', () => {
  it('offers promote, roll back and decisions', () => {
    expect(releasePicks(envs).map((p) => [p.label, p.action])).toEqual([
      ['$(server-environment) Staging', 'none'],
      ['$(arrow-right) Promote 1.4.0 to Production', 'promote'],
      ['$(history) Roll back Staging', 'rollback'],
      ['$(server-environment) Production', 'none'],
      ['$(history) Roll back Production', 'rollback'],
    ]);
    const waiting = releasePicks([
      envs[0] as PipelineJson,
      { ...(envs[1] as PipelineJson), waiting: { id: 'pm', ref: '1.4.0', approver: 'Bob' } },
    ]);
    expect(waiting.map((p) => p.action)).toEqual([
      'none',
      'rollback',
      'none',
      'approve',
      'decline',
      'rollback',
    ]);
  });

  it('sends the decision and the rollback reason', async () => {
    const calls: [string, string, unknown][] = [];
    const api: Api = {
      call: <T>(method: string, path: string, body?: unknown): Promise<T> => {
        calls.push([method, path, body]);
        return Promise.resolve({ ref: '1.3.7', from: '1.3.8' } as T);
      },
    };
    const src = { api, workspaceId: 'w', projectId: 'p' };
    expect(
      await runPick(
        src,
        { label: '', description: '', action: 'decline', promotionId: 'pm' },
        'not today',
      ),
    ).toBe('Declined.');
    expect(calls[0]).toEqual([
      'POST',
      '/api/workspaces/w/promotions/pm/decision',
      { approve: false, note: 'not today' },
    ]);
    expect(
      await runPick(src, { label: '', description: '', action: 'rollback', envId: 'e2' }, 'broken'),
    ).toBe('Rolling back from 1.3.8 to 1.3.7.');
    expect(calls[1]).toEqual([
      'POST',
      '/api/workspaces/w/environments/e2/rollback',
      { reason: 'broken' },
    ]);
  });
});
