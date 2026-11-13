// ── [PCODE-206 | S15 | v0.1.0] T17.4 Release management in the web app: trains, environments with promote and rollback, notes approval, backport, go/no-go notes, changelog ──
//    Why:  the release screens say what the next environment lacks, offer backports only to other lines,
//          and show a train's releases with their go/no-go and deploy; notes count only once approved.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  aheadText,
  backportLines,
  trainLine,
  TrainTable,
  type PipelineEnv,
  type TrainView,
} from '../src/v2/releasing.js';
import { goNoGo } from '../src/v2/versions.js';

const env = (name: string, ahead: PipelineEnv['ahead']): PipelineEnv => ({
  id: name,
  key: name.toLowerCase(),
  name,
  approver: null,
  running: null,
  latest: null,
  waiting: null,
  ahead,
});
const train: TrainView = {
  id: 't',
  name: 'October',
  state: 'shipping',
  freezeAt: null,
  targetDate: '2026-10-16',
  note: '',
  shippedBy: 'Ada',
  shippedAt: '2026-10-16T10:00:00Z',
  rollbackReason: '',
  releases: [
    {
      releaseId: 'a',
      projectId: 'p1',
      projectKey: 'API',
      projectName: 'Api',
      version: '2.0.0',
      state: 'released',
      environmentId: 'e',
      environmentName: 'Production',
      items: 3,
      done: 3,
      deploy: { id: 'd', status: 'failed', ref: '2.0.0' },
    },
    {
      releaseId: 'b',
      projectId: 'p2',
      projectKey: 'APP',
      projectName: 'App',
      version: '2.0.0',
      state: 'released',
      environmentId: null,
      environmentName: null,
      items: 2,
      done: 1,
      deploy: null,
    },
  ],
};

describe('release screens', () => {
  it('says what the next environment does not have yet', () => {
    expect(
      aheadText(
        env('Staging', { versions: ['1.4.0', '1.4.1'], tasks: 11, fixes: 3 }),
        env('Production', { versions: [], tasks: 0, fixes: 0 }),
      ),
    ).toBe('11 tasks and 3 fixes are on Staging but not in Production (1.4.0, 1.4.1).');
    expect(
      aheadText(
        env('Staging', { versions: ['1.4.1'], tasks: 0, fixes: 1 }),
        env('Production', { versions: [], tasks: 0, fixes: 0 }),
      ),
    ).toBe('1 fix is on Staging but not in Production (1.4.1).');
    expect(
      aheadText(
        env('Staging', { versions: [], tasks: 0, fixes: 0 }),
        env('Production', { versions: [], tasks: 0, fixes: 0 }),
      ),
    ).toBeNull();
  });

  it('offers backports to other lines only, newest first', () => {
    expect(backportLines('1.4.0', ['1.3.8', '1.2.0', '1.4.0', '1.3.7', '0.9.1'])).toEqual([
      '1.3',
      '1.2',
      '0.9',
    ]);
  });

  it('shows a train with go/no-go and deploys', () => {
    expect(trainLine(train)).toBe('API 2.0.0 · APP 2.0.0 · ships 16.10.2026');
    const html = renderToString(
      <TrainTable
        train={train}
        check={{
          ready: false,
          releases: [
            { project: 'APP', version: '2.0.0', ready: false, missing: ['1 task is not done'] },
          ],
        }}
        go={() => undefined}
      />,
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('2.0.0 failed');
    expect(html).toContain('1 task is not done');
    expect(html).toContain('not set');
  });

  it('counts the notes only once a person approved them', () => {
    const rel = {
      id: 'r',
      version: '1.0.0',
      name: '',
      train: '',
      hotfixOf: null,
      state: 'planned',
      freezeAt: null,
      frozen: false,
      targetDate: null,
      notesTeam: 'x',
      notesClient: 'y',
      environmentName: null,
      releasedBy: null,
      releasedAt: null,
      items: 0,
      done: 0,
    };
    const base = {
      items: [],
      tests: { cases: 0, passing: 0, failing: 0, untested: 0 },
      findings: { critical: 0, high: 0, medium: 0, low: 0 },
      flags: [],
      suggested: '1.0.0',
      previous: null,
    };
    expect(
      goNoGo({ ...base, release: rel }, null).find((c) => c.label === 'Release notes approved'),
    ).toMatchObject({ ok: false, detail: 'written, waiting for approval' });
    expect(
      goNoGo(
        {
          ...base,
          release: { ...rel, notesApprovedBy: 'Mara', notesApprovedAt: '2026-10-09T09:50:00Z' },
        },
        null,
      ).find((c) => c.label === 'Release notes approved'),
    ).toMatchObject({ ok: true, detail: 'by Mara, 9.10.2026' });
  });
});
