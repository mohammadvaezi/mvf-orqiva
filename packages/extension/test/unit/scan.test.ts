// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-40 | S08 | v0.1.0] Implement the workspace fingerprint scanner and index matching fingerprint.py ──
//    Why:  the same files are skipped as by fingerprint.py, the index groups by sprint / task / file, the
//          rendered index matches the engine's own fingerprints.md byte for byte (run here when the engine is
//          on this machine), the scan yields between chunks and can be cancelled.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildIndex,
  collectFiles,
  compareRefs,
  renderIndexMarkdown,
  scanProject,
  type Hit,
} from '../../src/docs/scan';
import { SCANNED, writeTree } from '../fixtures/fingerprints/tree';

const EXPECTED = path.resolve(__dirname, '..', 'fixtures', 'fingerprints', 'expected-index.md');

const rel = (root: string, files: string[]): string[] =>
  files.map((f) => path.relative(root, f).replace(/\\/g, '/')).sort();

describe('scanProject', () => {
  let root = '';
  beforeEach(() => {
    root = writeTree(fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-docs-scan-')));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ── [PCODE-40 | S08 | v0.1.0] skips_same_dirs_and_exts ──
  it('skips the same directories and extensions as fingerprint.py', () => {
    expect(rel(root, collectFiles(root))).toEqual(SCANNED);
  });

  it('groups the markers by sprint, task and file', async () => {
    const index = await scanProject(root, { chunkSize: 2 });
    expect(index.files).toBe(SCANNED.length);
    expect(index.hits).toBe(11);
    expect([...index.bySprint.keys()].sort()).toEqual(['S01', 'S02', 'S03']);
    expect([...(index.bySprint.get('S01') ?? new Map()).keys()]).toEqual(['DOC-1']);
    expect([...(index.bySprint.get('S02') ?? new Map()).keys()].sort(compareRefs)).toEqual([
      'DOC-2',
      'DOC-3',
    ]);
    const doc1 = index.byTask.get('DOC-1');
    // the title is the first marker met while walking (Dockerfile, a root file, before app/), and the
    // engine strips '-', '—' and spaces from it - not the box-drawing '──' of a header line
    expect(doc1?.title).toBe('Runtime image ──');
    expect(doc1?.versions).toEqual(['0.1.0', '0.2.0']);
    expect(doc1?.hits.map((h) => `${h.file}:${String(h.line)} ${h.kind}`)).toEqual([
      'Dockerfile:1 header',
      'app/x.py:1 header',
      'app/x.py:4 block',
      'src/a.ts:2 header',
    ]);
    expect([...(index.byFile.get('src/a.ts') ?? [])].sort(compareRefs)).toEqual(['DOC-1', 'DOC-2']);
    expect(index.byFile.has('README.md')).toBe(false);
    expect(index.byTask.has('DOC-9')).toBe(false);
  });

  // ── [PCODE-40 | S08 | v0.1.0] the rendered index is the engine's fingerprints.md ──
  it('renders the index exactly like fingerprint.py write_index', async () => {
    const md = renderIndexMarkdown(await scanProject(root));
    await expect(md).toMatchFileSnapshot(EXPECTED);
    const withLink = renderIndexMarkdown(await scanProject(root), {
      name: 'Fixture',
      identifier: 'DOC',
    });
    expect(withLink).toContain('Project: Fixture (`DOC`)');
  });

  it('reports progress per chunk, yields between them and stops when cancelled', async () => {
    const progress: number[] = [];
    let yields = 0;
    const index = await scanProject(root, {
      chunkSize: 2,
      onProgress: (p) => progress.push(p.files),
      yieldTo: () => {
        yields++;
        return Promise.resolve();
      },
    });
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(SCANNED.length);
    expect(yields).toBeGreaterThanOrEqual(3);
    expect(index.files).toBe(SCANNED.length);

    const cancel = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => undefined }),
    };
    const partial = await scanProject(root, {
      chunkSize: 2,
      cancel,
      yieldTo: () => {
        cancel.isCancellationRequested = true;
        return Promise.resolve();
      },
    });
    expect(partial.files).toBe(2);
  });

  it('builds the same index from hits alone (pure)', () => {
    const hits: Hit[] = [
      {
        task: 'A-2',
        sprint: 'S01',
        version: '0.1.0',
        title: 'Two',
        line: 5,
        kind: 'header',
        file: 'b.ts',
      },
      {
        task: 'A-10',
        sprint: 'S01',
        version: '0.1.0',
        title: 'Ten',
        line: 1,
        kind: 'header',
        file: 'a.ts',
      },
      {
        task: 'A-2',
        sprint: 'S01',
        version: '0.2.0',
        title: '',
        line: 2,
        kind: 'block',
        file: 'a.ts',
      },
    ];
    const index = buildIndex(hits);
    expect(index.byTask.get('A-2')?.hits.map((h) => h.file)).toEqual(['a.ts', 'b.ts']);
    expect(index.byTask.get('A-2')?.versions).toEqual(['0.1.0', '0.2.0']);
    // tasks sort numerically, like the engine
    expect(renderIndexMarkdown(index)).toContain(
      '- **A-2** Two _(v0.1.0, 0.2.0)_\n  - `a.ts:2` block',
    );
    expect(renderIndexMarkdown(index).indexOf('**A-2**')).toBeLessThan(
      renderIndexMarkdown(index).indexOf('**A-10**'),
    );
  });
});

// ── [PCODE-40 | S08 | v0.1.0] parity: the engine's own index over the same tree, when it is on this machine ──
describe('parity with fingerprint.py', () => {
  const home = process.env['PLANE_CLAUDE_HOME'] ?? '';
  const script = path.join(home, 'fingerprint.py');
  const python = (() => {
    for (const c of [['py', '-3'], ['python3'], ['python']]) {
      const r = spawnSync(c[0] ?? '', [...c.slice(1), '--version'], { encoding: 'utf8' });
      if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return c;
    }
    return null;
  })();

  // ── [PCODE-40 | S08 | v0.1.0] opt-in: a real project (ORQIVA_PARITY_ROOT) against its own index ──
  const realRoot = process.env['ORQIVA_PARITY_ROOT'] ?? '';
  it.skipIf(!realRoot || !python || !fs.existsSync(script))(
    'finds the same markers as the engine in a real project',
    async () => {
      const t0 = performance.now();
      const index = await scanProject(realRoot);
      const ms = Math.round(performance.now() - t0);
      // `scan --json` reads the tree and writes nothing - the project's own index stays untouched
      const r = spawnSync(
        python?.[0] ?? '',
        [...(python ?? []).slice(1), script, 'scan', '--json', '--root', realRoot],
        { encoding: 'utf8', cwd: realRoot, maxBuffer: 32 * 1024 * 1024 },
      );
      expect(r.status).toBe(0);
      const theirs = (JSON.parse(r.stdout) as Hit[]).map(
        (h) => `${h.file}:${String(h.line)} ${h.task} ${h.kind}`,
      );
      const ours = [...index.byTask.values()]
        .flatMap((t) => t.hits)
        .map((h) => `${h.file}:${String(h.line)} ${h.task} ${h.kind}`);
      console.log(
        `parity ${realRoot}: ${String(index.files)} files, ${String(index.hits)} hits, ${String(index.byTask.size)} tasks in ${String(ms)} ms`,
      );
      expect([...ours].sort()).toEqual([...theirs].sort());
    },
  );

  it.skipIf(!python || !home || !fs.existsSync(script))(
    'writes the same fingerprints.md as our renderer',
    () => {
      const root = writeTree(fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-parity-')));
      try {
        const r = spawnSync(
          python?.[0] ?? '',
          [...(python ?? []).slice(1), script, 'index', '--root', root],
          { encoding: 'utf8', cwd: root },
        );
        expect(r.status).toBe(0);
        // Python writes the file in text mode: CRLF on Windows, LF elsewhere - compare the content
        const engineMd = fs
          .readFileSync(path.join(root, '.plane', 'fingerprints.md'), 'utf8')
          .replace(/\r\n/g, '\n');
        expect(engineMd).toBe(fs.readFileSync(EXPECTED, 'utf8'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
