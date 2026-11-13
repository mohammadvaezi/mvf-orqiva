// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-9 | S02 | v0.1.0] Add typed engine commands and output parsers for list, show, active, start, done ──
//    Why:  every fixture in test/fixtures/engine-output/ was captured from the real engine; the parsers must
//          read all of them and refuse garbage with a OrqivaError.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as p from '../../src/engine/parse';
import { EngineCommands } from '../../src/engine/commands';
import { OrqivaError } from '../../src/util/errors';

const DIR = path.resolve(__dirname, '..', 'fixtures', 'engine-output');
const fx = (name: string): string => fs.readFileSync(path.join(DIR, name), 'utf8');

describe('parsers on captured engine output', () => {
  it('list: sprints, items, active', () => {
    const r = p.parseList(fx('list.txt'));
    expect(r.sprints.length).toBeGreaterThan(10);
    expect(r.sprints[0]?.name).toBe('Sprint 01 - Foundation');
    expect(r.sprints[0]?.date).toBe('2026-09-23');
    expect(r.sprints[0]?.items[0]).toEqual({
      ref: 'LTR-2',
      state: 'Review',
      priority: 'urgent',
      title: 'Bootstrap FastAPI backend with uv, ruff, mypy, pytest',
    });
    expect(r.active).toBeNull();
    const withActive = p.parseList(
      '## S (2026-01-01)\n- FIX-2 [In Progress] (medium) T\n\nActive: FIX-2 T\n',
    );
    expect(withActive.active).toEqual({ ref: 'FIX-2', title: 'T' });
  });

  it('show: header, description, acceptance, comments, files', () => {
    const r = p.parseShow(fx('show.txt'));
    expect(r.ref).toBe('LTR-1');
    expect(r.state).toBe('Review');
    expect(r.priority).toBe('urgent');
    expect(r.url).toMatch(/^https:\/\/plan\.broszio\.com\//);
    expect(r.description.startsWith('Create the folder layout')).toBe(true);
    expect(r.description).not.toContain('Acceptance');
    expect(r.acceptance).toHaveLength(3);
    expect(r.acceptance[0]).toEqual({
      text: 'make lint and make test run without error on the empty project',
      done: false,
    });
    expect(r.comments).toHaveLength(7);
    expect(r.comments[6]?.text).toMatch(/^Started by Claude Code/);
    expect(r.files).toEqual([]);
    const withFiles = p.parseShow(
      '# FIX-2 T\nState: Done | Priority: low | u\n\nd\n\n## Code fingerprinted for this task\n- src/a.ts:1 (header)\n- src/a.ts:9 (block)\n',
    );
    expect(withFiles.files).toEqual([
      { file: 'src/a.ts', line: 1, kind: 'header' },
      { file: 'src/a.ts', line: 9, kind: 'block' },
    ]);
  });

  it('start, done, new, sync, status, active, check', () => {
    expect(p.parseStart(fx('start.txt'))).toEqual({
      ref: 'SBX-2',
      title: 'Add goodbye endpoint',
      from: 'Planned',
      to: 'In Progress',
      fingerprint: '[SBX-2 | S01 | v0.1.0] Add goodbye endpoint',
    });
    expect(p.parseDone(fx('done.txt'))).toEqual({
      ref: 'SBX-2',
      state: 'Done',
      files: 1,
      commit: '7b0c24f',
    });
    expect(p.parseDone('XY-1 -> Review. 0 file(s). Index: .plane/fingerprints.md')).toEqual({
      ref: 'XY-1',
      state: 'Review',
      files: 0,
      commit: null,
    });
    expect(p.parseNew(fx('new.txt'))).toMatchObject({
      ref: 'SBX-1',
      title: 'Add hello endpoint',
      sprint: 'Sprint 01 - 2026-09-22',
    });
    expect(p.parseSync(fx('sync.txt'))).toEqual({ carried: 0, promoted: 6, active: null });
    expect(p.parseSync('Synced. 2 carried over. Active task: FIX-2 Add x')).toEqual({
      carried: 2,
      promoted: 0,
      active: { ref: 'FIX-2', title: 'Add x' },
    });
    expect(p.parseStatus(fx('status.txt'))).toEqual({ ref: 'SBX-2', state: 'Planned' });
    expect(p.parseActive(fx('active.txt'))).toBeNull();
    expect(
      p.parseActive(
        '{"task":"FIX-2","issue_id":"i","title":"t","sprint":"S01","sprint_name":"n","version":"0.1.0","session_id":"","host":"h","started_at":"s","files":[],"url":"u"}',
      )?.task,
    ).toBe('FIX-2');
    expect(p.parseCheck(fx('check-ok.txt'))).toEqual({
      sprints: 5,
      items: 23,
      from: '2026-09-23',
      to: '2026-09-29',
      version: '0.1.0',
      publishedAt: null,
      errors: [],
    });
    const bad = p.parseCheck(fx('check-errors.txt'));
    expect(bad.errors).toHaveLength(2);
    expect(bad.errors[1]).toBe('sprint 2 item 3: no acceptance checks');
    expect(
      p.parseCheck('1 sprint(s), 2 item(s), a to b, version 0.2.0; published 2026-09-22T13:39:57')
        .publishedAt,
    ).toBe('2026-09-22T13:39:57');
  });

  // ── [PCODE-9 | S02 | v0.1.0] garbage is refused with a OrqivaError that names the command ──
  it('rejects garbage with a clear error', () => {
    for (const fn of [
      p.parseShow,
      p.parseStart,
      p.parseDone,
      p.parseNew,
      p.parseSync,
      p.parseStatus,
      p.parseCheck,
    ]) {
      expect(() => fn('Traceback (most recent call last):\n  boom')).toThrow(OrqivaError);
    }
    expect(() => p.parseActive('{not json')).toThrow(/active/);
    expect(() => p.parseList('nothing here')).toThrow(/list/);
  });
});

// ── [PCODE-9 | S02 | v0.1.0] commands: argv per subcommand through a recording runner ──
describe('EngineCommands', () => {
  function recorder(stdoutByScript: Record<string, string>) {
    const calls: { script: string; args: string[]; timeout?: number }[] = [];
    const run = (script: string, args: string[], timeoutMs?: number) => {
      calls.push(timeoutMs === undefined ? { script, args } : { script, args, timeout: timeoutMs });
      return Promise.resolve({ code: 0, stdout: stdoutByScript[script] ?? '', stderr: '' });
    };
    return { calls, cmd: new EngineCommands(run) };
  }

  it('done maps to argv [done, REF] and parses the canned output', async () => {
    const { calls, cmd } = recorder({
      'plane_task.py':
        'Plane queue: 1 sent, 0 pending\nFIX-2 -> Review. 4 file(s), commit a1b2c3d. Index: .plane/fingerprints.md\n',
    });
    const r = await cmd.done('FIX-2');
    expect(calls[0]).toEqual({
      script: 'plane_task.py',
      args: ['done', 'FIX-2'],
      timeout: 120_000,
    });
    expect(r).toEqual({ ref: 'FIX-2', state: 'Review', files: 4, commit: 'a1b2c3d' });
  });

  it('newTask, status, install build the right argv', async () => {
    const { calls, cmd } = recorder({
      'plane_task.py':
        'Created FIX-9 New thing in Sprint 01 -> https://x/\nSBX-2 -> Blocked. No active task now.\n',
      'install.py': 'Done.',
    });
    await cmd.newTask({
      title: 'New thing',
      sprint: 'next',
      label: 'bug',
      priority: 'high',
      descFile: 'd.md',
      accept: ['a', 'b'],
    });
    await cmd.status('FIX-2', 'blocked', 'waiting');
    await cmd.install({ key: 'plane_api_x', url: 'https://p', workspace: 'ws' });
    expect(calls[0]?.args).toEqual([
      'new',
      'New thing',
      '--desc-file',
      'd.md',
      '--sprint',
      'next',
      '--label',
      'bug',
      '--priority',
      'high',
      '--accept',
      'a',
      '--accept',
      'b',
    ]);
    expect(calls[1]?.args).toEqual(['status', 'FIX-2', 'blocked', '--note', 'waiting']);
    expect(calls[2]).toEqual({
      script: 'install.py',
      args: ['--key', 'plane_api_x', '--url', 'https://p', '--workspace', 'ws'],
      timeout: 300_000,
    });
  });

  it('every wrapper documents its subcommand', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'engine', 'commands.ts'),
      'utf8',
    );
    const methods = [...src.matchAll(/^\s+(?:async )?(\w+)\(/gm)]
      .map((m) => m[1])
      .filter((n) => n !== 'constructor');
    for (const name of methods) {
      const idx = src.indexOf(`${name}(`);
      const before = src.slice(Math.max(0, idx - 220), idx);
      expect(before, `${name} lacks a JSDoc naming its engine subcommand`).toMatch(
        /\/\*\* `(plane_task|plane_plan|plane_init|install)\.py/,
      );
    }
    expect(methods.length).toBeGreaterThanOrEqual(16);
  });
});
