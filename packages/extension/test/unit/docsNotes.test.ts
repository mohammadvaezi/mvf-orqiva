// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-43 | S08 | v0.1.0] Post the documentation link as a Plane comment on each task via plane note ──
//    Why:  only changed pages are posted, the argv is `note <ref> <text>`, a flood asks first, the setting
//          switches it off - and against the fake engine a second, unchanged run posts nothing at all.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateDocumentation } from '../../src/commands/docsCommands';
import { EngineCommands } from '../../src/engine/commands';
import { runEngine } from '../../src/engine/run';
import type { GeneratedPage } from '../../src/docs/generate';
import {
  CONFIRM_ABOVE,
  changedTaskPages,
  hashPage,
  noteText,
  postNotes,
  readDocsIndex,
  writeDocsIndex,
} from '../../src/docs/notes';
import type { Services } from '../../src/services';
import { boardFromSprintsMd } from '../../src/state/board';
import { parseSprintsMd } from '../../src/state/sprintsMd';
import { Store } from '../../src/state/store';
import { Logger, resetLoggerForTests } from '../../src/util/log';
import { writeTree } from '../fixtures/fingerprints/tree';
import { resetRecorded } from '../mocks/vscode';

const FAKE_SOURCE = path.resolve(__dirname, '..', 'fixtures', 'fake-engine');
const SPRINTS_MD =
  '## Sprint 01 - Foundation (2026-01-01) — 0/1 done\n- [ ] DOC-1 Read the configuration — In Progress (high)\n';

const page = (rel: string, text: string, task?: string): GeneratedPage =>
  task ? { rel, text, task } : { rel, text };

const noWait = () => Promise.resolve();

describe('docs notes', () => {
  let out = '';
  beforeEach(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-notes-'));
  });
  afterEach(() => {
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('records the page hashes and reads them back', () => {
    const pages = [page('README.md', 'a'), page('tasks/DOC-1.md', 'b', 'DOC-1')];
    expect(readDocsIndex(out).pages).toEqual({});
    const written = writeDocsIndex(out, pages, { version: '1.2.3', generatedAt: '2026-02-02' });
    expect(written.pages).toEqual({ 'README.md': hashPage('a'), 'tasks/DOC-1.md': hashPage('b') });
    expect(readDocsIndex(out)).toEqual(written);
    fs.writeFileSync(path.join(out, '.index.json'), '{ broken', 'utf8');
    expect(readDocsIndex(out)).toEqual({ version: '', generatedAt: '', pages: {} });
  });

  // ── [PCODE-43 | S08 | v0.1.0] only task pages, only changed ones ──
  it('picks the changed task pages only', () => {
    const pages = [
      page('README.md', 'readme changed', undefined),
      page('sprints/S01.md', 'sprint changed'),
      page('tasks/DOC-1.md', 'same', 'DOC-1'),
      page('tasks/DOC-2.md', 'new text', 'DOC-2'),
    ];
    const previous = {
      version: '1.0.0',
      generatedAt: '2026-01-01',
      pages: { 'README.md': hashPage('old'), 'tasks/DOC-1.md': hashPage('same') },
    };
    expect(changedTaskPages(pages, previous).map((c) => c.ref)).toEqual(['DOC-2']);
    expect(
      changedTaskPages(pages, { version: '', generatedAt: '', pages: {} }).map((c) => c.ref),
    ).toEqual(['DOC-1', 'DOC-2']);
  });

  it('writes one note per changed page through the engine', async () => {
    const calls: string[][] = [];
    const engine = {
      note: (ref: string, text: string) => {
        calls.push([ref, text]);
        return Promise.resolve();
      },
    };
    const changes = changedTaskPages(
      [page('tasks/DOC-1.md', 'x', 'DOC-1'), page('tasks/DOC-2.md', 'y', 'DOC-2')],
      { version: '', generatedAt: '', pages: {} },
    );
    const waits: number[] = [];
    const r = await postNotes(changes, {
      engine,
      outFolder: 'docs/generated',
      version: '0.2.0',
      date: '2026-02-02',
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(r).toEqual({ posted: ['DOC-1', 'DOC-2'], failed: [], skipped: null });
    expect(calls[0]).toEqual([
      'DOC-1',
      'Docs — docs/generated/tasks/DOC-1.md (v0.2.0, 2026-02-02)',
    ]);
    expect(waits).toEqual([1000]); // one second between notes, none before the first
    expect(noteText('docs/api', 'tasks/X-1.md', '1.0.0', '2026-01-01')).toBe(
      'Docs — docs/api/tasks/X-1.md (v1.0.0, 2026-01-01)',
    );
  });

  it('asks above the limit, skips when disabled, and survives a failing note', async () => {
    const many = Array.from({ length: CONFIRM_ABOVE + 1 }, (_, i) =>
      page(`tasks/DOC-${String(i)}.md`, String(i), `DOC-${String(i)}`),
    );
    const changes = changedTaskPages(many, { version: '', generatedAt: '', pages: {} });
    let asked = 0;
    const engine = { note: () => Promise.resolve() };
    const declined = await postNotes(changes, {
      engine,
      outFolder: 'docs/generated',
      version: '1',
      date: 'd',
      confirm: (n) => {
        asked = n;
        return Promise.resolve(false);
      },
      wait: noWait,
    });
    expect(declined.skipped).toBe('declined');
    expect(asked).toBe(CONFIRM_ABOVE + 1);
    const off = await postNotes(changes, {
      engine,
      outFolder: 'docs/generated',
      version: '1',
      date: 'd',
      enabled: false,
      wait: noWait,
    });
    expect(off.skipped).toBe('disabled');
    const failing = await postNotes(changes.slice(0, 2), {
      engine: {
        note: (ref: string) =>
          ref === 'DOC-0' ? Promise.reject(new Error('no such task')) : Promise.resolve(),
      },
      outFolder: 'docs/generated',
      version: '1',
      date: 'd',
      wait: noWait,
    });
    expect(failing).toMatchObject({ posted: ['DOC-1'], failed: ['DOC-0'] });
  });
});

// ── [PCODE-43 | S08 | v0.1.0] the whole command against the fake engine: notes once, then none ──
describe('generateDocumentation notes (fake engine, real python)', () => {
  const python = (() => {
    for (const c of [['py', '-3'], ['python3'], ['python']]) {
      const r = spawnSync(c[0] ?? '', [...c.slice(1), '--version'], { encoding: 'utf8' });
      if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return c;
    }
    return null;
  })();
  let root = '';
  // the fake engine is copied per test: its calls.jsonl is shared, and vitest runs the files in parallel
  let engineHome = '';
  let calls = '';
  beforeEach(() => {
    resetRecorded();
    resetLoggerForTests();
    root = writeTree(fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-notes-run-')));
    engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-notes-engine-'));
    fs.copyFileSync(
      path.join(FAKE_SOURCE, 'plane_task.py'),
      path.join(engineHome, 'plane_task.py'),
    );
    calls = path.join(engineHome, 'calls.jsonl');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(engineHome, { recursive: true, force: true });
  });

  const services = (): Services => {
    const store = new Store();
    store.state.root = root;
    store.state.link = {
      project_id: 'p1',
      identifier: 'DOC',
      name: 'Fixture',
      workspace: 'ws',
      version: '0.1.0',
    };
    store.state.sprints = boardFromSprintsMd(parseSprintsMd(SPRINTS_MD), '2026-01-01');
    return {
      store,
      log: new Logger(),
      root: () => root,
      secrets: { hasApiKey: () => Promise.resolve(false) },
      client: {},
      engine: new EngineCommands((script, args) =>
        runEngine({ python: python ?? [], home: engineHome }, script, args, { cwd: root }),
      ),
    } as unknown as Services;
  };

  const run = async () =>
    generateDocumentation({
      services: services(),
      today: () => '2026-02-02',
      wait: noWait,
      progress: (_t, fn) =>
        fn(() => undefined, {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose: () => undefined }),
        }),
    });

  const noteCalls = (): string[][] =>
    (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [])
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as { argv: string[] }).argv)
      .filter((argv) => argv[0] === 'note');

  it.skipIf(!python)('notes every task once, then nothing on an unchanged run', async () => {
    const first = await run();
    expect(first?.notes?.posted).toEqual(['DOC-1', 'DOC-2', 'DOC-3', 'DOC-4']);
    const argv = noteCalls();
    expect(argv).toHaveLength(4);
    expect(argv[0]?.[1]).toBe('DOC-1');
    expect(argv[0]?.[2]).toBe('Docs — docs/generated/tasks/DOC-1.md (v0.1.0, 2026-02-02)');
    expect(fs.existsSync(path.join(root, 'docs', 'generated', '.index.json'))).toBe(true);

    fs.unlinkSync(calls);
    const second = await run();
    expect(second?.written).toEqual([]);
    expect(second?.notes?.posted).toEqual([]);
    expect(noteCalls()).toEqual([]);
  });
});
