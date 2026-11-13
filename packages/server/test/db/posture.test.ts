// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-179 | S15 | v0.1.0] B4.5 Security and Code map live in the web app: posture, findings by risk, SBOM, policies, campaigns, treemap, hotspots, APIs, hygiene ──
// ── [PCODE-176 | S15 | v0.1.0] B4.2 Security and Code map on the server: risk score, workflow, SBOM, policies, campaigns, posture, code files, hotspots, API inventory ──
//    Why:  the Security center and the Code map through the API against PostgreSQL: a finding's risk and
//          workflow, accepting a risk, the posture, SBOMs with their diff and the package exposure of
//          shipped releases, policies in a dry run and as the release gate with an admin override,
//          campaigns, the code scan with its map and hygiene, and the API inventory from OpenAPI.
import { toSarif, type FindingIn } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endpointsOf, folderOf } from '../../src/api/codemap.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const vuln: FindingIn = {
  rule: 'dep/lodash',
  severity: 'high',
  title: 'Prototype pollution in lodash',
  message: 'lodash 4.17.15 is affected',
  file: 'package.json',
  line: 12,
  fingerprint: 'lodash-1',
};
const minor: FindingIn = {
  rule: 'js/weak-hash',
  severity: 'low',
  title: 'MD5 used for a cache key',
  message: 'md5 is weak',
  file: 'src/cache.ts',
  line: 3,
  fingerprint: 'md5-1',
};
const cyclonedx = (lodash: string) => ({
  bomFormat: 'CycloneDX',
  components: [
    { name: 'lodash', version: lodash, licenses: [{ license: { id: 'MIT' } }] },
    { name: 'pg', version: '8.11.0', licenses: [{ license: { id: 'MIT' } }] },
  ],
});

describe('code map rules', () => {
  it('folds paths into folders and reads OpenAPI operations with their auth', () => {
    expect([
      folderOf('src/api/x.ts', 2),
      folderOf('src/api/x.ts', 1),
      folderOf('README.md', 2),
    ]).toEqual(['src/api', 'src', '(root)']);
    expect(
      endpointsOf({
        security: [{ session: [] }],
        paths: {
          '/health': { get: { summary: 'Alive', security: [] } },
          '/orders': { post: { summary: 'Order', tags: ['orders'] }, parameters: [] },
        },
      }),
    ).toEqual([
      { method: 'GET', path: '/health', summary: 'Alive', tag: '', auth: 'none' },
      { method: 'POST', path: '/orders', summary: 'Order', tag: 'orders', auth: 'session' },
    ]);
  });
});

describe.skipIf(!hasDatabase)('security posture and code map (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let project = '';
  const id: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  type Finding = { id: string; rule: string; status: string };
  type Risk = {
    riskScore: number;
    workflow: string;
    status: string;
    slaDueAt: string | null;
    acceptedUntil: string | null;
  };
  const scan = (findings: FindingIn[]) =>
    t.call(mo, 'POST', P('/scans'), { sarif: toSarif('pe-scan', '0.1.0', findings), full: true });
  const findingId = async (rule: string): Promise<string> =>
    (await t.call<Finding[]>(mo, 'GET', P('/findings'))).body.find((f) => f.rule === rule)?.id ??
    '';

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SEC', name: 'Secure' })
    ).body.id;
    await scan([vuln, minor]);
    id['vuln'] = await findingId('dep/lodash');
    id['minor'] = await findingId('js/weak-hash');
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('scores a finding from its facts, sets an SLA and moves it through the workflow', async () => {
    const R = W('/findings/' + (id['vuln'] ?? '') + '/risk');
    const before = await t.call<Risk>(mo, 'GET', R);
    expect(before.body).toMatchObject({ riskScore: 75, workflow: 'new', status: 'open' });
    expect(before.body.slaDueAt).not.toBeNull();
    expect((await t.call(mo, 'PATCH', R, { cve: 'not a cve' })).status).toBe(400);
    const after = await t.call<Risk>(mo, 'PATCH', R, {
      cve: 'CVE-2020-8203',
      package: 'lodash',
      packageVersion: '4.17.15',
      fixedVersion: '4.17.19',
      cvss: 7.4,
      epss: 0.5,
      reachable: true,
    });
    expect(after.body.riskScore).toBe(87);
    const F = W('/findings/' + (id['vuln'] ?? '') + '/workflow');
    expect((await t.call(mo, 'POST', F, { to: 'verified' })).status).toBe(409);
    expect((await t.call<Risk>(mo, 'POST', F, { to: 'fixing' })).body.workflow).toBe('fixing');
  });

  // [PCODE-179 | S15 | v0.1.0] the list carries the risk and is ordered by it; any open finding gets a task
  it('lists findings by risk with their signals and makes a task for one', async () => {
    const list = await t.call<
      {
        id: string;
        riskScore: number;
        cve: string;
        reachable: boolean | null;
        itemId: string | null;
      }[]
    >(mo, 'GET', P('/findings?status=open'));
    expect(list.body[0]).toMatchObject({
      id: id['vuln'],
      riskScore: 87,
      cve: 'CVE-2020-8203',
      reachable: true,
    });
    expect(list.body.map((f) => f.riskScore)).toEqual(
      [...list.body.map((f) => f.riskScore)].sort((x, y) => y - x),
    );
    const minor = list.body.find((f) => f.id === id['minor']);
    expect(minor?.itemId).toBeNull();
    const made = await t.call<{ itemRef: string }>(
      mo,
      'POST',
      W('/findings/' + (id['minor'] ?? '') + '/task'),
    );
    expect(made.status).toBe(201);
    expect(made.body.itemRef).toMatch(/^SEC-\d+$/);
    expect((await t.call(mo, 'POST', W('/findings/' + (id['minor'] ?? '') + '/task'))).status).toBe(
      409,
    );
  });

  it('lets only an admin accept a risk, and only until a future date', async () => {
    const A = W('/findings/' + (id['minor'] ?? '') + '/accept');
    const body = { reason: 'Cache keys are not secret', until: '2099-01-01' };
    expect((await t.call(mo, 'POST', A, body)).status).toBe(403);
    expect((await t.call(ada, 'POST', A, { ...body, until: '2001-01-01' })).status).toBe(400);
    const ok = await t.call<Risk>(ada, 'POST', A, body);
    expect(ok.body).toMatchObject({ status: 'accepted', acceptedUntil: '2099-01-01' });
    const posture = await t.call<{
      open: Record<string, number>;
      accepted: number;
      score: number;
      top: { id: string }[];
    }>(mo, 'GET', P('/security/posture'));
    expect(posture.body.open).toMatchObject({ high: 1, low: 0 });
    expect(posture.body.accepted).toBe(1);
    expect(posture.body.top[0]?.id).toBe(id['vuln']);
  });

  it('keeps SBOMs, diffs them and finds shipped releases with a package', async () => {
    expect((await t.call(mo, 'POST', P('/sboms'), { document: { hello: 1 } })).status).toBe(400);
    const rel = (await t.call<{ id: string }>(mo, 'POST', P('/releases'), { version: '1.0.0' }))
      .body.id;
    id['release'] = rel;
    const a = (
      await t.call<{ id: string }>(mo, 'POST', P('/sboms'), {
        document: cyclonedx('4.17.15'),
        releaseId: rel,
      })
    ).body.id;
    const b = (
      await t.call<{ id: string }>(mo, 'POST', P('/sboms'), { document: cyclonedx('4.17.21') })
    ).body.id;
    const diff = await t.call<{ changed: unknown[]; added: unknown[] }>(
      mo,
      'GET',
      W('/sbom-diff?a=' + a + '&b=' + b),
    );
    expect(diff.body).toMatchObject({
      added: [],
      changed: [{ name: 'lodash', from: '4.17.15', to: '4.17.21' }],
    });
    // not shipped yet: no exposure
    expect((await t.call<unknown[]>(mo, 'GET', W('/package-exposure?name=lodash'))).body).toEqual(
      [],
    );
  });

  it('checks policies in a dry run and gates the release; an admin overrides with a reason', async () => {
    expect(
      (await t.call(ada, 'POST', W('/policies'), { name: 'x', appliesTo: 'release', rule: {} }))
        .status,
    ).toBe(400);
    const pol = await t.call<{ id: string }>(ada, 'POST', W('/policies'), {
      name: 'No high findings',
      appliesTo: 'release',
      rule: { maxSeverity: 'high' },
    });
    expect(pol.status).toBe(201);
    const dry = await t.call<{
      passes: boolean;
      results: { policy: string; violations: string[] }[];
    }>(mo, 'POST', P('/policies/check'), { appliesTo: 'release' });
    expect(dry.body).toEqual({
      passes: false,
      results: [{ policy: 'No high findings', violations: ['1 open high or worse finding'] }],
    });
    const S = W('/releases/' + (id['release'] ?? '') + '/release');
    expect((await t.call(mo, 'POST', S, {})).status).toBe(409);
    expect(
      (await t.call(mo, 'POST', S, { override: true, reason: 'Hotfix for a customer outage' }))
        .status,
    ).toBe(403);
    const shipped = await t.call<{ state: string; notesTeam: string }>(ada, 'POST', S, {
      override: true,
      reason: 'Hotfix for a customer outage',
    });
    expect(shipped.body.state).toBe('released');
    expect(shipped.body.notesTeam).toContain('Shipped despite policies');
    const exposed = await t.call<
      { projectKey: string; version: string; componentVersion: string }[]
    >(mo, 'GET', W('/package-exposure?name=lodash&version=4.17.15'));
    expect(exposed.body).toMatchObject([
      { projectKey: 'SEC', version: '1.0.0', componentVersion: '4.17.15' },
    ]);
  });

  it('runs a campaign across projects and counts what is open and fixed', async () => {
    expect(
      (await t.call(ada, 'POST', W('/campaigns'), { title: 'Both', rule: 'a', package: 'b' }))
        .status,
    ).toBe(400);
    const c = await t.call<{ id: string; open: number; fixed: number }>(
      ada,
      'POST',
      W('/campaigns'),
      { title: 'Drop old lodash', package: 'lodash', dueDate: '2099-03-01' },
    );
    expect(c.body).toMatchObject({ open: 1, fixed: 0 });
    await scan([minor]);
    const list = await t.call<{ title: string; open: number; fixed: number }[]>(
      mo,
      'GET',
      W('/campaigns'),
    );
    expect(list.body.find((x) => x.title === 'Drop old lodash')).toMatchObject({
      open: 0,
      fixed: 1,
    });
    const done = await t.call<Risk>(
      mo,
      'POST',
      W('/findings/' + (id['vuln'] ?? '') + '/workflow'),
      { to: 'verified' },
    );
    expect(done.body.workflow).toBe('verified');
  });

  it('takes a code scan, maps folders and hot spots, and lists hygiene gaps', async () => {
    expect(
      (await t.call(mo, 'POST', P('/code-scan'), { files: [{ path: '../etc/passwd', lines: 1 }] }))
        .status,
    ).toBe(400);
    const files = [
      {
        path: 'src/api/orders.ts',
        lines: 800,
        complexity: 120,
        churn: 30,
        authors: { mo: 600, 'Coder agent': 200 },
        agentShare: 0.25,
      },
      { path: 'src/api/health.ts', lines: 40, complexity: 2, churn: 1, authors: { ada: 40 } },
      {
        path: 'src/ui/app.tsx',
        lines: 200,
        complexity: 10,
        churn: 5,
        authors: { 'Coder agent': 200 },
        agentShare: 1,
      },
      { path: 'old/legacy.js', lines: 100, complexity: 5, churn: 0 },
    ];
    expect((await t.call(mo, 'POST', P('/code-scan'), { files })).body).toEqual({
      files: 4,
      removed: 0,
    });
    expect(
      (await t.call(mo, 'POST', P('/code-scan'), { files: files.slice(0, 3), full: true })).body,
    ).toEqual({ files: 3, removed: 1 });
    const map = await t.call<{
      totals: { files: number; lines: number };
      folders: { path: string; lines: number; hotspot: number }[];
      hotspots: { path: string; hotspot: number; owner: string }[];
      owners: { author: string }[];
    }>(mo, 'GET', P('/code-map'));
    expect(map.body.totals).toMatchObject({ files: 3, lines: 1040 });
    expect(map.body.folders.map((f) => [f.path, f.lines, f.hotspot])).toEqual([
      ['src/api', 840, 100],
      ['src/ui', 200, 1],
    ]);
    expect(map.body.hotspots[0]).toMatchObject({
      path: 'src/api/orders.ts',
      hotspot: 100,
      owner: 'mo',
    });
    expect(map.body.owners.map((o) => o.author)).toEqual(['mo', 'Coder agent', 'ada']);
    const under = await t.call<{ path: string }[]>(mo, 'GET', P('/code-map/files?prefix=src/api/'));
    expect(under.body.map((f) => f.path)).toEqual(['src/api/health.ts', 'src/api/orders.ts']);
    const hy = await t.call<{ unfingerprinted: { path: string }[]; unfingerprintedLines: number }>(
      mo,
      'GET',
      P('/code-hygiene'),
    );
    expect(hy.body.unfingerprintedLines).toBe(1040);
  });

  it('builds the API inventory from OpenAPI and names the task behind an endpoint', async () => {
    expect(
      (await t.call(mo, 'POST', P('/api-endpoints/import'), { openapi: { paths: {} } })).status,
    ).toBe(400);
    const doc = (paths: Record<string, unknown>) => ({
      openapi: '3.0.0',
      security: [{ session: [] }],
      paths,
    });
    const first = await t.call(mo, 'POST', P('/api-endpoints/import'), {
      openapi: doc({
        '/health': { get: { security: [] } },
        '/orders': { get: {}, post: { tags: ['orders'] } },
      }),
    });
    expect(first.body).toEqual({ endpoints: 3, removed: 0, unauthenticated: 1 });
    const second = await t.call(mo, 'POST', P('/api-endpoints/import'), {
      openapi: doc({
        '/health': { get: { security: [] } },
        '/orders': { post: { tags: ['orders'] } },
      }),
    });
    expect(second.body).toEqual({ endpoints: 2, removed: 1, unauthenticated: 1 });
    const created = (
      await t.call<{ id: string; ref: string }>(mo, 'POST', P('/items'), { title: 'Order API' })
    ).body;
    const item = created.id;
    const list = await t.call<{ id: string; method: string; path: string; auth: string }[]>(
      mo,
      'GET',
      P('/api-endpoints'),
    );
    const orders = list.body.find((e) => e.path === '/orders');
    expect(orders).toMatchObject({ method: 'POST', auth: 'session' });
    expect(
      (
        await t.call<{ itemId: string }>(mo, 'PATCH', W('/api-endpoints/' + (orders?.id ?? '')), {
          itemId: item,
        })
      ).body.itemId,
    ).toBe(item);
    const again = await t.call<{ path: string; itemRef: string | null }[]>(
      mo,
      'GET',
      P('/api-endpoints'),
    );
    expect(again.body.find((e) => e.path === '/orders')?.itemRef).toBe(created.ref);
  });
});
