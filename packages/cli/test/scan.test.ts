// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-140 | S15 | v0.1.0] Write our own secret scanner and code rules: orq scan ──
//    Fake secrets are put together at run time, so no secret-shaped text is written into the repository.
import { readSarif, toSarif } from '@orqiva/shared';
import { describe, expect, it } from 'vitest';
import { entropy, redactSecret } from '../src/scan/rules.js';
import {
  applyIgnores,
  globToRegExp,
  parseIgnore,
  scanRepository,
  scanText,
} from '../src/scan/scan.js';

const rules = (file: string, text: string): string[] => scanText(file, text).map((f) => f.rule);
const randomish = 'Q7v' + 'Zp2xR9' + 'kLm4Tw8' + 'Yb';

describe('secret rules', () => {
  it('find well-known token shapes', () => {
    expect(rules('a.ts', "const k = '" + 'AKIA' + 'Z7Q3XK4P2M9WR5TB' + "';")).toEqual([
      'secret/aws-access-key',
    ]);
    expect(rules('a.ts', 'token: ' + 'ghp_' + 'A1b2C3d4'.repeat(4) + 'E5f6')).toEqual([
      'secret/github-token',
    ]);
    expect(rules('a.env', 'SLACK=' + 'xox' + 'b-1234567890-abcdefghij')).toEqual([
      'secret/slack-token',
    ]);
    expect(
      rules('a.py', "stripe.api_key = '" + 'sk_' + 'live_' + 'a1B2c3D4e5F6g7H8i9J0k1L2' + "'"),
    ).toEqual(['secret/stripe-key', 'secret/generic']);
    expect(
      rules('a.ts', 'const key = "' + 'sk-ant-' + 'api03-' + randomish + randomish + '"'),
    ).toEqual(['secret/anthropic-key']);
    expect(rules('k.pem', '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----')).toEqual([
      'secret/private-key',
    ]);
    expect(rules('a.ts', 'PE=' + 'pe_' + 'x'.repeat(43))).toEqual(['secret/orqiva-token']);
  });

  it('find random-looking assignments, but not placeholders, variables or setting names', () => {
    expect(rules('a.ts', "password: '" + randomish + "'")).toEqual(['secret/generic']);
    expect(rules('a.ts', "password: 'aaaaaaaaaaaaaaaa'")).toEqual([]);
    expect(rules('a.ts', "password: 'your-password-here'")).toEqual([]);
    expect(rules('a.yaml', 'password: "${DB_PASSWORD}"')).toEqual([]);
    expect(rules('a.ts', "const API_KEY = 'orqiva.plane.apiKey'")).toEqual([]);
    expect(entropy('aaaa')).toBe(0);
    expect(entropy(randomish)).toBeGreaterThan(3.5);
  });

  it('never put the secret into the finding', () => {
    const value = 'ghp_' + 'A1b2C3d4'.repeat(4) + 'E5f6';
    const [f] = scanText('a.ts', 'const t = "' + value + '"');
    expect(JSON.stringify(f)).not.toContain(value);
    expect(f?.message).toContain('ghp_…');
    expect(redactSecret('abcdefghijkl')).toBe('abc…');
  });
});

describe('code rules', () => {
  it('flag risky JavaScript and TypeScript', () => {
    expect(rules('a.ts', 'eval(input)')).toEqual(['js/eval']);
    expect(rules('a.ts', 'const f = new Function("x", body)')).toEqual(['js/new-function']);
    expect(rules('a.ts', 'exec(`git log ${ref}`)')).toEqual(['js/shell-from-string']);
    expect(rules('a.ts', "child_process.exec('rm ' + name)")).toEqual(['js/shell-from-string']);
    expect(rules('a.ts', 'el.innerHTML = html')).toEqual(['js/html-injection']);
    expect(rules('a.tsx', '<div dangerouslySetInnerHTML={{ __html: x }} />')).toEqual([
      'js/html-injection',
    ]);
    expect(rules('a.ts', 'https.request({ rejectUnauthorized: false })')).toEqual(['js/tls-off']);
  });

  it('leave the safe forms alone', () => {
    expect(rules('a.ts', 'pattern.exec(`${a}`)')).toEqual([]);
    expect(rules('a.ts', "el.innerHTML = ''")).toEqual([]);
    expect(rules('a.ts', 'execFile("git", ["log", ref])')).toEqual([]);
    expect(rules('a.ts', 'const evaluate = (x) => x')).toEqual([]);
    expect(rules('a.py', 'eval(x)')).toEqual(['py/eval-exec']);
    expect(rules('a.md', 'eval(x)')).toEqual([]);
  });

  it('flag risky Python', () => {
    expect(rules('a.py', 'subprocess.run(cmd, shell=True)')).toEqual(['py/shell-true']);
    expect(rules('a.py', 'data = pickle.loads(body)')).toEqual(['py/pickle']);
    expect(rules('a.py', 'yaml.load(text)')).toEqual(['py/yaml-load']);
    expect(rules('a.py', 'yaml.load(text, Loader=yaml.SafeLoader)')).toEqual([]);
    expect(rules('a.py', 'requests.get(url, verify=False)')).toEqual(['py/tls-off']);
    expect(rules('a.py', 'hashlib.md5(data)')).toEqual(['py/weak-hash']);
    expect(rules('a.py', 'hashlib.md5(data, usedforsecurity=False)')).toEqual([]);
  });
});

describe('exceptions', () => {
  it('take a reason, on the line or the line above', () => {
    const ignored: { rule: string; reason: string }[] = [];
    const text = [
      '// pe-scan: ignore js/eval -- the sandbox runs it',
      'eval(code)',
      'eval(more) // pe-scan: ignore js/* -- same sandbox',
      'eval(x) // pe-scan: ignore js/eval',
    ].join('\n');
    expect(scanText('a.ts', text, ignored as never).map((f) => f.line)).toEqual([4]);
    expect(ignored.map((x) => x.reason)).toEqual(['the sandbox runs it', 'same sandbox']);
  });

  it('come from the repository’s ignore file, each with its reason', () => {
    expect(globToRegExp('packages/*/test/**').test('packages/cli/test/unit/a.test.ts')).toBe(true);
    expect(globToRegExp('packages/*/test/**').test('packages/cli/src/a.ts')).toBe(false);
    expect(parseIgnore('a.ts js/eval\n').problems).toEqual([
      'scan-ignore line 1 needs: <path> <rule> -- <reason>',
    ]);
    const { entries } = parseIgnore('# comment\nsrc/** js/* -- generated code we do not edit\n');
    const r = applyIgnores(
      { findings: scanText('src/x.ts', 'eval(a)\n'), files: 1, ignored: [] },
      entries,
    );
    expect(r.findings).toEqual([]);
    expect(r.ignored[0]?.reason).toBe('generated code we do not edit');
  });
});

describe('a scan', () => {
  it('reads tracked files, skips lockfiles and binaries, and keeps fingerprints stable when lines move', async () => {
    const files: Record<string, string> = {
      'src/a.ts': 'eval(x)\n',
      'package-lock.json': '"password": "' + randomish + '"',
      'img.png': 'eval(\u0000)',
    };
    const r = await scanRepository({
      listFiles: () => Promise.resolve(Object.keys(files)),
      readFile: (f) => Promise.resolve(Buffer.from(files[f] ?? '')),
    });
    expect(r.findings.map((f) => f.file)).toEqual(['src/a.ts']);
    const moved = scanText('src/a.ts', '\n\n// moved down\neval(x)\n');
    expect(moved[0]?.fingerprint).toBe(r.findings[0]?.fingerprint);
    expect(moved[0]?.line).toBe(4);
    // and travels through SARIF unchanged
    expect(readSarif(toSarif('pe-scan', '0.1.0', r.findings))[0]?.findings[0]?.fingerprint).toBe(
      r.findings[0]?.fingerprint,
    );
  });
});
