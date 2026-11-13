// ── [PCODE-316 | S15 | v0.1.0] T32.3b Named run sign-off with a frozen snapshot, and a release gate on tests ──
//    Why:  only the named approver signs a finished run off (an admin when nobody is named), once; the
//          snapshot keeps the results as they stood; a release policy with the test rules stops a release
//          whose tests fail, have no result or were never signed off, and lets it go once they are.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface Sign {
  approverId: string | null;
  approverName: string | null;
  signedBy: string | null;
  signedAt: string | null;
  note: string;
  snapshot: {
    totals: Record<string, number>;
    results: { title: string; status: string; version: number; defect: string | null }[];
  } | null;
}

describe.skipIf(!hasDatabase)('run sign-off and the release gate on tests (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let cy: Person;
  let project = '';
  let release = '';
  let run = '';
  const cases: string[] = [];
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const R = (p = ''): string => W('/test-runs/' + run + p);

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    const story = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), { title: 'Cart keeps items' })
    ).body.id;
    for (const title of ['Cart survives a reload', 'Totals round'])
      cases.push(
        (await t.call<{ id: string }>(ada, 'POST', P('/test-cases'), { title, itemId: story })).body
          .id,
      );
    release = (await t.call<{ id: string }>(ada, 'POST', P('/releases'), { version: '1.4.0' })).body
      .id;
    await t.call(ada, 'POST', W('/releases/' + release + '/items'), { itemIds: [story] });
    run =
      (
        await t.call<{ id: string }[]>(ada, 'POST', P('/test-runs/plan'), {
          name: 'Release check',
          caseIds: cases,
          releaseId: release,
        })
      ).body[0]?.id ?? '';
    await t.call(ada, 'POST', W('/policies'), {
      name: 'Tested',
      appliesTo: 'release',
      rule: { testsPass: true, testsSigned: true },
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('stops the release while its tests fail, lack a result or are not signed off', async () => {
    await t.call(ada, 'PUT', R('/cases/' + (cases[0] ?? '')), { status: 'failed' });
    const dry = await t.call<{ passes: boolean; results: { violations: string[] }[] }>(
      ada,
      'POST',
      P('/policies/check'),
      { appliesTo: 'release', releaseId: release },
    );
    expect(dry.body.results[0]?.violations).toEqual([
      '1 test failing',
      '1 test without a result',
      'no test run is signed off',
    ]);
    const ship = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      W('/releases/' + release + '/release'),
      {},
    );
    expect(ship.status).toBe(409);
    expect(ship.body.error.message).toContain('1 test failing');
  });

  it('lets only the named approver sign a finished run off, once, and freezes it', async () => {
    expect((await t.call(ada, 'PUT', R('/approver'), { userId: bob.id })).status).toBe(200);
    await t.call(ada, 'PUT', R('/cases/' + (cases[0] ?? '')), { status: 'passed' });
    await t.call(ada, 'PUT', R('/cases/' + (cases[1] ?? '')), { status: 'passed' });
    expect((await t.call(bob, 'POST', R('/signoff'), {})).status).toBe(409); // still running
    await t.call(ada, 'POST', R('/finish'));
    const notHim = await t.call<{ error: { message: string } }>(cy, 'POST', R('/signoff'), {});
    expect(notHim.status).toBe(403);
    expect(notHim.body.error.message).toBe('Bob signs this run off');
    expect((await t.call(ada, 'POST', R('/signoff'), {})).status).toBe(403); // admin, but Bob is named
    const signed = await t.call<Sign>(bob, 'POST', R('/signoff'), { note: 'Ready for 1.4.0' });
    expect(signed.status).toBe(200);
    expect(signed.body).toMatchObject({
      approverName: 'Bob',
      signedBy: 'Bob',
      note: 'Ready for 1.4.0',
      snapshot: { totals: { planned: 2, passed: 2, failed: 0, untested: 0 } },
    });
    expect(signed.body.snapshot?.results.map((r) => r.title + ' ' + r.status)).toEqual([
      'Cart survives a reload passed',
      'Totals round passed',
    ]);
    expect((await t.call(bob, 'POST', R('/signoff'), {})).status).toBe(409);
    expect((await t.call(ada, 'PUT', R('/approver'), { userId: cy.id })).status).toBe(409);
    // the frozen run takes no more results
    expect(
      (await t.call(ada, 'PUT', R('/cases/' + (cases[0] ?? '')), { status: 'failed' })).status,
    ).toBe(409);
    const read = await t.call<Sign>(cy, 'GET', R('/signoff'));
    expect(read.body.signedAt).not.toBeNull();
  });

  it('ships the release once its tests pass and a run is signed off', async () => {
    const ship = await t.call<{ state: string }>(
      ada,
      'POST',
      W('/releases/' + release + '/release'),
      {},
    );
    expect(ship.status).toBe(200);
    expect(ship.body.state).toBe('released');
  });

  it('lets an admin sign off a run that names nobody', async () => {
    const other =
      (
        await t.call<{ id: string }[]>(ada, 'POST', P('/test-runs/plan'), {
          name: 'Smoke',
          caseIds: [cases[0]],
        })
      ).body[0]?.id ?? '';
    await t.call(ada, 'POST', W('/test-runs/' + other + '/finish'));
    expect((await t.call(bob, 'POST', W('/test-runs/' + other + '/signoff'), {})).status).toBe(403);
    const s = await t.call<Sign>(ada, 'POST', W('/test-runs/' + other + '/signoff'), {});
    expect(s.body).toMatchObject({
      signedBy: 'Ada',
      snapshot: { totals: { planned: 1, untested: 1 } },
    });
  });
});
