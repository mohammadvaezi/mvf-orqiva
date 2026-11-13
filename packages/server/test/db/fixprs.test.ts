// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-324 | S15 | v0.1.0] T32.8a Fix pull requests for findings: dependency upgrades and AI fixes ──
//    Why:  against a stand-in GitHub: a lodash finding becomes a pull request that raises package.json; a
//          code finding becomes the Security agent's corrected file (the demo model marks the line); the
//          finding moves to fixing with the link and is not opened twice; a secret and a repository without
//          a token are refused.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { toSarif } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProvider } from '../../src/agents/provider.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

process.env['ORQIVA_SECRET_KEY'] = 'ef'.repeat(32);
const TOKEN = 'host-token-for-fix-tests';
const PKG = '{\n  "name": "shop",\n  "dependencies": {\n    "lodash": "^4.17.20"\n  }\n}\n';
const APP =
  "import express from 'express';\nconst run = (input) => {\n  return eval(input);\n};\nexport { run };\n";

describe.skipIf(!hasDatabase)('fix pull requests (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const branches = new Map<string, Map<string, string>>([
    [
      'main',
      new Map([
        ['package.json', PKG],
        ['src/run.js', APP],
      ]),
    ],
  ]);
  const pulls: { title: string; head: string; body: string }[] = [];
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const read = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((res) => {
      let b = '';
      req.on('data', (d: Buffer) => (b += d.toString()));
      req.on('end', () => {
        res(b ? (JSON.parse(b) as Record<string, unknown>) : {});
      });
    });
  const host = createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? '', 'http://x');
      const path = u.pathname.replace(/^\/repos\/acme\/shop/, '');
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      };
      if (req.headers.authorization !== 'Bearer ' + TOKEN) {
        send(401, { message: 'Bad credentials' });
        return;
      }
      const body = await read(req);
      const file = /^\/contents\/(.+)$/.exec(path)?.[1];
      if (req.method === 'GET' && path === '') send(200, { default_branch: 'main' });
      else if (req.method === 'GET' && file) {
        const text = branches
          .get(u.searchParams.get('ref') ?? 'main')
          ?.get(decodeURIComponent(file));
        if (text === undefined) send(404, { message: 'Not Found' });
        else send(200, { sha: 'sha-' + file, content: Buffer.from(text).toString('base64') });
      } else if (req.method === 'GET' && path === '/git/ref/heads/main')
        send(200, { object: { sha: 'abc123' } });
      else if (req.method === 'POST' && path === '/git/refs') {
        branches.set(String(body['ref']).replace('refs/heads/', ''), new Map(branches.get('main')));
        send(201, {});
      } else if (req.method === 'PUT' && file) {
        branches
          .get(String(body['branch']))
          ?.set(
            decodeURIComponent(file),
            Buffer.from(String(body['content']), 'base64').toString('utf8'),
          );
        send(200, {});
      } else if (req.method === 'POST' && path === '/pulls') {
        pulls.push(body as (typeof pulls)[number]);
        send(201, {
          number: pulls.length,
          html_url: 'https://github.test/acme/shop/pull/' + String(pulls.length),
        });
      } else send(404, { message: 'Not Found' });
    })();
  });
  const findings = async () =>
    (
      await t.call<{ id: string; rule: string; workflow: string; fixPrUrl: string }[]>(
        ada,
        'GET',
        P('/findings'),
      )
    ).body;

  beforeAll(async () => {
    await listenFetchable(host); // [PCODE-365 | S15 | v0.1.0]
    t = await startTestApp({ agents: { provider: () => Promise.resolve(demoProvider()) } });
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
    await t.call(ada, 'POST', P('/scans'), {
      sarif: toSarif('pe-scan', '0.1.0', [
        {
          rule: 'js/eval',
          severity: 'high',
          title: 'eval of a value',
          message: 'eval at src/run.js:3',
          file: 'src/run.js',
          line: 3,
          fingerprint: 'eval',
        },
        {
          rule: 'secret/github-token',
          severity: 'critical',
          title: 'GitHub token',
          message: '',
          file: 'src/config.js',
          line: 1,
          fingerprint: 'tok',
        },
      ]),
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    host.close();
  });

  it('refuses without a repository that has a token', async () => {
    const lodash = (await findings()).find((f) => f.rule.startsWith('GHSA'));
    const r = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      W('/findings/' + (lodash?.id ?? '') + '/fix-pr'),
    );
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('API token');
    const conn = (
      await t.call<{ connection: { id: string } }>(ada, 'POST', P('/git'), {
        provider: 'github',
        repo: 'acme/shop',
      })
    ).body.connection.id;
    await t.call(ada, 'PUT', W('/git/' + conn + '/api'), {
      token: TOKEN,
      apiUrl: 'http://127.0.0.1:' + String((host.address() as AddressInfo).port),
    });
  });

  it('opens an upgrade for a vulnerable dependency', async () => {
    const lodash = (await findings()).find((f) => f.rule.startsWith('GHSA'));
    const r = await t.call<{
      kind: string;
      url: string;
      summary: string;
      finding: { workflow: string; fixPrUrl: string };
    }>(ada, 'POST', W('/findings/' + (lodash?.id ?? '') + '/fix-pr'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      kind: 'upgrade',
      url: 'https://github.test/acme/shop/pull/1',
      summary: 'lodash ^4.17.20 → ^4.17.21 in dependencies',
      finding: { workflow: 'fixing', fixPrUrl: 'https://github.test/acme/shop/pull/1' },
    });
    const branch = pulls[0]?.head ?? '';
    expect(branches.get(branch)?.get('package.json')).toBe(PKG.replace('^4.17.20', '^4.17.21'));
    expect(pulls[0]?.title).toBe('Upgrade lodash to 4.17.21');
    expect(pulls[0]?.body).toContain('Run the install');
    // not twice
    expect(
      (await t.call(ada, 'POST', W('/findings/' + (lodash?.id ?? '') + '/fix-pr'))).status,
    ).toBe(409);
  });

  it('opens the Security agent’s fix for code, and refuses a secret', async () => {
    const all = await findings();
    const evalF = all.find((f) => f.rule === 'js/eval');
    const r = await t.call<{ kind: string; summary: string }>(
      ada,
      'POST',
      W('/findings/' + (evalF?.id ?? '') + '/fix-pr'),
    );
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('ai');
    const fixed = branches.get(pulls[1]?.head ?? '')?.get('src/run.js') ?? '';
    expect(fixed.split('\n')[2]).toBe(
      '  // Orqiva: js/eval flagged the next line; review it before merging.',
    );
    expect(fixed.split('\n')[3]).toBe('  return eval(input);');
    expect(pulls[1]?.body).toContain('Written by an AI agent');
    const secret = all.find((f) => f.rule.startsWith('secret/'));
    const s = await t.call<{ error: { message: string } }>(
      ada,
      'POST',
      W('/findings/' + (secret?.id ?? '') + '/fix-pr'),
    );
    expect(s.status).toBe(409);
    expect(s.body.error.message).toContain('rotating it');
  });
});
