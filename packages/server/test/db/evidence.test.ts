// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-144 | S15 | v0.1.0] Export evidence packs with one click ──
//    Why:  the pack is a real ZIP whose manifest proves its contents, and it never carries a secret.
import { toSarif } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../../src/api/evidence.js';
import { crc32, unzip, zip } from '../../src/export/zip.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = '34'.repeat(32);

describe('our ZIP writer', () => {
  it('computes CRC-32 as the standard does', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it('writes archives that read back exactly, with UTF-8 names', () => {
    const files = [
      { name: 'README.html', data: Buffer.from('<h1>Prüfbericht</h1>') },
      { name: 'evidence/empty.json', data: Buffer.from('') },
      { name: 'evidence/big.json', data: Buffer.from('x'.repeat(100_000)) },
    ];
    const z = zip(files, new Date(2026, 9, 4, 12, 30));
    expect(z.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(z.length).toBeLessThan(2000);
    expect(unzip(z)).toEqual(files);
  });
});

describe.skipIf(!hasDatabase)('evidence packs (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/compliance/frameworks/iso27001'), {
      enabled: true,
    });
    await t.call(ada, 'POST', W('/projects/' + project + '/scans'), {
      sarif: toSarif('pe-scan', '0.1.0', []),
      full: true,
    });
    const env = await t.call<{ id: string }>(
      ada,
      'POST',
      W('/projects/' + project + '/environments'),
      {
        key: 'staging',
        name: 'Staging',
        kind: 'compose',
        settings: { dir: '/srv' },
      },
    );
    await t.call(ada, 'PUT', W('/environments/' + env.body.id + '/secrets/DB_PASSWORD'), {
      value: 'zebra-secret-value-42',
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('downloads a ZIP whose manifest matches every file, without secrets', async () => {
    const res = await fetch(t.base + W('/projects/' + project + '/evidence-pack'), {
      headers: { cookie: ada.cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="evidence-APP-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    const files = unzip(Buffer.from(await res.arrayBuffer()));
    const names = files.map((f) => f.name);
    expect(names).toEqual([
      'README.html',
      'manifest.json',
      'controls.csv',
      'compliance.json',
      'evidence/security-scans.json',
      'evidence/findings.json',
      'evidence/test-runs.json',
      'evidence/gates.json',
      'evidence/proposal-signatures.json',
      'evidence/deploys.json',
      'evidence/members.json',
      'evidence/activity.json',
    ]);
    const manifest = JSON.parse(files[1]?.data.toString('utf8') ?? '{}') as {
      files: { path: string; sha256: string; bytes: number }[];
    };
    for (const m of manifest.files) {
      const f = files.find((x) => x.name === m.path);
      expect(f && sha256(f.data)).toBe(m.sha256);
      expect(f?.data.length).toBe(m.bytes);
    }
    const all = files.map((f) => f.data.toString('utf8')).join('\n');
    expect(all).not.toContain('zebra-secret-value-42');
    expect(all).not.toContain('"_from"');
    const csv = files.find((f) => f.name === 'controls.csv')?.data.toString('utf8') ?? '';
    expect(csv.split('\r\n')[0]).toBe(
      'framework,control,summary,status,evidence,measured,not applicable because',
    );
    expect(csv).toContain(
      'A.8.8,Find technical vulnerabilities and deal with them in time.,partial',
    );
    const members = JSON.parse(
      files.find((f) => f.name === 'evidence/members.json')?.data.toString('utf8') ?? '[]',
    ) as { role: string }[];
    expect(members).toEqual([expect.objectContaining({ name: 'Ada', role: 'owner' })]);
    // the export itself is on record
    const feed = await t.call<{
      events: { type: string; data: { changes?: Record<string, unknown> } }[];
    }>(ada, 'GET', W('/activity?limit=5'));
    expect(feed.body.events.some((e) => e.data.changes?.['evidencePack'])).toBe(true);
  });

  it('refuses a period that ends before it starts', async () => {
    const res = await fetch(
      t.base + W('/projects/' + project + '/evidence-pack?from=2026-10-04&to=2026-01-01'),
      {
        headers: { cookie: ada.cookie },
      },
    );
    expect(res.status).toBe(400);
  });
});
