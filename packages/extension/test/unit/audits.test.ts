// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-66 | S13 | v0.1.0] Add npm audit and secret scan runners wired to the security checklist ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  a secret scanner is judged by both halves: what it finds, and what it does not. The false
//          positives are listed here as explicitly as the true ones, because a check that cries wolf on
//          every fixture gets turned off, and a check that is turned off finds nothing at all.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_AUDIT,
  isScannableFile,
  mask,
  noteLine,
  npmAuditSummary,
  parseNpmAudit,
  parsePipAudit,
  runNpmAudit,
  runPipAudit,
  scanTextForSecrets,
  scanWorkspaceForSecrets,
  secretScanSummary,
  type CommandRunner,
  type ScanIo,
} from '../../src/security/audits';
import { parseChecklist, setNote } from '../../src/security/checklist';
import { isoDay, runCheck } from '../../src/security/runChecks';

const REPO = path.resolve(__dirname, '..', '..');

// ── [PCODE-66 | S13 | v0.1.0] the samples are assembled, not written ──
//    A scanner's own test file is the first place it will find something. Every format-valid sample below
//    is built at run time, so this file contains no literal that matches a rule - which is what lets the
//    "nothing in this repository" assertion be a real check instead of an exception list.
const PLANE_KEY = ['plane_api_', '2f4c8a1b9d0e4f7a', '8b3c5d6e7f809a1b'].join('');
const AWS_KEY = ['AKIA', 'IOSFODNN7EXAMPLF'].join('');
const GH_TOKEN = ['ghp_', '1234567890abcdefghijklmnopqrstuvwxyz', 'AB'].join('');
const PEM_HEADER = ['-----BEGIN RSA PRIVATE ', 'KEY', '-----'].join('');
const PEM_BARE = ['-----BEGIN PRIVATE ', 'KEY', '-----'].join('');
const PASSWORD_LINE = ['password = "', 'Hunter2LongEnoughValue', '"'].join('');

// ── [PCODE-66 | S13 | v0.1.0] true positives: the real formats ──
describe('secret rules: what must be found', () => {
  const cases: [string, string][] = [
    ['a Plane token', `PLANE_API_KEY=${PLANE_KEY}`],
    ['an AWS key id', `aws_access_key_id = ${AWS_KEY}`],
    ['a GitHub token', `token: ${GH_TOKEN}`],
    ['a private key block', PEM_HEADER],
    ['a bare private key block', PEM_BARE],
    ['a hard-coded password', PASSWORD_LINE],
  ];
  for (const [name, line] of cases) {
    it(`finds ${name}`, () => {
      const hits = scanTextForSecrets(`first line\n${line}\nlast line\n`);
      expect(hits, line).toHaveLength(1);
      expect(hits[0]?.line).toBe(2);
    });
  }

  it('reports the line and rule but never the value itself', () => {
    const hits = scanTextForSecrets(`key = ${PLANE_KEY}`);
    // [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names
    expect(hits[0]?.rule).toBe('Legacy tracker API key');
    expect(hits[0]?.excerpt).not.toContain(PLANE_KEY.slice(-16));
    expect(hits[0]?.excerpt).toContain('***');
    const opaque = 'abcdefghijklmnop';
    expect(mask(`token=${opaque}`, opaque)).toBe('token=abcd…***');
  });

  // ── [PCODE-66 | S13 | v0.1.0] the marker a person puts on a known fixture ──
  it('respects an allow marker on the line and on the line above', () => {
    const marker = ['orqiva:allow', '-', 'secret'].join('');
    expect(scanTextForSecrets(`key = ${PLANE_KEY} // ${marker}`)).toEqual([]);
    expect(
      scanTextForSecrets(`// ${marker}
key = ${PLANE_KEY}`),
    ).toEqual([]);
    // and only those two lines: a marker does not excuse the rest of the file
    expect(
      scanTextForSecrets(`// ${marker}
filler
key = ${PLANE_KEY}`),
    ).toHaveLength(1);
  });

  it('ignores a dotted identifier that reads like an assignment', () => {
    expect(
      scanTextForSecrets('function cancelled(token: vscode.CancellationToken): boolean {'),
    ).toEqual([]);
    expect(scanTextForSecrets('const apiKey = input.apiKey.trim();')).toEqual([]);
    expect(scanTextForSecrets('password: models.CharField.max_length')).toEqual([]);
  });
});

// ── [PCODE-66 | S13 | v0.1.0] false positives: everything this repository is full of ──
describe('secret rules: what must NOT be found', () => {
  const clean: [string, string][] = [
    [
      'a fixture key of the wrong length',
      "expect(redact('key plane_api_0123456789abcdef0123 here'))",
    ],
    ['a self-describing fixture', "const DUMMY = 'plane_api_e2e_dummy_key_0123456789';"],
    ['an uppercase-prefixed word', 'PLANE_API_KEY=plane_api_not_a_real_key'],
    ['a value read from the environment', 'const key = process.env.API_KEY;'],
    ['a placeholder in documentation', 'api_key = <your-api-key-here>'],
    ['a short value', 'password = "short"'],
    ['a settings name', 'orqiva.plane.apiKey'],
    ['a test value', "apiKey: 'test-value-1234567890'"],
    ['the AWS prefix without a key', 'AKIA is the prefix of an access key id'],
  ];
  for (const [name, line] of clean) {
    it(`ignores ${name}`, () => {
      expect(scanTextForSecrets(line), line).toEqual([]);
    });
  }
});

describe('the scan walk', () => {
  it('skips the same directories as the fingerprint scanner, and binaries', () => {
    expect(isScannableFile('a/b/c.ts')).toBe(true);
    expect(isScannableFile('.env')).toBe(true); // no extension: exactly where a key lives
    expect(isScannableFile('config.json')).toBe(true);
    expect(isScannableFile('Dockerfile')).toBe(true);
    expect(isScannableFile('logo.png')).toBe(false);
    expect(isScannableFile('bundle.min.js')).toBe(false);
    expect(isScannableFile('x.ts.map')).toBe(false);
  });

  it('never descends into node_modules, .git or dist', () => {
    const tree: Record<string, string[]> = {
      '/p': ['src', 'node_modules', '.git', 'dist', '.github', '.env'],
      '/p/src': ['a.ts'],
      '/p/node_modules': ['evil.js'],
      '/p/.git': ['config'],
      '/p/dist': ['out.js'],
      '/p/.github': ['ci.yml'],
    };
    const files = new Set(['/p/src/a.ts', '/p/.env', '/p/.github/ci.yml']);
    const read: string[] = [];
    const io: ScanIo = {
      readdirSync: (p) =>
        (tree[p.replace(/\\/g, '/')] ?? []).map((name) => {
          const full = `${p.replace(/\\/g, '/')}/${name}`;
          return { name, isFile: () => !(full in tree), isDirectory: () => full in tree };
        }),
      readFileSync: (p) => {
        read.push(p.replace(/\\/g, '/'));
        return 'nothing here';
      },
      statSync: () => ({ size: 10 }),
    };
    const result = scanWorkspaceForSecrets('/p', io);
    expect(new Set(read)).toEqual(files);
    expect(result.filesScanned).toBe(3);
    expect(result.findings).toEqual([]);
  });

  it('reports the finding with a repo-relative posix path and a 1-based line', () => {
    const io: ScanIo = {
      readdirSync: (p) =>
        p.replace(/\\/g, '/') === '/p'
          ? [{ name: 'app', isFile: () => false, isDirectory: () => true }]
          : [{ name: 'settings.py', isFile: () => true, isDirectory: () => false }],
      readFileSync: () => `ok\nAWS_KEY = ${AWS_KEY}\n`,
      statSync: () => ({ size: 40 }),
    };
    const { findings } = scanWorkspaceForSecrets('/p', io);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe('app/settings.py');
    expect(findings[0]?.line).toBe(2);
    expect(findings[0]?.rule).toBe('AWS access key id');
  });

  it('summarises a run', () => {
    expect(secretScanSummary({ findings: [], filesScanned: 412 })).toBe(
      'nothing found in 412 file(s)',
    );
    expect(
      secretScanSummary({
        findings: [
          { file: 'a.ts', line: 1, rule: 'r', excerpt: 'e' },
          { file: 'a.ts', line: 9, rule: 'r', excerpt: 'e' },
        ],
        filesScanned: 10,
      }),
    ).toBe('2 finding(s) in 1 file(s)');
  });
});

// ── [PCODE-66 | S13 | v0.1.0] the acceptance, run for real against this repository ──
describe('the scan on this repository', () => {
  it('finds nothing in orqiva itself', () => {
    const { findings, filesScanned } = scanWorkspaceForSecrets(REPO);
    expect(filesScanned).toBeGreaterThan(50);
    expect(findings.map((f) => `${f.file}:${String(f.line)} ${f.rule}`)).toEqual([]);
  });

  it('finds a key planted in a temp folder, with its path and line', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-secret-'));
    try {
      fs.mkdirSync(path.join(dir, 'conf'));
      fs.writeFileSync(
        path.join(dir, 'conf', 'app.env'),
        ['# config', 'DEBUG=1', `PLANE_API_KEY=${PLANE_KEY}`, ''].join('\n'),
        'utf8',
      );
      const { findings } = scanWorkspaceForSecrets(dir);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.file).toBe('conf/app.env');
      expect(findings[0]?.line).toBe(3);
      expect(findings[0]?.rule).toBe('Legacy tracker API key');
      expect(findings[0]?.excerpt).not.toContain(PLANE_KEY.slice(-8));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── [PCODE-66 | S13 | v0.1.0] npm audit ──
describe('parseNpmAudit', () => {
  it('reads the severity counts from the v7+ metadata', () => {
    const json = JSON.stringify({
      metadata: {
        vulnerabilities: { info: 0, low: 3, moderate: 2, high: 1, critical: 0, total: 6 },
      },
    });
    expect(parseNpmAudit(json)).toEqual({
      critical: 0,
      high: 1,
      moderate: 2,
      low: 3,
      info: 0,
      total: 6,
    });
    expect(npmAuditSummary(parseNpmAudit(json))).toBe('1 high, 2 moderate, 3 low');
  });

  it('is empty for a clean project, for junk and for an unexpected shape', () => {
    const clean = JSON.stringify({
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
    });
    expect(parseNpmAudit(clean)).toEqual(EMPTY_AUDIT);
    expect(npmAuditSummary(parseNpmAudit(clean))).toBe('no known vulnerabilities');
    expect(parseNpmAudit('not json at all')).toEqual(EMPTY_AUDIT);
    expect(parseNpmAudit('{"something":"else"}')).toEqual(EMPTY_AUDIT);
  });
});

describe('runNpmAudit', () => {
  const runner =
    (out: string, code = 1): CommandRunner =>
    () =>
      Promise.resolve({ code, stdout: out, stderr: '' });

  it('treats a non-zero exit as findings, not as failure', async () => {
    const json = JSON.stringify({ metadata: { vulnerabilities: { high: 2, moderate: 1 } } });
    const r = await runNpmAudit('/p', runner(json), () => true);
    expect(r.unavailable).toBeUndefined();
    expect(r.summary).toBe('2 high, 1 moderate');
    expect(r.counts?.total).toBe(3);
  });

  it('says why it cannot run instead of reporting a clean project', async () => {
    expect((await runNpmAudit('/p', runner('{}'), () => false)).unavailable).toBe(
      'no package.json in this project',
    );
    const silent = await runNpmAudit(
      '/p',
      () => Promise.resolve({ code: 1, stdout: '', stderr: 'ENOENT npm' }),
      () => true,
    );
    expect(silent.unavailable).toContain('ENOENT npm');
    const broken = await runNpmAudit(
      '/p',
      () => Promise.reject(new Error('spawn failed')),
      () => true,
    );
    expect(broken.unavailable).toContain('spawn failed');
  });
});

describe('pip-audit', () => {
  it('counts vulnerabilities across both JSON shapes', () => {
    const bare = JSON.stringify([
      { name: 'a', vulns: [{ id: 'X' }, { id: 'Y' }] },
      { name: 'b', vulns: [] },
    ]);
    expect(parsePipAudit(bare)).toEqual({ vulnerabilities: 2, packages: 1 });
    const wrapped = JSON.stringify({ dependencies: [{ name: 'c', vulns: [{ id: 'Z' }] }] });
    expect(parsePipAudit(wrapped)).toEqual({ vulnerabilities: 1, packages: 1 });
    expect(parsePipAudit('nonsense')).toEqual({ vulnerabilities: 0, packages: 0 });
  });

  it('runs only when a Python manifest exists and the module is installed', async () => {
    const noManifest = await runPipAudit(
      '/p',
      () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
      ['py', '-3'],
      () => false,
    );
    expect(noManifest.unavailable).toBe('no Python manifest in this project');

    const notInstalled = await runPipAudit(
      '/p',
      () => Promise.resolve({ code: 1, stdout: '', stderr: 'No module named pip_audit' }),
      ['py', '-3'],
      () => true,
    );
    expect(notInstalled.unavailable).toContain('pip-audit is not installed');

    const calls: string[][] = [];
    const ok = await runPipAudit(
      '/p',
      (cmd, args) => {
        calls.push([cmd, ...args]);
        return Promise.resolve({
          code: 0,
          stdout:
            calls.length === 1 ? '2.7.3' : JSON.stringify([{ name: 'a', vulns: [{ id: 'X' }] }]),
          stderr: '',
        });
      },
      ['py', '-3'],
      () => true,
    );
    expect(calls[0]).toEqual(['py', '-3', '-m', 'pip_audit', '--version']);
    expect(ok.summary).toBe('1 vulnerability in 1 package(s)');
  });
});

// ── [PCODE-66 | S13 | v0.1.0] the dated line under the item, and nothing else touched ──
describe('the note written under a checklist item', () => {
  const sample = [
    '# Security checklist',
    '',
    '## Dependencies',
    '',
    '- [ ] The lock file is committed and the build installs from it.',
    '- [ ] `npm audit` reports no unfixed high or critical finding.',
    '      _Record the date of the last run._',
    '- [x] Dependencies come from the official registry.',
    '',
  ].join('\n');

  it('adds the line under the right item, leaving every other line untouched', () => {
    const next = setNote(sample, 1, noteLine('npm audit — 1 high, 2 moderate', '2026-10-09'));
    const before = sample.split('\n');
    const after = next.split('\n');
    expect(after).toHaveLength(before.length + 1);
    expect(after[6]).toBe('      _Last run 2026-10-09: npm audit — 1 high, 2 moderate_');
    expect(after[7]).toBe('      _Record the date of the last run._');
    // the item itself is unchanged - nothing is ticked by a run
    expect(after[5]).toBe(before[5]);
    expect(after[8]).toBe(before[7]);
    expect(parseChecklist(next).checked).toBe(1);
  });

  it('replaces its own line on the next run instead of stacking them', () => {
    const once = setNote(sample, 1, noteLine('npm audit — 1 high', '2026-10-09'));
    const twice = setNote(once, 1, noteLine('npm audit — no known vulnerabilities', '2026-10-10'));
    expect(twice.split('\n')).toHaveLength(sample.split('\n').length + 1);
    expect(twice).toContain('Last run 2026-10-10: npm audit — no known vulnerabilities');
    expect(twice).not.toContain('2026-10-09');
  });

  it('keeps the note out of the hint the panel shows', () => {
    const next = setNote(sample, 1, noteLine('npm audit — 1 high', '2026-10-09'));
    const item = parseChecklist(next).sections[0]?.items[1];
    expect(item?.hint).toBe('Record the date of the last run.');
    expect(item?.note).toBe('Last run 2026-10-09: npm audit — 1 high');
  });

  it('is a no-op for an index that is not in the file', () => {
    expect(setNote(sample, 99, 'x')).toBe(sample);
  });
});

describe('runCheck', () => {
  it('reports the secret scan without writing when asked not to', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-check-'));
    try {
      fs.writeFileSync(path.join(dir, 'ok.ts'), 'const x = 1;\n', 'utf8');
      const r = await runCheck('secrets', { root: dir, write: false });
      expect(r.id).toBe('secrets');
      expect(r.label).toBe('Secret scan');
      expect(r.summary).toContain('nothing found');
      expect(r.findings).toEqual([]);
      expect(fs.existsSync(path.join(dir, '.plane', 'security.md'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the dated line under the checklist item it answers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-check-'));
    try {
      fs.mkdirSync(path.join(dir, '.plane'));
      fs.writeFileSync(
        path.join(dir, '.plane', 'security.md'),
        '## Secrets and config\n\n- [ ] No credential is committed — tokens live in a secret store.\n',
        'utf8',
      );
      fs.writeFileSync(path.join(dir, 'ok.ts'), 'const x = 1;\n', 'utf8');
      await runCheck('secrets', { root: dir, today: () => new Date(2026, 9, 9) });
      const written = fs.readFileSync(path.join(dir, '.plane', 'security.md'), 'utf8');
      expect(written).toContain('_Last run 2026-10-09: Secret scan — nothing found in');
      // still unticked: a machine does not answer this item
      expect(parseChecklist(written).checked).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('formats the day the way the note reads', () => {
    expect(isoDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
