// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-41 | S08 | v0.1.0] Generate docs/generated markdown per sprint and task from the fingerprint index ──
//    Why:  the expected markdown for the fixture (snapshots in test/fixtures/docs-expected/), a second run
//          that writes nothing, links that resolve from the page to the source file, and a task Plane knows
//          nothing about still getting a page.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boardFromSprintsMd } from '../../src/state/board';
import { parseSprintsMd } from '../../src/state/sprintsMd';
import { generateDocs, renderPages, stalePages } from '../../src/docs/generate';
import { buildModel, commentKind, type TaskDetail } from '../../src/docs/model';
import { scanProject } from '../../src/docs/scan';
import { linkInside, linkToSource, renderTask } from '../../src/docs/templates';
import { writeTree } from '../fixtures/fingerprints/tree';

const EXPECTED = path.resolve(__dirname, '..', 'fixtures', 'docs-expected');
const OUT_FOLDER = 'docs/generated';

const SPRINTS_MD = [
  '## Sprint 01 - Foundation (2026-01-01) — 1/2 done',
  '_The config is read at startup._',
  '- [x] DOC-1 Read the configuration — Done (high)',
  '- [ ] DOC-5 Not started yet — Todo (low)',
  '',
  '## Sprint 02 - Persistence (2026-01-02) — 0/2 done',
  '_Writing it back._',
  '- [ ] DOC-2 Persist the configuration — In Progress (medium)',
  '- [ ] DOC-3 Style and schema — Todo (low)',
  '',
].join('\n');

const DETAILS = new Map<string, TaskDetail>([
  [
    'DOC-1',
    {
      description: 'Read the config file at startup and expose it to the CLI.',
      acceptance: [
        { text: 'load() returns the parsed config', done: true },
        { text: 'a missing file is an error with a hint', done: false },
      ],
      comments: [
        {
          date: '2026-01-01',
          kind: commentKind('Started by Claude Code on host'),
          text: 'Started by Claude Code on host',
        },
        {
          date: '2026-01-01',
          kind: commentKind('Done. commit a1b2c3d, 3 files'),
          text: 'Done. commit a1b2c3d, 3 files',
        },
      ],
      url: 'https://plane.example.test/i/1/',
    },
  ],
  ['DOC-2', { description: 'Write the config back.', url: 'https://plane.example.test/i/2/' }],
]);

async function model(root: string) {
  return buildModel({
    index: await scanProject(root),
    board: boardFromSprintsMd(parseSprintsMd(SPRINTS_MD), '2026-01-02'),
    project: { name: 'Fixture', identifier: 'DOC', version: '0.1.0' },
    details: DETAILS,
    generatedAt: '2026-01-03',
    outFolder: OUT_FOLDER,
  });
}

describe('docs model and templates', () => {
  let root = '';
  beforeEach(() => {
    root = writeTree(fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-docs-gen-')));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('classifies the engine comments', () => {
    expect(commentKind('Started by Claude Code on host, session 1')).toBe('Start');
    expect(commentKind('Done. commit a1b2c3d, 4 file(s)')).toBe('Commit');
    expect(commentKind('DOC-1 -> Review. 4 file(s)')).toBe('Review');
    expect(commentKind('tests green (npm test)')).toBe('Test');
    expect(commentKind('DOC-1 -> Blocked. waiting for the API key')).toBe('Blocked');
    expect(commentKind('Decision: the index is sorted')).toBe('Note');
  });

  // ── [PCODE-41 | S08 | v0.1.0] the model: board data wins for title and state, the index supplies the code ──
  it('merges board and index into one sorted model', async () => {
    const m = await model(root);
    expect(m.sprints.map((s) => s.code)).toEqual(['S01', 'S02', 'S03']);
    expect(m.sprints[0]).toMatchObject({ name: 'Sprint 01 - Foundation', done: 1, total: 2 });
    expect(m.sprints[0]?.tasks).toEqual(['DOC-1', 'DOC-5']); // a board task without code is kept
    expect(m.tasks.map((t) => t.ref)).toEqual(['DOC-1', 'DOC-2', 'DOC-3', 'DOC-4']);
    const doc1 = m.tasks[0];
    expect(doc1).toMatchObject({
      title: 'Read the configuration',
      state: 'Done',
      priority: 'high',
    });
    expect(doc1?.versions).toEqual(['0.1.0', '0.2.0']);
    expect(doc1?.files.map((f) => `${f.file}:${f.lines.join(',')}`)).toEqual([
      'Dockerfile:1',
      'app/x.py:1,4',
      'src/a.ts:2',
    ]);
    expect(doc1?.offline).toBe(false);
    // DOC-4 exists only in the code: title from the marker, no Plane data
    const doc4 = m.tasks.find((t) => t.ref === 'DOC-4');
    expect(doc4).toMatchObject({ title: 'Developer commands ──', state: 'unknown', offline: true });
  });

  it('links from a page to the source file it documents', () => {
    // the page really lives at docs/generated/tasks/DOC-1.md, so the link climbs out of the folder
    expect(linkToSource(OUT_FOLDER, 'tasks/DOC-1.md', 'src/a.ts', 12)).toBe(
      '../../../src/a.ts#L12',
    );
    expect(linkToSource(OUT_FOLDER, 'sprints/S01.md', 'app/x.py')).toBe('../../../app/x.py');
    expect(linkToSource(OUT_FOLDER, 'README.md', 'src/a.ts', 1)).toBe('../../src/a.ts#L1');
    expect(linkInside('tasks/DOC-1.md', 'README.md')).toBe('../README.md');
    expect(linkInside('README.md', 'sprints/S01.md')).toBe('sprints/S01.md');
  });

  // ── [PCODE-41 | S08 | v0.1.0] the pages, byte for byte ──
  it('renders README, sprint and task pages as expected', async () => {
    const m = await model(root);
    const pages = renderPages(m);
    expect(pages.map((p) => p.rel)).toEqual([
      'README.md',
      'sprints/S01.md',
      'sprints/S02.md',
      'sprints/S03.md',
      'tasks/DOC-1.md',
      'tasks/DOC-2.md',
      'tasks/DOC-3.md',
      'tasks/DOC-4.md',
    ]);
    for (const page of pages) {
      expect(page.text.split('\n')[0]).toBe(
        '<!-- generated by Orqiva on 2026-01-03; do not edit -->',
      );
      await expect(page.text).toMatchFileSnapshot(path.join(EXPECTED, page.rel));
    }
  });

  it('gives an offline task a page that says so', async () => {
    const m = await model(root);
    const doc4 = m.tasks.find((t) => t.ref === 'DOC-4');
    if (!doc4) throw new Error('DOC-4 missing from the model');
    const text = renderTask(m, doc4);
    expect(text).toContain(
      // [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names
      '_Task details unavailable — this page was written from the code alone._',
    );
    expect(text).toContain('`Makefile` — [1](../../../Makefile#L1) (header)');
    expect(text).not.toContain('## Acceptance');
  });
});

describe('generateDocs', () => {
  let root = '';
  let out = '';
  beforeEach(() => {
    root = writeTree(fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-docs-out-')));
    out = path.join(root, 'docs', 'generated');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const input = async () => ({
    index: await scanProject(root),
    board: boardFromSprintsMd(parseSprintsMd(SPRINTS_MD), '2026-01-02'),
    project: { name: 'Fixture', identifier: 'DOC', version: '0.1.0' },
    details: DETAILS,
    generatedAt: '2026-01-03',
  });

  // ── [PCODE-41 | S08 | v0.1.0] running twice writes nothing the second time ──
  it('writes the tree once and leaves it alone on an unchanged second run', async () => {
    const first = generateDocs(await input(), { outDir: out, outFolder: OUT_FOLDER });
    expect(first.written).toHaveLength(8);
    expect(first.unchanged).toEqual([]);
    expect(fs.existsSync(path.join(out, 'tasks', 'DOC-1.md'))).toBe(true);
    const before = fs.readFileSync(path.join(out, 'README.md'), 'utf8');
    const second = generateDocs(await input(), { outDir: out, outFolder: OUT_FOLDER });
    expect(second.written).toEqual([]);
    expect(second.unchanged).toHaveLength(8);
    expect(fs.readFileSync(path.join(out, 'README.md'), 'utf8')).toBe(before);
  });

  it('write: false renders without touching the disk', async () => {
    const r = generateDocs(await input(), { outDir: out, outFolder: OUT_FOLDER, write: false });
    expect(r.pages).toHaveLength(8);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('removes the page of a task that lost its last marker', async () => {
    generateDocs(await input(), { outDir: out, outFolder: OUT_FOLDER });
    fs.writeFileSync(path.join(out, 'tasks', 'DOC-99.md'), 'stale\n');
    const pages = renderPages(buildModel({ ...(await input()), outFolder: OUT_FOLDER }));
    expect(
      stalePages(out, pages, {
        existsSync: (p) => fs.existsSync(p),
        readFileSync: (p, e) => fs.readFileSync(p, e),
        writeFileSync: () => undefined,
        mkdirSync: () => undefined,
        readdirSync: (p) => fs.readdirSync(p),
        rmSync: () => undefined,
      }),
    ).toEqual(['tasks/DOC-99.md']);
    const again = generateDocs(await input(), { outDir: out, outFolder: OUT_FOLDER });
    expect(again.removed).toEqual(['tasks/DOC-99.md']);
    expect(fs.existsSync(path.join(out, 'tasks', 'DOC-99.md'))).toBe(false);
  });
});
