// ── [PCODE-314 | S15 | v0.1.0] T32.2 Runs: assignment and workload, keyboard entry, timers, reopen when the defect is done ──
// ── [PCODE-178 | S15 | v0.1.0] B4.4 Versions tab and Releases page live in the web app: pull requests, releases with go/no-go, notes, flags, DORA, overview ──
// ── [PCODE-177 | S15 | v0.1.0] B4.3 Test tab live in the web app: runs with matrix, steps, evidence, defects, repository, coverage, flaky, AI cases ──
// ── [PCODE-175 | S15 | v0.1.0] B4.1 Test and Versions on the server: suites, steps, configs, evidence, flaky, Playwright, pull requests, releases, notes, flags, DORA ──
//    Why:  the test lab and versions through the API against PostgreSQL: cases with steps and versions,
//          runs planned per configuration, step results pinned to a version, evidence and a defect filed
//          from a failure, flaky detection and quarantine, run comparison, a Playwright import; pull
//          requests from signed webhooks; releases from plan to shipped with their notes; flags; DORA.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flagStale, sizeOf } from '../../src/api/versions.js';
import { sign } from '../../src/git/webhook.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('version rules', () => {
  it('sizes pull requests and finds stale flags', () => {
    expect([sizeOf(5), sizeOf(50), sizeOf(300), sizeOf(800), sizeOf(5000)]).toEqual([
      'XS',
      'S',
      'M',
      'L',
      'XL',
    ]);
    const old = new Date(Date.now() - 40 * 86_400_000);
    expect(flagStale({ staging: true, production: true }, old)).toBe(true);
    expect(flagStale({ staging: true, production: false }, old)).toBe(false);
    expect(flagStale({ staging: true }, new Date())).toBe(false);
  });
});

describe.skipIf(!hasDatabase)('test lab and versions (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const id: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const states: Record<string, string> = {};

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'REL', name: 'Releases' })
    ).body.id;
    for (const s of (await t.call<{ states: { id: string; group: string }[] }>(ada, 'GET', P('')))
      .body.states)
      states[s.group] ??= s.id;
    id['story'] = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), {
        title: 'Live tracking',
        kind: 'story',
        stateId: states['completed'],
      })
    ).body.id;
    id['bug'] = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), {
        title: 'Map loads twice',
        kind: 'bug',
        stateId: states['completed'],
      })
    ).body.id;
    id['case'] = (
      await t.call<{ id: string }>(ada, 'POST', P('/test-cases'), {
        title: 'Customer sees the truck',
        itemId: id['story'],
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('gives a case a suite, steps and a version that grows when the steps change', async () => {
    const d = await t.call<{ version: number; steps: unknown[]; suite: string }>(
      ada,
      'PATCH',
      W('/test-cases/' + (id['case'] ?? '') + '/design'),
      {
        suite: 'Tracking / Map',
        kind: 'manual',
        steps: [
          { action: 'Open the tracking link', expected: 'The map shows' },
          { action: 'Wait ten seconds', expected: 'The truck moves' },
        ],
        parameters: { browser: ['chromium', 'webkit'] },
      },
    );
    expect(d.body).toMatchObject({ version: 2, suite: 'Tracking / Map' });
    const same = await t.call<{ version: number }>(
      ada,
      'PATCH',
      W('/test-cases/' + (id['case'] ?? '') + '/design'),
      { suite: 'Tracking / Map' },
    );
    expect(same.body.version).toBe(2);
    expect(
      (
        await t.call(ada, 'PATCH', W('/test-cases/' + (id['case'] ?? '') + '/design'), {
          parameters: { 'bad key!': ['x'] },
        })
      ).status,
    ).toBe(400);
    const suites = await t.call<{ suite: string; cases: number }[]>(ada, 'GET', P('/test-suites'));
    expect(suites.body).toContainEqual(
      expect.objectContaining({ suite: 'Tracking / Map', cases: 1 }),
    );
  });

  it('plans one run per configuration and records step results pinned to the case version', async () => {
    const runs = await t.call<{ id: string; name: string }[]>(ada, 'POST', P('/test-runs/plan'), {
      name: 'Release check',
      suite: 'Tracking',
      configs: [{ browser: 'chromium' }, { browser: 'webkit', device: 'iPhone 15' }],
    });
    expect(runs.status).toBe(201);
    expect(runs.body.map((r) => r.name)).toEqual([
      'Release check (chromium)',
      'Release check (webkit · iPhone 15)',
    ]);
    id['run1'] = runs.body[0]?.id ?? '';
    id['run2'] = runs.body[1]?.id ?? '';
    const plan = await t.call<{
      config: Record<string, string>;
      cases: { caseId: string; status: string; steps: unknown[] }[];
    }>(ada, 'GET', W('/test-runs/' + (id['run2'] ?? '') + '/plan'));
    expect(plan.body.config).toEqual({ browser: 'webkit', device: 'iPhone 15' });
    expect(plan.body.cases).toMatchObject([{ caseId: id['case'], status: 'untested' }]);
    expect(
      (
        await t.call(
          ada,
          'PUT',
          W('/test-runs/' + (id['run1'] ?? '') + '/cases/' + (id['case'] ?? '')),
          {
            status: 'passed',
            steps: [{ status: 'passed' }],
          },
        )
      ).status,
    ).toBe(400);
    await t.call(
      ada,
      'PUT',
      W('/test-runs/' + (id['run1'] ?? '') + '/cases/' + (id['case'] ?? '')),
      {
        status: 'passed',
        steps: [{ status: 'passed' }, { status: 'passed' }],
      },
    );
    await t.call(
      ada,
      'PUT',
      W('/test-runs/' + (id['run2'] ?? '') + '/cases/' + (id['case'] ?? '')),
      {
        status: 'failed',
        steps: [{ status: 'passed' }, { status: 'failed', note: 'Truck frozen on Safari' }],
        message: 'Position never updates',
      },
    );
    expect(
      (
        await t.call<{ assignments: Record<string, string> }>(
          ada,
          'PUT',
          W('/test-runs/' + (id['run2'] ?? '') + '/assign'),
          { caseId: id['case'], userId: ada.id },
        )
      ).body.assignments,
    ).toEqual({ [id['case'] ?? '']: ada.id });
    const after = await t.call<{
      cases: {
        status: string;
        ranVersion: number;
        stepResults: { status: string }[];
        assigneeName: string;
      }[];
    }>(ada, 'GET', W('/test-runs/' + (id['run2'] ?? '') + '/plan'));
    expect(after.body.cases[0]).toMatchObject({
      status: 'failed',
      ranVersion: 2,
      assigneeName: 'Ada',
      stepResults: [{ status: 'passed' }, { status: 'failed' }],
    });
  });

  it('keeps evidence and files a defect with the steps, which unblocks the case when it is done', async () => {
    const up = await fetch(t.base + W('/files?name=safari.png&projectId=' + project), {
      method: 'POST',
      headers: { cookie: ada.cookie, 'content-type': 'image/png' },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    const file = ((await up.json()) as { id: string }).id;
    const ev = await t.call<{ kind: string; step: number }>(
      ada,
      'POST',
      W('/test-runs/' + (id['run2'] ?? '') + '/cases/' + (id['case'] ?? '') + '/evidence'),
      { fileId: file, step: 2 },
    );
    expect(ev.body).toMatchObject({ kind: 'screenshot', step: 2 });
    const bug = await t.call<{ itemId: string; ref: string }>(
      ada,
      'POST',
      W('/test-runs/' + (id['run2'] ?? '') + '/cases/' + (id['case'] ?? '') + '/defect'),
      { blocked: true },
    );
    expect(bug.status).toBe(201);
    const item = await t.call<{ kind: string; description: string; title: string }>(
      ada,
      'GET',
      W('/items/' + bug.body.itemId),
    );
    expect(item.body).toMatchObject({ kind: 'bug', title: 'Fails: Customer sees the truck' });
    expect(item.body.description).toContain(
      '2. Wait ten seconds → expected: The truck moves ← fails here: Truck frozen on Safari',
    );
    expect(item.body.description).toContain('screenshot: safari.png (step 2)');
    expect(
      (
        await t.call(
          ada,
          'POST',
          W('/test-runs/' + (id['run2'] ?? '') + '/cases/' + (id['case'] ?? '') + '/defect'),
          {},
        )
      ).status,
    ).toBe(409);
    await t.call(ada, 'PATCH', W('/items/' + bug.body.itemId), { stateId: states['completed'] });
    // [PCODE-314 | S15 | v0.1.0] the done defect reopens the case: it is to run again, the run says why
    const plan = await t.call<{
      cases: {
        status: string;
        reopenedBy: string | null;
        defectRef: string | null;
        evidence: number;
      }[];
    }>(ada, 'GET', W('/test-runs/' + (id['run2'] ?? '') + '/plan'));
    expect(plan.body.cases[0]).toMatchObject({
      status: 'untested',
      reopenedBy: bug.body.ref,
      defectRef: null,
      evidence: 1,
    });
    // [PCODE-177 | S15 | v0.1.0] the Test tab's Bugs view and repository columns
    const bugs = await t.call<
      { ref: string; stateGroup: string; caseId: string; result: string }[]
    >(ada, 'GET', P('/test-defects'));
    expect(bugs.body).toMatchObject([
      { ref: bug.body.ref, stateGroup: 'completed', caseId: id['case'], result: 'reopened' },
    ]);
    const cases = await t.call<{ id: string; suite: string; kind: string; version: number }[]>(
      ada,
      'GET',
      P('/test-cases'),
    );
    expect(cases.body.find((c) => c.id === id['case'])).toMatchObject({
      suite: 'Tracking / Map',
      kind: 'manual',
      version: 2,
    });
  });

  it('compares runs, finds flaky cases and quarantines them with a reason', async () => {
    // [PCODE-314 | S15 | v0.1.0] the blocked case was reopened when its defect was done: not run in run 2
    const cmp = await t.call<{ broken: number; changes: { from: string; to: string | null }[] }>(
      ada,
      'GET',
      W('/test-run-comparison?a=' + (id['run1'] ?? '') + '&b=' + (id['run2'] ?? '')),
    );
    expect(cmp.body).toMatchObject({ broken: 0, changes: [{ from: 'passed', to: null }] });
    for (const status of ['failed', 'passed', 'failed', 'passed']) {
      const r =
        (
          await t.call<{ id: string }[]>(ada, 'POST', P('/test-runs/plan'), {
            name: 'Nightly',
            caseIds: [id['case']],
          })
        ).body[0]?.id ?? '';
      await t.call(ada, 'PUT', W('/test-runs/' + r + '/cases/' + (id['case'] ?? '')), { status });
    }
    const health = await t.call<{ flaky: { caseId: string; quarantined: boolean }[] }>(
      ada,
      'GET',
      P('/test-health'),
    );
    expect(health.body.flaky).toEqual([
      expect.objectContaining({ caseId: id['case'], quarantined: false }),
    ]);
    expect(
      (
        await t.call(ada, 'POST', W('/test-cases/' + (id['case'] ?? '') + '/quarantine'), {
          on: true,
        })
      ).status,
    ).toBe(400);
    const q = await t.call<{ quarantined: boolean }>(
      ada,
      'POST',
      W('/test-cases/' + (id['case'] ?? '') + '/quarantine'),
      { on: true, note: 'Flakes on the map tiles' },
    );
    expect(q.body.quarantined).toBe(true);
  });

  it('imports a Playwright report as a finished run with new automated cases', async () => {
    const report = {
      suites: [
        {
          title: 'login.spec.ts',
          specs: [
            {
              title: 'signs in',
              tests: [{ projectName: 'chromium', results: [{ status: 'passed', duration: 812 }] }],
            },
            {
              title: 'locks out',
              tests: [
                {
                  projectName: 'chromium',
                  results: [{ status: 'failed', duration: 90, error: { message: 'expected 423' } }],
                },
              ],
            },
          ],
        },
      ],
    };
    const r = await t.call<{
      created: number;
      results: number;
      run: { status: string; passed: number; failed: number };
    }>(ada, 'POST', P('/test-runs/import'), { format: 'playwright', report });
    expect(r.body).toMatchObject({
      created: 2,
      results: 2,
      run: { status: 'done', passed: 1, failed: 1 },
    });
    const again = await t.call<{ created: number }>(ada, 'POST', P('/test-runs/import'), {
      format: 'playwright',
      report,
    });
    expect(again.body.created).toBe(0);
    expect(
      (await t.call(ada, 'POST', P('/test-runs/import'), { format: 'playwright', report: {} }))
        .status,
    ).toBe(400);
  });

  it('records pull requests, reviews and checks from signed webhooks', async () => {
    const conn = await t.call<{ connection: { webhookPath: string }; secret: string }>(
      ada,
      'POST',
      P('/git'),
      { provider: 'github', repo: 'acme/rel' },
    );
    const deliver = async (event: string, payload: unknown): Promise<number> => {
      const body = Buffer.from(JSON.stringify(payload));
      const res = await fetch(t.base + conn.body.connection.webhookPath, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-github-event': event,
          'x-hub-signature-256': 'sha256=' + sign(conn.body.secret, body),
        },
        body,
      });
      return res.status;
    };
    const repository = { full_name: 'acme/rel' };
    const pr = (extra: Record<string, unknown> = {}) => ({
      number: 7,
      title: 'REL-1 live tracking',
      html_url: 'https://github.example/acme/rel/pull/7',
      state: 'open',
      user: { login: 'ada' },
      head: { ref: 'feature/rel-1', sha: 'abc1234' },
      base: { ref: 'main' },
      additions: 240,
      deletions: 30,
      changed_files: 6,
      created_at: '2026-09-15T08:00:00Z',
      updated_at: '2026-09-16T09:00:00Z',
      ...extra,
    });
    expect(
      await deliver('pull_request', { action: 'opened', pull_request: pr(), repository }),
    ).toBe(200);
    await deliver('pull_request_review', {
      review: { state: 'APPROVED' },
      pull_request: pr(),
      repository,
    });
    await deliver('check_suite', {
      check_suite: { head_sha: 'abc1234', status: 'completed', conclusion: 'failure' },
      repository,
    });
    const list = await t.call<
      {
        number: number;
        size: string;
        reviewState: string;
        checksState: string;
        itemRef: string;
        stale: boolean;
      }[]
    >(ada, 'GET', P('/pull-requests'));
    expect(list.body[0]).toMatchObject({
      number: 7,
      size: 'M',
      reviewState: 'approved',
      checksState: 'failing',
      itemRef: 'REL-1',
      stale: true,
    });
    await deliver('pull_request', {
      action: 'closed',
      pull_request: pr({
        state: 'closed',
        merged: true,
        merged_at: '2026-10-02T09:00:00Z',
        head: { ref: 'feature/rel-1', sha: 'abc1234' },
      }),
      repository,
    });
    expect((await t.call<unknown[]>(ada, 'GET', P('/pull-requests'))).body).toHaveLength(0);
    expect(
      (await t.call<{ state: string }[]>(ada, 'GET', P('/pull-requests?state=all'))).body[0]?.state,
    ).toBe('merged');
  });

  it('takes a release from plan to shipped: suggested version, freeze, notes, rollback', async () => {
    const list = await t.call<{ suggested: string; unreleased: number }>(
      ada,
      'GET',
      P('/releases'),
    );
    expect(list.body).toMatchObject({ suggested: '0.1.0', unreleased: 3 });
    const rel = await t.call<{ id: string; version: string }>(ada, 'POST', P('/releases'), {
      name: 'Pilot',
    });
    expect(rel.body.version).toBe('0.1.0');
    expect((await t.call(ada, 'POST', P('/releases'), { version: '0.1.0' })).status).toBe(409);
    await t.call(ada, 'POST', W('/releases/' + rel.body.id + '/items'), { itemIds: [id['story']] });
    await t.call(ada, 'POST', W('/releases/' + rel.body.id + '/freeze'));
    expect(
      (
        await t.call(ada, 'POST', W('/releases/' + rel.body.id + '/items'), {
          itemIds: [id['story']],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await t.call(ada, 'POST', W('/releases/' + rel.body.id + '/items'), {
          itemIds: [id['bug']],
        })
      ).status,
    ).toBe(200);
    const contents = await t.call<{
      items: { ref: string }[];
      tests: { cases: number };
      suggested: string;
    }>(ada, 'GET', W('/releases/' + rel.body.id));
    expect(contents.body.items.map((i) => i.ref)).toEqual(['REL-2', 'REL-1']);
    expect(contents.body.tests.cases).toBe(1);
    const shipped = await t.call<{ state: string; notesTeam: string; notesClient: string }>(
      ada,
      'POST',
      W('/releases/' + rel.body.id + '/release'),
    );
    expect(shipped.body.state).toBe('released');
    expect(shipped.body.notesTeam).toContain('- REL-1 Live tracking');
    expect(shipped.body.notesClient).toContain('## Fixed\n\n- Map loads twice');
    expect(shipped.body.notesClient).not.toContain('REL-');
    expect(
      (
        await t.call<{ version: string }[]>(
          ada,
          'GET',
          W('/items/' + (id['bug'] ?? '') + '/releases'),
        )
      ).body.map((r) => r.version),
    ).toEqual(['0.1.0']);
    const next = await t.call<{ lastReleased: string; suggested: string }>(
      ada,
      'GET',
      P('/releases'),
    );
    expect(next.body.lastReleased).toBe('0.1.0');
    const hot = await t.call<{ version: string }>(ada, 'POST', P('/releases'), {
      hotfixOf: rel.body.id,
    });
    expect(hot.body.version).toBe('0.1.1');
    // [PCODE-178 | S15 | v0.1.0] the suggestion never names a version that exists already
    expect(
      (await t.call<{ suggested: string }>(ada, 'GET', P('/releases'))).body.suggested,
    ).not.toBe('0.1.1');
    // [PCODE-178 | S15 | v0.1.0] the Releases page: the next release and what is live, per project
    const overview = await t.call<
      {
        key: string;
        next: { version: string } | null;
        lastReleased: { version: string } | null;
        planned: number;
      }[]
    >(ada, 'GET', W('/release-overview'));
    expect(overview.body.find((r) => r.key === 'REL')).toMatchObject({
      next: { version: '0.1.1' },
      lastReleased: { version: '0.1.0' },
      planned: 1,
    });
    expect(
      (await t.call(ada, 'POST', W('/releases/' + rel.body.id + '/rollback'), {})).status,
    ).toBe(400);
    const back = await t.call<{ state: string; notesTeam: string }>(
      ada,
      'POST',
      W('/releases/' + rel.body.id + '/rollback'),
      { reason: 'Tracking leaked positions' },
    );
    expect(back.body.state).toBe('rolled_back');
  });

  it('keeps feature flags per environment and measures DORA', async () => {
    await t.call(ada, 'POST', P('/environments'), {
      key: 'production',
      name: 'Production',
      kind: 'compose',
      settings: { dir: '/srv/app' },
    });
    expect(
      (await t.call(ada, 'POST', P('/flags'), { key: 'live-map', enabled: { moon: true } })).status,
    ).toBe(400);
    const f = await t.call<{ id: string; enabled: Record<string, boolean>; stale: boolean }>(
      ada,
      'POST',
      P('/flags'),
      { key: 'live-map', itemId: id['story'], enabled: { production: false } },
    );
    expect(f.body).toMatchObject({ enabled: { production: false }, stale: false });
    const on = await t.call<{ enabled: Record<string, boolean> }>(
      ada,
      'PATCH',
      W('/flags/' + f.body.id),
      { enabled: { production: true } },
    );
    expect(on.body.enabled).toEqual({ production: true });
    const d = await t.call<{
      environment: { name: string };
      deploysPerWeek: number;
      changeFailureRate: number | null;
      leadTimeHours: number | null;
    }>(ada, 'GET', P('/dora?days=30'));
    expect(d.body).toMatchObject({
      environment: { name: 'Production' },
      deploysPerWeek: 0,
      changeFailureRate: null,
    });
    expect(d.body.leadTimeHours).not.toBeNull();
  });
});
