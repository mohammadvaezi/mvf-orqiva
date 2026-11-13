// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-21 | S04 | v0.1.0] List fingerprinted files in the task panel with click-to-open at line ──
//    Why:  mirrors the engine's tests/test_fingerprint.py (marker forms, header vs block, skipped dirs and
//          extensions, trailing dashes) so both scanners agree (criticals #5).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { filesForTask, scanFile, scanWorkspace, shouldScan } from '../../src/util/fingerprintScan';

describe('scanWorkspace (twin of fingerprint.py scan)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-scan-'));
    fs.mkdirSync(path.join(root, 'app'));
    fs.writeFileSync(
      path.join(root, 'app', 'x.py'),
      '# -- [SBX-2 | S01 | v0.1.0] Hello --\nimport os\n\n# [SBX-2 | S01 | v0.1.0] the handler\ndef hello():\n    pass\n' +
        '\n'.repeat(20) +
        '# [SBX-3 | S02 | v0.1.0] second task\ndef bye(): pass\n',
    );
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(
      path.join(root, 'node_modules', 'lib.js'),
      '// [SBX-9 | S01 | v0.1.0] ignored',
    );
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.github', 'workflows', 'ci.yml'),
      '# -- [SBX-5 | S01 | v0.1.0] CI --\n',
    );
    fs.mkdirSync(path.join(root, '.hidden'));
    fs.writeFileSync(path.join(root, '.hidden', 'h.py'), '# [SBX-7 | S01 | v0.1.0] hidden');
    fs.writeFileSync(path.join(root, 'data.json'), '{"x": "[SBX-8 | S01 | v0.1.0]"}');
    fs.writeFileSync(path.join(root, 'README.md'), '<!-- [SBX-6 | S01 | v0.1.0] docs -->');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ── [PCODE-21 | S04 | v0.1.0] the same cases as test_scan_and_index ──
  it('finds the same tasks, kinds and lines as the engine', () => {
    const hits = scanWorkspace(root);
    expect([...new Set(hits.map((h) => h.task))].sort()).toEqual(['SBX-2', 'SBX-3', 'SBX-5']);
    const kinds = new Set(hits.filter((h) => h.task === 'SBX-2').map((h) => `${h.line}:${h.kind}`));
    expect(kinds.has('1:header')).toBe(true);
    expect(kinds.has('4:block')).toBe(true);
    expect(hits.find((h) => h.task === 'SBX-3')?.kind).toBe('header');
    expect(hits.find((h) => h.task === 'SBX-5')?.file).toBe('.github/workflows/ci.yml');
    expect(hits.find((h) => h.task === 'SBX-2')?.title).toBe('Hello');
    expect(scanWorkspace(root, 'SBX-3')).toHaveLength(1);
    expect(filesForTask(root, 'SBX-2')).toEqual([
      { file: 'app/x.py', line: 1, kind: 'header' },
      { file: 'app/x.py', line: 4, kind: 'block' },
    ]);
    expect(scanFile(path.join(root, 'app', 'x.py'), root).map((m) => m.file)).toEqual([
      'app/x.py',
      'app/x.py',
      'app/x.py',
    ]);
  });

  it('skips the same extensions and folders', () => {
    expect(shouldScan('a.json')).toBe(false);
    expect(shouldScan('a.min.js')).toBe(false);
    expect(shouldScan('a.txt')).toBe(false);
    expect(shouldScan('README.md')).toBe(false);
    expect(shouldScan('a.py')).toBe(true);
    expect(shouldScan('Makefile')).toBe(true);
    expect(scanWorkspace(path.join(root, 'nowhere'))).toEqual([]);
  });
});
