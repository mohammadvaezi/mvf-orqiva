// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-326 | S15 | v0.1.0] T32.9 T32 exit check, docs and sprint close ──
//    Why:  the T32 exit as one team's path against the real server, with stand-ins for a GitHub host and the
//          vulnerability feeds and the demo model for the agents. Test: a Gherkin feature and shared steps
//          make the cases; a run is planned for a release, given to a tester, a failure triaged, a case
//          blocked by a bug that reopens it once the bug is done; the run is signed off by its approver and
//          the release gate on tests lets the release ship; a Cypress report imports. Security: a dependency
//          finding with its facts; the feeds mark it; the shipped version alerts; a VEX statement sets it
//          aside in the version's posture; an upgrade pull request is opened; a token in a commit is revoked.
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { toSarif } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProvider } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { alertRound } from '../../src/push/alerts.js';
import { sign } from '../../src/git/webhook.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

process.env['ORQIVA_SECRET_KEY'] = '9a'.repeat(32);
const HOST_TOKEN = 'host-token-for-the-t32-exit';
const PKG = '{\n  "name": "shop",\n  "dependencies": {\n    "lodash": "^4.17.20"\n  }\n}\n';
const fixture = (path: string): string =>
  readFileSync(new URL('../fixtures/' + path, import.meta.url), 'utf8');

describe.skipIf(!hasDatabase)('T32 exit: test and security (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bob: Person;
  let project = '';
  let story = '';
  let release = '';
  let run = '';
  let token = '';
  const cases: Record<string, string> = {};
  const hook = { path: '', secret: '' };
  const pulls: { head: string; title: string }[] = [];
  const files = new Map<string, Map<string, string>>([['main', new Map([['package.json', PKG]])]]);
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const R = (p = ''): string => W('/test-runs/' + run + p);
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const read = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((res) => {
      let b = '';
      req.on('data', (d: Buffer) => (b += d.toString()));
      req.on('end', () => {
        res(b ? (JSON.parse(b) as Record<string, unknown>) : {});
      });
    });
  // a GitHub with the shop's package.json, taking branches, files and pull requests
  const host = createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? '', 'http://x');
      const path = u.pathname.replace(/^\/repos\/acme\/shop/, '');
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      };
      if (req.headers.authorization !== 'Bearer ' + HOST_TOKEN) {
        send(401, { message: 'Bad credentials' });
        return;
      }
      const body = await read(req);
      const file = /^\/contents\/(.+)$/.exec(path)?.[1];
      if (req.method === 'GET' && path === '') send(200, { default_branch: 'main' });
      else if (req.method === 'GET' && file) {
        const text = files.get(u.searchParams.get('ref') ?? 'main')?.get(decodeURIComponent(file));
        if (text === undefined) send(404, {});
        else send(200, { sha: 's', content: Buffer.from(text).toString('base64') });
      } else if (req.method === 'GET' && path === '/git/ref/heads/main')
        send(200, { object: { sha: 'abc123' } });
      else if (req.method === 'POST' && path === '/git/refs') {
        files.set(String(body['ref']).replace('refs/heads/', ''), new Map(files.get('main')));
        send(201, {});
      } else if (req.method === 'PUT' && file) {
        files
          .get(String(body['branch']))
          ?.set(
            decodeURIComponent(file),
            Buffer.from(String(body['content']), 'base64').toString(),
          );
        send(200, {});
      } else if (req.method === 'POST' && path === '/pulls') {
        pulls.push(body as (typeof pulls)[number]);
        send(201, {
          number: pulls.length,
          html_url: 'https://github.test/acme/shop/pull/' + String(pulls.length),
        });
      } else send(404, {});
    })();
  });

  beforeAll(async () => {
    await listenFetchable(host); // [PCODE-365 | S15 | v0.1.0]
    t = await startTestApp({
      agents: { provider: () => Promise.resolve(demoProvider()) },
      vulnFeeds: {
        kevUrl: 'https://feeds.test/kev.json',
        epssUrl: 'https://feeds.test/epss',
        fetch: (input: string | URL | Request) => {
          const url = input instanceof Request ? input.url : input.toString();
          if (!url.endsWith('/kev.json'))
            return Promise.resolve(new Response(fixture('feeds/epss.json')));
          const kev = JSON.parse(fixture('feeds/kev.json')) as {
            vulnerabilities: Record<string, unknown>[];
          };
          kev.vulnerabilities.push({ ...kev.vulnerabilities[0], cveID: 'CVE-2021-23337' });
          return Promise.resolve(new Response(JSON.stringify(kev)));
        },
      },
    });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    story = (await t.call<{ id: string }>(ada, 'POST', P('/items'), { title: 'Checkout works' }))
      .body.id;
    release = (await t.call<{ id: string }>(ada, 'POST', P('/releases'), { version: '1.4.0' })).body
      .id;
    await t.call(ada, 'POST', W('/releases/' + release + '/items'), { itemIds: [story] });
    const tok = await fetch(t.base + '/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ci', email: ada.email, password: 'a test password 1' }),
    });
    token = ((await tok.json()) as { token: string }).token;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    host.close();
  });

  it('writes the cases once: a Gherkin feature and shared steps', async () => {
    const made = await t.call<{ created: { id: string; title: string }[] }>(
      ada,
      'POST',
      P('/test-cases/gherkin'),
      {
        text: [
          'Feature: Checkout',
          '  Scenario: Pay by card',
          '    When I pay <total> by card',
          '    Then I see the receipt',
          '  Scenario: Receipt mail',
          '    When I pay by card',
          '    Then a receipt mail arrives',
        ].join('\n'),
      },
    );
    for (const c of made.body.created) cases[c.title] = c.id;
    const signIn = await t.call<{ id: string }>(ada, 'POST', P('/test-shared-steps'), {
      name: 'Sign in',
      steps: [{ action: 'Sign in as a customer', expected: 'The shop shows the cart' }],
    });
    const cart = await t.call<{ id: string }>(ada, 'POST', P('/test-cases'), {
      title: 'Cart keeps items',
      itemId: story,
    });
    cases['Cart keeps items'] = cart.body.id;
    await t.call(ada, 'PATCH', W('/test-cases/' + cart.body.id + '/design'), {
      steps: [
        { action: '', expected: '', shared: signIn.body.id },
        { action: 'Reload', expected: 'The cart is full' },
      ],
    });
    for (const id of Object.values(cases))
      await sys('UPDATE test_cases SET item_id = $2 WHERE id = $1', [id, story]);
    expect(Object.keys(cases).sort()).toEqual(['Cart keeps items', 'Pay by card', 'Receipt mail']);
  });

  it('runs them: assigned, a failure triaged, a blocked case reopened by its done bug', async () => {
    run =
      (
        await t.call<{ id: string }[]>(ada, 'POST', P('/test-runs/plan'), {
          name: 'Release 1.4.0',
          caseIds: Object.values(cases),
          releaseId: release,
          configs: [{ total: '12.00' }],
        })
      ).body[0]?.id ?? '';
    const plan = await t.call<{ cases: { title: string; steps: { action: string }[] }[] }>(
      ada,
      'GET',
      R('/plan'),
    );
    expect(plan.body.cases.find((c) => c.title === 'Pay by card')?.steps[0]?.action).toBe(
      'When I pay 12.00 by card',
    );
    expect(plan.body.cases.find((c) => c.title === 'Cart keeps items')?.steps[0]?.action).toBe(
      'Sign in as a customer',
    );
    for (const id of Object.values(cases))
      await t.call(ada, 'PUT', R('/assign'), { caseId: id, userId: bob.id });
    await t.call(bob, 'PUT', R('/cases/' + (cases['Pay by card'] ?? '')), {
      status: 'failed',
      message: 'Timed out: the payment sandbox is not reachable',
      durationMs: 60_000,
    });
    const triage = await t.call<{ category: string }>(
      bob,
      'POST',
      R('/cases/' + (cases['Pay by card'] ?? '') + '/triage'),
    );
    expect(triage.body.category).toBe('environment');
    await t.call(bob, 'PUT', R('/cases/' + (cases['Receipt mail'] ?? '')), { status: 'blocked' });
    const bug = await t.call<{ itemId: string }>(
      bob,
      'POST',
      R('/cases/' + (cases['Receipt mail'] ?? '') + '/defect'),
      {
        blocked: true,
      },
    );
    const states = await t.call<{ states: { id: string; group: string }[] }>(ada, 'GET', P(''));
    await t.call(ada, 'PATCH', W('/items/' + bug.body.itemId), {
      stateId: states.body.states.find((s) => s.group === 'completed')?.id,
    });
    const after = await t.call<{
      cases: { title: string; status: string; reopenedBy: string | null }[];
    }>(ada, 'GET', R('/plan'));
    expect(after.body.cases.find((c) => c.title === 'Receipt mail')).toMatchObject({
      status: 'untested',
    });
    const load = await t.call<{ people: { name: string; assigned: number; done: number }[] }>(
      ada,
      'GET',
      P('/test-workload'),
    );
    expect(load.body.people[0]).toMatchObject({ name: 'Bob', assigned: 3, done: 1 });
  });

  it('signs the run off and lets the release ship through its test gate', async () => {
    await t.call(ada, 'POST', W('/policies'), {
      name: 'Tested',
      appliesTo: 'release',
      rule: { testsPass: true, testsSigned: true },
    });
    for (const id of Object.values(cases))
      await t.call(bob, 'PUT', R('/cases/' + id), { status: 'passed' });
    expect((await t.call(ada, 'POST', W('/releases/' + release + '/release'), {})).status).toBe(
      409,
    );
    await t.call(ada, 'PUT', R('/approver'), { userId: bob.id });
    await t.call(ada, 'POST', R('/finish'));
    const signed = await t.call<{ signedBy: string; snapshot: { totals: { passed: number } } }>(
      bob,
      'POST',
      R('/signoff'),
      {
        note: 'Ready',
      },
    );
    expect(signed.body).toMatchObject({ signedBy: 'Bob', snapshot: { totals: { passed: 3 } } });
    const shipped = await t.call<{ state: string }>(
      ada,
      'POST',
      W('/releases/' + release + '/release'),
      {},
    );
    expect(shipped.body.state).toBe('released');
    const cy = await t.call<{ created: number; run: { source: string } }>(
      ada,
      'POST',
      P('/test-runs/import'),
      {
        format: 'cypress',
        report: JSON.parse(fixture('testreports/cypress-mochawesome.json')) as unknown,
      },
    );
    expect(cy.body).toMatchObject({ created: 4, run: { source: 'cypress' } });
  });

  it('follows a vulnerable dependency from the finding to the fix', async () => {
    await t.call(ada, 'POST', P('/scans'), {
      sarif: toSarif('pe-deps', '0.1.0', [
        {
          rule: 'GHSA-35jh-r3h4-6jhm',
          severity: 'high',
          title: 'lodash@4.17.20: command injection',
          message: '',
          file: 'package-lock.json',
          line: null,
          fingerprint: 'lodash',
          facts: {
            cve: 'CVE-2021-23337',
            package: 'lodash',
            version: '4.17.20',
            fixedVersion: '4.17.21',
          },
        },
      ]),
    });
    await t.call(ada, 'POST', P('/sboms'), {
      document: {
        bomFormat: 'CycloneDX',
        components: [{ name: 'lodash', version: '4.17.20', purl: 'pkg:npm/lodash@4.17.20' }],
      },
      releaseId: release,
    });
    await t.call(ada, 'PUT', W('/settings/security.vuln_feeds'), {
      scope: 'workspace',
      value: true,
    });
    const fed = await t.call<{ kev: number }>(ada, 'POST', W('/security/feeds/refresh'));
    expect(fed.body.kev).toBe(1);
    expect((await alertRound(t.db.pool, { subject: 'mailto:ops@example.test' })).cves).toBe(1);
    // the version answers for it: affected here, so its posture counts it
    const before = (
      await t.call<{ version: string; open: { high: number } }[]>(
        ada,
        'GET',
        P('/security/versions'),
      )
    ).body;
    expect(before.find((v) => v.version === '1.4.0')?.open.high).toBe(1);
    await t.call(ada, 'PUT', W('/releases/' + release + '/vex'), {
      cve: 'CVE-2021-23337',
      package: 'lodash',
      status: 'not_affected',
      justification: 'vulnerable_code_not_in_execute_path',
    });
    const after = (
      await t.call<{ version: string; setAside: number; score: number }[]>(
        ada,
        'GET',
        P('/security/versions'),
      )
    ).body;
    expect(after.find((v) => v.version === '1.4.0')).toMatchObject({ setAside: 1, score: 100 });
    // the next version gets the upgrade
    const conn = (
      await t.call<{ connection: { id: string; webhookPath: string }; secret: string }>(
        ada,
        'POST',
        P('/git'),
        {
          provider: 'github',
          repo: 'acme/shop',
        },
      )
    ).body;
    Object.assign(hook, { path: conn.connection.webhookPath, secret: conn.secret });
    await t.call(ada, 'PUT', W('/git/' + conn.connection.id + '/api'), {
      token: HOST_TOKEN,
      apiUrl: 'http://127.0.0.1:' + String((host.address() as AddressInfo).port),
    });
    const finding = (
      await t.call<{ id: string; rule: string }[]>(ada, 'GET', P('/findings'))
    ).body.find((f) => f.rule.startsWith('GHSA'));
    const pr = await t.call<{ kind: string; url: string }>(
      ada,
      'POST',
      W('/findings/' + (finding?.id ?? '') + '/fix-pr'),
    );
    expect(pr.body).toMatchObject({ kind: 'upgrade', url: 'https://github.test/acme/shop/pull/1' });
    expect(files.get(pulls[0]?.head ?? '')?.get('package.json')).toContain('"lodash": "^4.17.21"');
  });

  it('revokes a token leaked in a commit message', async () => {
    const body = Buffer.from(
      JSON.stringify({
        ref: 'refs/heads/main',
        after: '7f'.repeat(20),
        repository: { full_name: 'acme/shop', default_branch: 'main' },
        commits: [
          {
            id: '7f'.repeat(20),
            message: 'CI with ' + token,
            url: '',
            timestamp: '2026-10-14T10:00:00Z',
            author: { name: 'Ada', username: 'ada' },
            added: [],
            modified: [],
            removed: [],
          },
        ],
      }),
    );
    const res = await fetch(t.base + hook.path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-hub-signature-256': 'sha256=' + sign(hook.secret, body),
      },
      body,
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 600));
    expect(
      (await fetch(t.base + '/auth/me', { headers: { authorization: 'Bearer ' + token } })).status,
    ).toBe(401);
  });
});
