// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-143 | S15 | v0.1.0] Map compliance controls for ISO 27001, SOC 2, GDPR and the EU CRA to live evidence ──
//    Why:  controls measured from live evidence against the real database: they follow what happens.
import { controlStatus, FRAMEWORKS, toSarif } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('the framework packs', () => {
  it('have unique control ids and only known sources, and combine sources strictly', () => {
    for (const f of FRAMEWORKS) {
      const ids = f.controls.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const c of f.controls) expect(c.sources.length).toBeGreaterThan(0);
    }
    expect(FRAMEWORKS.map((f) => f.key)).toEqual(['iso27001', 'soc2', 'gdpr', 'cra']);
    expect(controlStatus(['met', 'met'], false)).toBe('met');
    expect(controlStatus(['met', 'missing'], false)).toBe('partial');
    expect(controlStatus(['missing'], false)).toBe('missing');
    expect(controlStatus(['missing'], true)).toBe('exempt');
  });
});

describe.skipIf(!hasDatabase)('compliance controls (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Ctl = {
    id: string;
    status: string;
    sources: { source: string; status: string; detail: string }[];
  };
  type Cm = {
    frameworks: { key: string; enabled: boolean; met: number; total: number; controls: Ctl[] }[];
  };
  const cm = async (): Promise<Cm> =>
    (await t.call<Cm>(mo, 'GET', W('/projects/' + project + '/compliance'))).body;
  const ctl = (c: Cm, fw: string, id: string): Ctl | undefined =>
    c.frameworks.find((f) => f.key === fw)?.controls.find((x) => x.id === id);
  const g3 = async () =>
    (
      await t.call<{
        lifecycle: {
          phases: {
            gate?: { key: string; criteria: { key: string; met: boolean; evidence: string }[] };
          }[];
        };
      }>(ada, 'GET', W('/projects/' + project + '/lifecycle'))
    ).body.lifecycle.phases
      .find((p) => p.gate?.key === 'g3')
      ?.gate?.criteria.find((x) => x.key === 'compliance');
  const run = async (status: 'passed' | 'failed') => {
    const r = await t.call<{ id: string }>(mo, 'POST', W('/projects/' + project + '/test-runs'), {
      name: 'Suite',
    });
    await t.call(mo, 'POST', W('/test-runs/' + r.body.id + '/results'), {
      results: [{ key: 'a > b', status }],
    });
    await t.call(mo, 'POST', W('/test-runs/' + r.body.id + '/finish'));
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/lifecycle'), {});
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('measures controls from live evidence and follows it', async () => {
    let c = await cm();
    expect(ctl(c, 'iso27001', 'a8-29')?.status).toBe('missing');
    expect(ctl(c, 'iso27001', 'a5-15')).toMatchObject({ status: 'met' });
    expect(ctl(c, 'iso27001', 'a5-15')?.sources[0]?.detail).toBe('2 members, 1 owners or admins');
    // a clean full scan and a passing run: A.8.29 is met
    await t.call(mo, 'POST', W('/projects/' + project + '/scans'), {
      sarif: toSarif('pe-scan', '0.1.0', []),
      full: true,
    });
    await run('passed');
    c = await cm();
    expect(ctl(c, 'iso27001', 'a8-29')?.status).toBe('met');
    // a failing run turns it back
    await run('failed');
    c = await cm();
    expect(ctl(c, 'iso27001', 'a8-29')).toMatchObject({ status: 'partial' });
    expect(
      ctl(c, 'iso27001', 'a8-29')?.sources.find((x) => x.source === 'tests_passing')?.detail,
    ).toBe('Run "Suite": 1 failing');
  });

  it('takes evidence from people, and exemptions only with a reason from an admin', async () => {
    const body = {
      framework: 'gdpr',
      control: 'art30',
      text: 'Record of processing kept in the wiki',
      url: 'https://wiki.example/ropa',
    };
    expect(
      (await t.call(mo, 'POST', W('/projects/' + project + '/compliance/evidence'), body)).status,
    ).toBe(201);
    expect(ctl(await cm(), 'gdpr', 'art30')?.status).toBe('met');
    expect(
      (
        await t.call(mo, 'POST', W('/projects/' + project + '/compliance/evidence'), {
          ...body,
          control: 'nope',
        })
      ).status,
    ).toBe(400);
    const ex = { framework: 'cra', control: 'ii-5', reason: 'short' };
    expect(
      (await t.call(mo, 'POST', W('/projects/' + project + '/compliance/exemptions'), ex)).status,
    ).toBe(403);
    expect(
      (await t.call(ada, 'POST', W('/projects/' + project + '/compliance/exemptions'), ex)).status,
    ).toBe(400);
    await t.call(ada, 'POST', W('/projects/' + project + '/compliance/exemptions'), {
      ...ex,
      reason: 'Internal tool, not placed on the market',
    });
    expect(ctl(await cm(), 'cra', 'ii-5')?.status).toBe('exempt');
  });

  it('keeps G3’s compliance criterion in step with the enabled frameworks', async () => {
    expect(await g3()).toMatchObject({ met: false, evidence: 'No compliance framework turned on' });
    expect(
      (
        await t.call(mo, 'PUT', W('/projects/' + project + '/compliance/frameworks/gdpr'), {
          enabled: true,
        })
      ).status,
    ).toBe(403);
    const r = await t.call<Cm>(
      ada,
      'PUT',
      W('/projects/' + project + '/compliance/frameworks/gdpr'),
      { enabled: true },
    );
    expect(r.body.frameworks.find((f) => f.key === 'gdpr')?.enabled).toBe(true);
    expect((await g3())?.met).toBe(false);
    // make every GDPR control met or exempt
    for (const id of ['art25', 'art32', 'art33', 'art35'])
      await t.call(ada, 'POST', W('/projects/' + project + '/compliance/exemptions'), {
        framework: 'gdpr',
        control: id,
        reason: 'The product handles no personal data at all',
      });
    await t.call(mo, 'GET', W('/projects/' + project + '/compliance'));
    expect(await g3()).toMatchObject({
      met: true,
      evidence: 'All controls met or not applicable: GDPR (Regulation (EU) 2016/679)',
    });
    await t.call(ada, 'POST', W('/projects/' + project + '/compliance/exemptions'), {
      framework: 'gdpr',
      control: 'art35',
      remove: true,
    });
    expect((await g3())?.met).toBe(false);
  });
});
