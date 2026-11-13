// ── [PCODE-321 | S15 | v0.1.0] T32.6 Secrets in the Git history, SARIF upload in the web app, dependency facts on findings ──
//    Why:  a secret added and later removed is still found in a real repository's history, once, from the
//          commit that added it, said to be gone from the files; one still there is said to be; code rules
//          stay out of the history scan; the dependency audit's facts travel through SARIF.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSarif, toSarif } from '@orqiva/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { addedLines, historyArgs, historySecrets } from '../src/scan/history.js';
import { scanText } from '../src/scan/scan.js';

const dir = mkdtempSync(join(tmpdir(), 'orq-history-'));
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// made at run time, so no secret-shaped text sits in this file
const TOKEN = 'ghp_' + 'Q7r8S9t0'.repeat(4) + 'U1v2';
const KEY = 'AKIA' + 'Z7Q3XK4P2M9WR5TB';

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('secrets in the history', () => {
  it('finds a removed secret once, from the commit that added it', () => {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'ada@example.org');
    git('config', 'user.name', 'Ada');
    writeFileSync(join(dir, 'config.ts'), "export const token = '" + TOKEN + "';\n");
    writeFileSync(join(dir, 'app.ts'), 'eval(input);\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    const first = git('rev-parse', 'HEAD').trim();
    // touched again with the same line, then removed: still one finding, from the first commit
    writeFileSync(join(dir, 'config.ts'), "// config\nexport const token = '" + TOKEN + "';\n");
    git('commit', '-q', '-am', 'comment');
    writeFileSync(join(dir, 'config.ts'), 'export const token = process.env.TOKEN;\n');
    writeFileSync(join(dir, 'keys.py'), "AWS_KEY = '" + KEY + "'\n");
    git('add', '.');
    git('commit', '-q', '-m', 'move the token out; add a key');
    const log = git(...historyArgs(2000));
    expect(
      addedLines(log)
        .map((a) => a.file)
        .sort(),
    ).toEqual(['app.ts', 'config.ts', 'config.ts', 'config.ts', 'keys.py']);
    // what the file scan sees now: the key is still there
    const current = scanText('keys.py', "AWS_KEY = '" + KEY + "'\n");
    const found = historySecrets(log, current);
    expect(found.map((f) => [f.rule, f.file]).sort()).toEqual([
      ['secret/aws-access-key', 'keys.py'],
      ['secret/github-token', 'config.ts'],
    ]);
    const token = found.find((f) => f.file === 'config.ts');
    expect(token?.message).toContain('added in commit ' + first.slice(0, 10));
    expect(token?.message).toContain('It is no longer in the files');
    expect(token?.message).not.toContain(TOKEN);
    expect(found.find((f) => f.file === 'keys.py')?.message).toContain(
      'It is still in the files too.',
    );
    // code rules (eval) are the file scan's business
    expect(found.some((f) => f.file === 'app.ts')).toBe(false);
    // the same history scanned again keeps its fingerprints
    expect(historySecrets(log, current).map((f) => f.fingerprint)).toEqual(
      found.map((f) => f.fingerprint),
    );
  });

  it('carries a dependency finding’s facts through SARIF', () => {
    const sarif = toSarif('pe-deps', '0.1.0', [
      {
        rule: 'GHSA-xxxx',
        severity: 'high',
        title: 'lodash@4.17.20: prototype pollution',
        message: 'm',
        file: 'package-lock.json',
        line: null,
        fingerprint: 'f',
        facts: {
          cve: 'CVE-2021-23337',
          package: 'lodash',
          version: '4.17.20',
          fixedVersion: '4.17.21',
          cvss: 7.2,
        },
      },
    ]);
    expect(readSarif(sarif)[0]?.findings[0]?.facts).toEqual({
      cve: 'CVE-2021-23337',
      package: 'lodash',
      version: '4.17.20',
      fixedVersion: '4.17.21',
      cvss: 7.2,
    });
  });
});
