// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-10 | S02 | v0.1.0] Add .plane readers and types for project, active, queue, plan and published ──
//    Why:  guard for criticals #3 (no write API for engine files) plus the tolerant-reader contract.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as files from '../../src/state/files';
import { findProject, findProjectFrom } from '../../src/state/project';

const WORKSPACE = path.resolve(__dirname, '..', 'fixtures', 'workspace');
const STATE = path.resolve(__dirname, '..', 'fixtures', 'plane-state');

describe('readers on the fixture workspace', () => {
  it('reads the link and the active task', () => {
    expect(files.readProjectLink(WORKSPACE)?.identifier).toBe('FIX');
    const active = files.readActiveTask(WORKSPACE);
    expect(active?.task).toBe('FIX-2');
    expect(active?.files).toEqual(['src/sample.ts']);
    expect(files.readText(WORKSPACE, 'sprintsMd')).toContain('## Sprint 01');
    expect(files.readText(WORKSPACE, 'security')).toBeNull();
  });

  // ── [PCODE-10 | S02 | v0.1.0] queue and published come from a read-only fixture folder ──
  it('counts the queue and reads the published state', () => {
    const io = files.PLANE_FILES;
    expect(io.queue.join('/')).toBe('state/queue.jsonl'); // [PCODE-455 | S15 | v0.1.0] inside .plane or .orqiva
    const root = path.join(os.tmpdir(), `orqiva-files-${process.pid}`);
    fs.mkdirSync(path.join(root, '.plane', 'state'), { recursive: true });
    fs.copyFileSync(path.join(STATE, 'queue.jsonl'), files.planePath(root, 'queue'));
    fs.copyFileSync(path.join(STATE, 'published.json'), files.planePath(root, 'published'));
    expect(files.queueLength(root)).toBe(2);
    expect(files.readQueue(root).map((e) => e.method)).toEqual(['POST', 'PATCH']);
    expect(Object.keys(files.readPublished(root)?.items ?? {})).toHaveLength(2);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('tolerance', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-tol-'));
    fs.mkdirSync(path.join(root, '.plane', 'state'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns null and warns on a truncated active.json, never throws', () => {
    fs.writeFileSync(
      files.planePath(root, 'active'),
      '{"task": "FIX-2", "issue_id": "x", "title": "t", "fi',
    );
    const warnings: string[] = [];
    expect(files.readActiveTask(root, (m) => warnings.push(m))).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Malformed JSON');
    expect(files.readActiveTask(path.join(root, 'nowhere'))).toBeNull();
  });

  it('skips bad queue lines with a warning', () => {
    fs.writeFileSync(
      files.planePath(root, 'queue'),
      '{"id":"a","method":"POST","path":"/x"}\nnot json\n\n{"id":"b"}\n',
    );
    const warnings: string[] = [];
    expect(files.readQueue(root, (m) => warnings.push(m))).toHaveLength(1);
    expect(warnings).toHaveLength(2);
    expect(files.queueLength(root)).toBe(3); // the engine counts non-empty lines the same way
  });
});

// ── [PCODE-10 | S02 | v0.1.0] no_write_api_for_engine_files (criticals #3) ──
describe('no_write_api_for_engine_files', () => {
  it('exports only read functions', () => {
    const names = Object.keys(files).filter(
      (k) => typeof (files as Record<string, unknown>)[k] === 'function',
    );
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) expect(n).not.toMatch(/write|save|update|delete|remove|append|set/i);
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'state', 'files.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/writeFile|appendFile|unlink|rmSync|renameSync|mkdir/);
  });
});

describe('findProject', () => {
  it('resolves the root from a subfolder and skips fixture links met on the way up', () => {
    const fromSub = findProjectFrom(path.join(WORKSPACE, 'src'));
    // the fixture's own link is marked fixture:true, so the walk continues up to the orqiva repo
    expect(fromSub?.link.identifier).toBe('PCODE');
    // [PCODE-84 | S08 | v0.1.0] the repository root is two levels above packages/extension
    expect(fromSub?.root).toBe(path.resolve(__dirname, '..', '..', '..', '..'));
    // opened directly, the fixture folder is the intended project
    expect(findProjectFrom(WORKSPACE)?.link.identifier).toBe('FIX');
    expect(findProject([path.join(os.tmpdir(), 'no-project-here')])).toBeNull();
  });

  it('accepts a link without the fixture flag through injected fs', () => {
    const io = {
      existsSync: (p: string) => p.endsWith(path.join('proj', '.plane', 'project.json')),
      readFileSync: () =>
        JSON.stringify({
          project_id: 'p',
          identifier: 'ABC',
          name: 'n',
          workspace: 'w',
          version: '0.1.0',
        }),
    };
    const found = findProject([path.join('C:', 'proj', 'deep', 'er')], io);
    expect(found?.root).toBe(path.resolve(path.join('C:', 'proj')));
    expect(found?.link.identifier).toBe('ABC');
  });
});

// -- [PCODE-61 | S12 | v0.1.0] Harden engine spawning for paths with spaces and non-Windows shells --
//    Why:  a folder opened through an 8.3 short name is the same folder under a second spelling, and the
//          watcher, the document uris and the fingerprint paths all arrive in the long one. If the root
//          keeps the short spelling, none of them match it and the active task silently stops updating.
describe('the root is canonical', () => {
  const short = path.join('C:', 'Users', 'ADMINI~1', 'Temp', 'Pruef Ordner', 'mein projekt');
  const long = path.join('C:', 'Users', 'Administrator', 'Temp', 'Pruef Ordner', 'mein projekt');
  const link = {
    project_id: 'p',
    identifier: 'ABC',
    name: 'n',
    workspace: 'w',
    version: '0.1.0',
  };
  const io = (realpath?: (p: string) => string) => ({
    existsSync: (f: string) => f === path.join(short, '.plane', 'project.json'),
    readFileSync: () => JSON.stringify(link),
    ...(realpath ? { realpath } : {}),
  });

  it('resolves a short path to the spelling the file system uses', () => {
    const seen: string[] = [];
    const found = findProjectFrom(
      short,
      io((f) => {
        seen.push(f);
        return long;
      }),
    );
    expect(found?.root).toBe(long);
    expect(seen).toEqual([short]);
  });

  it('keeps the path when the platform cannot resolve it, and when there is no resolver', () => {
    const thrown = findProjectFrom(
      short,
      io(() => {
        throw new Error('ENOENT');
      }),
    );
    expect(thrown?.root).toBe(short);
    expect(findProjectFrom(short, io())?.root).toBe(short);
  });
});
