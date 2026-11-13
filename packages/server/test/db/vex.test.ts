// ── [PCODE-323 | S15 | v0.1.0] T32.7b VEX statements and the security posture per version ──
//    Why:  a version's vulnerabilities come from its own SBOM (the next version, upgraded, has none); a
//          statement that it is not affected needs a reason, sets the vulnerability aside and lifts the
//          version's score; the statements download as OpenVEX with the packages' purls.
import { toSarif } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface Version {
  version: string;
  vulnerabilities: number;
  open: Record<string, number>;
  setAside: number;
  undecided: number;
  score: number | null;
  hasSbom: boolean;
}

describe.skipIf(!hasDatabase)('VEX and posture per version (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const rel: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const versions = async (): Promise<Version[]> =>
    (await t.call<Version[]>(ada, 'GET', P('/security/versions'))).body;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    await t.call(ada, 'POST', P('/scans'), {
      sarif: toSarif('pe-deps', '0.1.0', [
        {
          rule: 'GHSA-35jh-r3h4-6jhm',
          severity: 'high',
          title: 'lodash@4.17.20: command injection',
          message: '',
          file: 'package-lock.json',
          line: null,
          fingerprint: 'lodash-4.17.20',
          facts: {
            cve: 'CVE-2021-23337',
            package: 'lodash',
            version: '4.17.20',
            fixedVersion: '4.17.21',
          },
        },
      ]),
    });
    for (const [v, lodash, days] of [
      ['1.4.0', '4.17.20', 10],
      ['1.5.0', '4.17.21', 2],
    ] as const) {
      rel[v] = (await t.call<{ id: string }>(ada, 'POST', P('/releases'), { version: v })).body.id;
      await t.call(ada, 'POST', P('/sboms'), {
        document: {
          bomFormat: 'CycloneDX',
          components: [{ name: 'lodash', version: lodash, purl: 'pkg:npm/lodash@' + lodash }],
        },
        releaseId: rel[v],
      });
      await sys(
        "UPDATE releases SET state = 'released', released_at = now() - make_interval(days => $2::int) WHERE id = $1",
        [rel[v], days],
      );
    }
    rel['next'] = (
      await t.call<{ id: string }>(ada, 'POST', P('/releases'), { version: '1.6.0' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('finds a version’s vulnerabilities in its own SBOM', async () => {
    const v = await versions();
    expect(v.map((x) => [x.version, x.hasSbom, x.vulnerabilities, x.undecided])).toEqual([
      ['1.6.0', false, 0, 0],
      ['1.5.0', true, 0, 0],
      ['1.4.0', true, 1, 1],
    ]);
    const old = v.find((x) => x.version === '1.4.0');
    expect(old?.open).toEqual({ critical: 0, high: 1, medium: 0, low: 0 });
    expect(old?.score).toBeLessThan(100);
    expect(v.find((x) => x.version === '1.5.0')?.score).toBe(100);
    expect(v.find((x) => x.version === '1.6.0')?.score).toBeNull();
    const list = await t.call<{ cve: string; purl: string; fixedVersion: string; vex: unknown }[]>(
      ada,
      'GET',
      W('/releases/' + (rel['1.4.0'] ?? '') + '/vulnerabilities'),
    );
    expect(list.body).toEqual([
      expect.objectContaining({
        cve: 'CVE-2021-23337',
        purl: 'pkg:npm/lodash@4.17.20',
        fixedVersion: '4.17.21',
        vex: null,
      }),
    ]);
  });

  it('keeps statements with their reasons, sets the vulnerability aside and exports OpenVEX', async () => {
    const path = W('/releases/' + (rel['1.4.0'] ?? '') + '/vex');
    expect(
      (
        await t.call(ada, 'PUT', path, {
          cve: 'CVE-2021-23337',
          package: 'lodash',
          status: 'not_affected',
        })
      ).status,
    ).toBe(400);
    expect(
      (await t.call(ada, 'PUT', path, { cve: 'CVE-2099-0001', package: 'lodash', status: 'fixed' }))
        .status,
    ).toBe(404);
    const said = await t.call<{ vex: { status: string; justification: string; author: string } }>(
      ada,
      'PUT',
      path,
      {
        cve: 'CVE-2021-23337',
        package: 'LODASH',
        status: 'not_affected',
        justification: 'vulnerable_code_not_in_execute_path',
        note: 'We never call _.template with user input.',
      },
    );
    expect(said.body.vex).toMatchObject({
      status: 'not_affected',
      justification: 'vulnerable_code_not_in_execute_path',
      author: 'Ada',
    });
    const old = (await versions()).find((x) => x.version === '1.4.0');
    expect(old).toMatchObject({ setAside: 1, undecided: 0, score: 100 });
    const doc = await t.call<{
      '@context': string;
      statements: {
        vulnerability: { name: string };
        products: { '@id': string; subcomponents: { '@id': string }[] }[];
        status: string;
        justification: string;
        impact_statement: string;
      }[];
    }>(ada, 'GET', path);
    expect(doc.body['@context']).toBe('https://openvex.dev/ns/v0.2.0');
    expect(doc.body.statements).toEqual([
      expect.objectContaining({
        vulnerability: { name: 'CVE-2021-23337' },
        products: [
          { '@id': 'pkg:generic/shop@1.4.0', subcomponents: [{ '@id': 'pkg:npm/lodash@4.17.20' }] },
        ],
        status: 'not_affected',
        justification: 'vulnerable_code_not_in_execute_path',
        impact_statement: 'We never call _.template with user input.',
      }),
    ]);
    // affected again: it counts once more
    await t.call(ada, 'PUT', path, {
      cve: 'CVE-2021-23337',
      package: 'lodash',
      status: 'affected',
      note: 'Upgrade lodash to 4.17.21.',
    });
    expect((await versions()).find((x) => x.version === '1.4.0')?.setAside).toBe(0);
  });
});
