// ── [PCODE-321 | S15 | v0.1.0] T32.6 Secrets in the Git history, SARIF upload in the web app, dependency facts on findings ──
//    Why:  a SARIF upload's result properties fill the finding's CVE, package and versions, which the CVE
//          alerts and fix pull requests read; a scan without them leaves what a person entered.
import { toSarif } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('dependency facts on findings (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const finding = {
    rule: 'GHSA-35jh-r3h4-6jhm',
    severity: 'high' as const,
    title: 'lodash@4.17.20: Command injection in template',
    message: 'Upgrade lodash.',
    file: 'package-lock.json',
    line: null,
    fingerprint: 'lodash-4.17.20-GHSA-35jh',
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('fills the finding’s facts from the scan and keeps them when a later scan has none', async () => {
    const up = await t.call(ada, 'POST', W('/projects/' + project + '/scans'), {
      sarif: toSarif('pe-deps', '0.1.0', [
        {
          ...finding,
          facts: {
            cve: 'cve-2021-23337',
            package: 'lodash',
            version: '4.17.20',
            fixedVersion: '4.17.21',
            cvss: 7.2,
          },
        },
      ]),
    });
    expect(up.status).toBe(201);
    const list = await t.call<{ id: string }[]>(
      ada,
      'GET',
      W('/projects/' + project + '/findings'),
    );
    const id = list.body[0]?.id ?? '';
    const risk = () =>
      t.call<{
        cve: string;
        package: string;
        packageVersion: string;
        fixedVersion: string;
        cvss: number | null;
      }>(ada, 'GET', W('/findings/' + id + '/risk'));
    expect((await risk()).body).toMatchObject({
      cve: 'CVE-2021-23337',
      package: 'lodash',
      packageVersion: '4.17.20',
      fixedVersion: '4.17.21',
    });
    expect((await risk()).body.cvss).toBeCloseTo(7.2, 5);
    await t.call(ada, 'POST', W('/projects/' + project + '/scans'), {
      sarif: toSarif('pe-deps', '0.1.0', [finding]),
    });
    expect((await risk()).body).toMatchObject({ cve: 'CVE-2021-23337', fixedVersion: '4.17.21' });
  });
});
