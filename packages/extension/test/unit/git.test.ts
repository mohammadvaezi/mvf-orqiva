// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-45 | S09 | v0.1.0] Add git helpers: status, last tag, log since tag, tag list, dirty check ──
//    Why:  every helper against recorded git output (including the no-tag and not-a-repo cases), the task ref
//          a commit subject carries, and - when git is on this machine - a real temp repository.
import { spawnSync, type spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  changedFiles,
  currentBranch,
  headShort,
  isDirty,
  isRepo,
  lastTag,
  logSince,
  parseLog,
  parseStatus,
  refFromSubject,
  runGit,
  stage,
  tagDate,
  tags,
} from '../../src/util/git';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'git-output');
const read = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

/** a spawn that answers each `git <sub>` with recorded output */
function fakeGit(
  answers: Record<string, { stdout?: string; stderr?: string; code?: number }>,
  calls: string[][] = [],
): typeof nodeSpawn {
  return ((_command: string, args: string[]) => {
    calls.push(args);
    const key = args[0] ?? '';
    const a = answers[key] ?? { code: 0, stdout: '' };
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      killed: boolean;
      exitCode: number | null;
      kill(): boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.exitCode = null;
    child.kill = () => true;
    setTimeout(() => {
      if (a.stdout) child.stdout.emit('data', Buffer.from(a.stdout));
      if (a.stderr) child.stderr.emit('data', Buffer.from(a.stderr));
      child.exitCode = a.code ?? 0;
      child.emit('close', a.code ?? 0);
    }, 2);
    return child;
  }) as unknown as typeof nodeSpawn;
}

describe('git helpers (recorded output)', () => {
  it('reads a task ref out of a commit subject', () => {
    expect(refFromSubject('PCODE-12 Add the thing')).toBe('PCODE-12');
    expect(refFromSubject('  LTR-3 Another  ')).toBe('LTR-3');
    expect(refFromSubject('chore(plane): version 0.2.0')).toBeNull();
    expect(refFromSubject('PCODE-12')).toBeNull(); // a ref alone is not a task commit
  });

  it('parses log and status output', () => {
    const commits = parseLog(read('log.txt'));
    expect(commits).toHaveLength(4);
    expect(commits[0]).toEqual({
      hash: '3a37930',
      subject: 'PCODE-44 Add an e2e test generating docs in the fixture workspace',
      ref: 'PCODE-44',
    });
    expect(commits[3]).toMatchObject({ subject: 'chore(plane): version 0.1.0', ref: null });
    expect(parseStatus(read('status.txt'))).toEqual([
      'docs/smoke.md',
      'src/util/git.ts',
      'test/unit/git.test.ts',
    ]);
    expect(parseStatus('')).toEqual([]);
  });

  // ── [PCODE-45 | S09 | v0.1.0] each helper, with the calls it makes ──
  it('answers each question with one git call', async () => {
    const calls: string[][] = [];
    const spawn = fakeGit(
      {
        'rev-parse': { stdout: 'true\n' },
        status: { stdout: read('status.txt') },
        describe: { stdout: 'v0.1.0\n' },
        tag: { stdout: 'v0.1.0\nv0.0.9\n' },
        log: { stdout: read('log.txt') },
      },
      calls,
    );
    const o = { cwd: 'C:\\proj', spawn };
    expect(await isRepo(o)).toBe(true);
    expect(await changedFiles(o)).toHaveLength(3);
    expect(await isDirty(o)).toBe(true);
    expect(await lastTag(o)).toBe('v0.1.0');
    expect(await tags(o)).toEqual(['v0.1.0', 'v0.0.9']);
    expect((await logSince('v0.1.0', o)).map((c) => c.ref)).toEqual([
      'PCODE-44',
      'PCODE-43',
      'PCODE-42',
      null,
    ]);
    expect(calls.map((c) => c.slice(0, 2))).toEqual([
      ['rev-parse', '--is-inside-work-tree'],
      ['status', '--porcelain'],
      ['status', '--porcelain'],
      ['describe', '--tags'],
      ['tag', '--list'],
      ['log', 'v0.1.0..HEAD'],
    ]);
    // without a tag the log covers the whole history
    calls.length = 0;
    await logSince(null, o);
    expect(calls[0]).toEqual(['log', 'HEAD', '--pretty=format:%h%x09%s']);
  });

  it('treats a repo without tags, commits or git itself as an answer, not a crash', async () => {
    const noTag = {
      cwd: 'C:\\p',
      spawn: fakeGit({ describe: { code: 128, stderr: 'fatal: No names found\n' } }),
    };
    expect(await lastTag(noTag)).toBeNull();
    expect(await tags(noTag)).toEqual([]);
    const noHead = {
      cwd: 'C:\\p',
      spawn: fakeGit({ log: { code: 128, stderr: "fatal: bad revision 'HEAD'\n" } }),
    };
    expect(await logSince(null, noHead)).toEqual([]);
    const notRepo = {
      cwd: 'C:\\p',
      spawn: fakeGit({
        'rev-parse': { code: 128, stderr: 'fatal: not a git repository\n' },
        status: { code: 128, stderr: 'fatal: not a git repository\n' },
      }),
    };
    expect(await isRepo(notRepo)).toBe(false);
    // a failing status is a real error and carries git's own words
    await expect(changedFiles(notRepo)).rejects.toThrow(/git status --porcelain failed/);
  });

  it('reports a missing git as a config error', async () => {
    const spawn = ((): never => {
      throw new Error('spawn git ENOENT');
    }) as unknown as typeof nodeSpawn;
    await expect(runGit(['status'], { cwd: 'C:\\p', spawn })).rejects.toMatchObject({
      kind: 'config',
    });
  });
});

// ── [PCODE-45 | S09 | v0.1.0] the same helpers against a real repository ──
describe('git helpers (real git)', () => {
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  const available = git.status === 0;
  let root = '';
  const run = (...args: string[]): void => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };

  beforeEach(() => {
    if (!available) return;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-git-'));
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', 'test@example.test');
    run('config', 'user.name', 'Orqiva Test');
    run('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
    run('add', '-A');
    run('commit', '-qm', 'FIX-1 The first commit');
  });
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(!available)('sees a clean repo, a tag, a change and the commits since', async () => {
    const o = { cwd: root };
    expect(await isRepo(o)).toBe(true);
    expect(await isRepo({ cwd: os.tmpdir() })).toBe(false);
    expect(await isDirty(o)).toBe(false);
    expect(await lastTag(o)).toBeNull();
    expect(await currentBranch(o)).toBe('main');
    expect((await headShort(o)).length).toBeGreaterThanOrEqual(7);

    run('tag', 'v0.1.0');
    expect(await lastTag(o)).toBe('v0.1.0');
    expect(await tags(o)).toEqual(['v0.1.0']);
    expect(await tagDate('v0.1.0', o)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await logSince('v0.1.0', o)).toEqual([]);

    fs.writeFileSync(path.join(root, 'b.txt'), 'two\n');
    expect(await isDirty(o)).toBe(true);
    expect(await changedFiles(o)).toEqual(['b.txt']);
    await stage(['b.txt'], o);
    expect(await changedFiles(o)).toEqual(['b.txt']); // staged is still changed
    run('commit', '-qm', 'FIX-2 The second commit');
    expect(await isDirty(o)).toBe(false);
    const since = await logSince('v0.1.0', o);
    expect(since.map((c) => c.ref)).toEqual(['FIX-2']);
    expect(since[0]?.subject).toBe('FIX-2 The second commit');
  });
});
