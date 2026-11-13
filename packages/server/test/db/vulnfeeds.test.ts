// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
//    Why:  with the feeds off, nothing is read; switched on, the recorded CISA catalog and EPSS answers fill
//          the findings (EPSS asked only for this workspace's CVE ids); a CVE in a package version that a
//          released version's SBOM holds alerts the admins once, and once more when it is found exploited.
import { readFileSync } from 'node:fs';
import { toSarif } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { alertRound } from '../../src/push/alerts.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const fixture = (name: string): string =>
  readFileSync(new URL('../fixtures/feeds/' + name, import.meta.url), 'utf8');

describe.skipIf(!hasDatabase)('vulnerability feeds and CVE alerts (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let kevNow = false;
  const asked: string[] = [];
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const deps = { subject: 'mailto:ops@example.test' };
  const finding = (rule: string, cve: string, pkg: string, version: string) => ({
    rule,
    severity: 'high' as const,
    title: pkg + '@' + version + ': ' + cve,
    message: '',
    file: 'package-lock.json',
    line: null,
    fingerprint: rule + version,
    facts: { cve, package: pkg, version },
  });
  const inbox = async () =>
    (
      await t.call<{ items: { kind: string; title: string }[] }>(ada, 'GET', W('/inbox'))
    ).body.items.filter((i) => i.kind === 'security');

  beforeAll(async () => {
    t = await startTestApp({
      vulnFeeds: {
        kevUrl: 'https://feeds.test/kev.json',
        epssUrl: 'https://feeds.test/epss',
        fetch: (input: string | URL | Request) => {
          const url = input instanceof Request ? input.url : input.toString();
          asked.push(url);
          if (url.endsWith('/kev.json')) {
            const kev = JSON.parse(fixture('kev.json')) as {
              vulnerabilities: Record<string, unknown>[];
            };
            // lodash's CVE joins the catalog later in the test
            if (kevNow)
              kev.vulnerabilities.push({ ...kev.vulnerabilities[0], cveID: 'CVE-2021-23337' });
            return Promise.resolve(new Response(JSON.stringify(kev)));
          }
          return Promise.resolve(new Response(fixture('epss.json')));
        },
      },
    });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    await t.call(ada, 'POST', P('/scans'), {
      sarif: toSarif('pe-deps', '0.1.0', [
        finding('GHSA-35jh-r3h4-6jhm', 'CVE-2021-23337', 'lodash', '4.17.20'),
        finding('GHSA-jfh8-c2jp-5v3q', 'CVE-2021-44228', 'log4j-core', '2.14.1'),
      ]),
    });
    // 1.4.0 shipped with lodash 4.17.20; log4j is in no shipped version
    const rel = (await t.call<{ id: string }>(ada, 'POST', P('/releases'), { version: '1.4.0' }))
      .body.id;
    await t.call(ada, 'POST', P('/sboms'), {
      document: { bomFormat: 'CycloneDX', components: [{ name: 'lodash', version: '4.17.20' }] },
      releaseId: rel,
    });
    await sys("UPDATE releases SET state = 'released', released_at = now() WHERE id = $1", [rel]);
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('reads nothing while the feeds are off', async () => {
    const r = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      W('/security/feeds/refresh'),
    );
    expect(r.status).toBe(409);
    expect(asked).toEqual([]);
  });

  it('fills the findings from the feeds when switched on', async () => {
    await t.call(ada, 'PUT', W('/settings/security.vuln_feeds'), {
      scope: 'workspace',
      value: true,
    });
    const r = await t.call<{ cves: number; kev: number; epss: number; findings: number }>(
      ada,
      'POST',
      W('/security/feeds/refresh'),
    );
    expect(r.body).toEqual({ cves: 2, kev: 1, epss: 2, findings: 2 });
    expect(asked).toEqual([
      'https://feeds.test/kev.json',
      'https://feeds.test/epss?cve=CVE-2021-23337,CVE-2021-44228',
    ]);
    const rows = await sys<{ cve: string; epss: number; kev: boolean }>(
      'SELECT cve, epss, kev FROM findings WHERE project_id = $1 ORDER BY cve',
      [project],
    );
    expect(rows.map((x) => [x.cve, Math.round(x.epss * 1000) / 1000, x.kev])).toEqual([
      ['CVE-2021-23337', 0.011, false],
      ['CVE-2021-44228', 0.944, true],
    ]);
    const status = await t.call<{ on: boolean; cves: number; known: number; exploited: number }>(
      ada,
      'GET',
      W('/security/feeds'),
    );
    expect(status.body).toMatchObject({ on: true, cves: 2, known: 2, exploited: 1 });
  });

  it('alerts once for a CVE in a shipped version, and again when it is exploited', async () => {
    expect((await alertRound(t.db.pool, deps)).cves).toBe(1);
    expect((await alertRound(t.db.pool, deps)).cves).toBe(0);
    let got = await inbox();
    expect(got.map((i) => i.title)).toEqual([
      'CVE-2021-23337 in lodash 4.17.20 is in a shipped version of SHOP',
    ]);
    kevNow = true;
    await t.call(ada, 'POST', W('/security/feeds/refresh'));
    expect((await alertRound(t.db.pool, deps)).cves).toBe(1);
    got = await inbox();
    expect(got.map((i) => i.title)).toContain(
      'Exploited: CVE-2021-23337 in lodash 4.17.20 is in a shipped version of SHOP',
    );
  });
});
