// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-8 | S02 | v0.1.0] Implement the engine runner: spawn, cwd, env passthrough, output, cancellation ──
//    Why:  guard for criticals #4 (argv arrays, no shell) and the runner contract; the integration half
//          spawns the real Python against the fake engine and reads back what it recorded.
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runEngine, displayCommand, normalizeEol, type CancelToken } from '../../src/engine/run';
import { pythonCandidates } from '../../src/engine/locate';
import { OrqivaError } from '../../src/util/errors';

const FAKE_HOME = path.resolve(__dirname, '..', 'fixtures', 'fake-engine');
const CALLS = path.join(FAKE_HOME, 'calls.jsonl');

// ── [PCODE-8 | S02 | v0.1.0] a scripted child process: records the spawn call, replays output, exits ──
interface Scripted {
  stdout?: string;
  stderr?: string;
  code?: number;
  delayMs?: number;
}
function fakeSpawn(script: Scripted, calls: { command: string; args: string[]; opts: unknown }[]) {
  return ((command: string, args: string[], opts: unknown) => {
    calls.push({ command, args, opts });
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
    child.kill = () => {
      child.killed = true;
      child.exitCode = -1;
      child.emit('close', null);
      return true;
    };
    setTimeout(() => {
      if (child.killed) return;
      if (script.stdout) child.stdout.emit('data', Buffer.from(script.stdout));
      if (script.stderr) child.stderr.emit('data', Buffer.from(script.stderr));
      child.exitCode = script.code ?? 0;
      child.emit('close', script.code ?? 0);
    }, script.delayMs ?? 5);
    return child;
  }) as unknown as typeof nodeSpawn;
}

function cancelToken(): CancelToken & { cancel(): void } {
  const listeners: (() => void)[] = [];
  const t = {
    isCancellationRequested: false,
    onCancellationRequested(l: () => void) {
      listeners.push(l);
      return { dispose: () => void listeners.splice(listeners.indexOf(l), 1) };
    },
    cancel() {
      t.isCancellationRequested = true;
      listeners.forEach((l) => {
        l();
      });
    },
  };
  return t;
}

const spec = { python: ['py', '-3'], home: 'C:\\Broszio Apps\\x' };

describe('runEngine (scripted spawn)', () => {
  it('passes argv as an array with cwd, env and a path with spaces intact', async () => {
    const calls: { command: string; args: string[]; opts: unknown }[] = [];
    const lines: string[] = [];
    const r = await runEngine(spec, 'plane_task.py', ['list', '--sprint', 'today'], {
      cwd: 'C:\\Broszio Apps\\proj',
      env: { PLANE_API_KEY: 'plane_api_secret_value_1' },
      spawn: fakeSpawn({ stdout: 'ok plane_api_secret_value_1\n' }, calls),
      onLine: (l) => lines.push(l),
    });
    expect(r.code).toBe(0);
    expect(calls[0]?.command).toBe('py');
    expect(calls[0]?.args).toEqual([
      '-3',
      'C:\\Broszio Apps\\x\\plane_task.py',
      'list',
      '--sprint',
      'today',
    ]);
    const opts = calls[0]?.opts as { cwd: string; shell: boolean; env: NodeJS.ProcessEnv };
    expect(opts.cwd).toBe('C:\\Broszio Apps\\proj');
    expect(opts.shell).toBe(false);
    expect(opts.env['PLANE_API_KEY']).toBe('plane_api_secret_value_1');
    expect(opts.env['PYTHONIOENCODING']).toBe('utf-8');
    // ── [PCODE-8 | S02 | v0.1.0] the log shows the command and the output, secret masked ──
    expect(lines[0]).toBe('> plane list --sprint today');
    expect(lines[1]).toBe('ok ***');
  });

  it('turns a non-zero exit with an ERROR: line into a OrqivaError carrying that message', async () => {
    await expect(
      runEngine(spec, 'plane_task.py', ['done', 'FIX-99'], {
        cwd: 'C:\\p',
        spawn: fakeSpawn({ stdout: 'ERROR: no task FIX-99 in Plane\n', code: 2 }, []),
      }),
    ).rejects.toMatchObject({
      name: 'OrqivaError',
      message: 'no task FIX-99 in Plane',
      kind: 'engine',
    });
  });

  it('kills the child on cancellation', async () => {
    const calls: { command: string; args: string[]; opts: unknown }[] = [];
    const token = cancelToken();
    const p = runEngine(spec, 'plane_task.py', ['sync'], {
      cwd: 'C:\\p',
      cancel: token,
      spawn: fakeSpawn({ stdout: 'late\n', delayMs: 200 }, calls),
    });
    setTimeout(() => {
      token.cancel();
    }, 10);
    await expect(p).rejects.toBeInstanceOf(OrqivaError);
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('times out', async () => {
    await expect(
      runEngine(spec, 'plane_task.py', ['sync'], {
        cwd: 'C:\\p',
        timeoutMs: 20,
        spawn: fakeSpawn({ stdout: 'late\n', delayMs: 500 }, []),
      }),
    ).rejects.toMatchObject({
      kind: 'engine',
      message: expect.stringContaining('timed out') as string,
    });
  });

  it('formats the display command', () => {
    expect(displayCommand('plane_task.py', ['new', 'a title', '--desc', 'x'])).toBe(
      'plane new "a title" --desc x',
    );
    expect(displayCommand('plane_plan.py', ['check'])).toBe('plane plan check');
  });
});

// ── [PCODE-8 | S02 | v0.1.0] integration: the real Python runs the fake engine ──
describe('runEngine (fake engine, real python)', () => {
  const python = (() => {
    for (const c of [['py', '-3'], ['python3'], ['python']]) {
      const r = spawnSync(c[0] ?? '', [...c.slice(1), '--version'], { encoding: 'utf8' });
      if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return c;
    }
    return null;
  })();

  beforeAll(() => {
    if (fs.existsSync(CALLS)) fs.unlinkSync(CALLS);
  });
  afterEach(() => {
    if (fs.existsSync(CALLS)) fs.unlinkSync(CALLS);
  });

  it.skipIf(!python)('records argv, cwd and key presence in calls.jsonl', async () => {
    const cwd = path.resolve(__dirname, '..', 'fixtures', 'workspace');
    const r = await runEngine(
      { python: python ?? [], home: FAKE_HOME },
      'plane_task.py',
      ['done', 'FIX-2'],
      {
        cwd,
        env: { PLANE_API_KEY: 'plane_api_not_a_real_key_0' },
      },
    );
    expect(r.stdout).toContain('FIX-2 -> Review');
    const rec = JSON.parse(fs.readFileSync(CALLS, 'utf8').trim().split('\n').pop() ?? '{}') as {
      argv: string[];
      cwd: string;
      has_key: boolean;
    };
    expect(rec.argv).toEqual(['done', 'FIX-2']);
    expect(path.resolve(rec.cwd)).toBe(cwd);
    expect(rec.has_key).toBe(true);
    expect(fs.readFileSync(CALLS, 'utf8')).not.toContain('not_a_real_key');
  });

  it.skipIf(!python)('surfaces the engine ERROR line', async () => {
    await expect(
      runEngine({ python: python ?? [], home: FAKE_HOME }, 'plane_task.py', ['fail'], {
        cwd: FAKE_HOME,
      }),
    ).rejects.toMatchObject({ message: 'no task FIX-99 in Plane' });
  });
});

// ── [PCODE-61 | S12 | v0.1.0] Harden engine spawning for paths with spaces and non-Windows shells ──
//    Why:  the runner is the only thing that starts the engine, so the platform differences it must absorb
//          are asserted here: which Python is even tried, CRLF in the output, and multi-byte characters
//          that arrive split across two chunks.
describe('platform hardening', () => {
  // ── [PCODE-61 | S12 | v0.1.0] ::posix_python_candidates ──
  it('never offers the Windows launcher on a POSIX platform', () => {
    for (const platform of ['darwin', 'linux'] as NodeJS.Platform[]) {
      const candidates = pythonCandidates({}, platform);
      expect(candidates.some((c) => c[0] === 'py')).toBe(false);
      expect(candidates).toEqual([['python3'], ['python']]);
    }
    expect(pythonCandidates({}, 'win32')[0]).toEqual(['py', '-3']);
    // an explicit setting always wins, on every platform, and is passed as one argv element
    const set = pythonCandidates({ pythonPath: '/usr/local/bin/python 3.12' }, 'darwin');
    expect(set[0]).toEqual(['/usr/local/bin/python 3.12']);
  });

  // ── [PCODE-61 | S12 | v0.1.0] ::crlf_normalised ──
  it('hands callers \n-only output whatever the engine printed', async () => {
    const calls: { command: string; args: string[]; opts: unknown }[] = [];
    const lines: string[] = [];
    const r = await runEngine(
      { python: ['py', '-3'], home: FAKE_HOME },
      'plane_task.py',
      ['active'],
      {
        cwd: FAKE_HOME,
        spawn: fakeSpawn({ stdout: 'PCODE-61\r\nSprint 12\r\n', stderr: 'warn\r\n' }, calls),
        onLine: (l) => lines.push(l),
      },
    );
    expect(r.stdout).toBe('PCODE-61\nSprint 12\n');
    expect(r.stderr).toBe('warn\n');
    expect(r.stdout.includes('\r')).toBe(false);
    // the log never showed the carriage return either
    expect(lines).toContain('PCODE-61');
    expect(lines).toContain('! warn');
  });

  it('keeps an em dash that arrives split across two chunks', async () => {
    const calls: { command: string; args: string[]; opts: unknown }[] = [];
    const text = 'S12 — done ✓\n';
    const buf = Buffer.from(text, 'utf8');
    const split = ((command: string, args: string[], opts: unknown) => {
      calls.push({ command, args, opts });
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
        // the dash is three bytes; the break falls inside it
        child.stdout.emit('data', buf.subarray(0, 5));
        child.stdout.emit('data', buf.subarray(5));
        child.exitCode = 0;
        child.emit('close', 0);
      }, 1);
      return child;
    }) as unknown as typeof nodeSpawn;
    const r = await runEngine({ python: ['py', '-3'], home: FAKE_HOME }, 'plane_task.py', [], {
      cwd: FAKE_HOME,
      spawn: split,
    });
    expect(r.stdout).toBe(text);
    expect(r.stdout.includes('\uFFFD')).toBe(false);
  });

  it('normalizeEol leaves a lone \n and a lone \r alone', () => {
    expect(normalizeEol('a\nb')).toBe('a\nb');
    expect(normalizeEol('a\r\nb\r\n')).toBe('a\nb\n');
    // a bare \r is a progress redraw, not a line ending: it stays
    expect(normalizeEol('50%\r100%')).toBe('50%\r100%');
  });

  it('spawns with a home that has a space and an umlaut, unquoted, as one argv element', async () => {
    const calls: { command: string; args: string[]; opts: unknown }[] = [];
    const home = path.join('C:', 'Prüf Ordner', 'plane claude');
    await runEngine({ python: ['py', '-3'], home }, 'plane_task.py', ['show', 'PCODE-61'], {
      cwd: path.join('C:', 'Prüf Ordner', 'projekt'),
      spawn: fakeSpawn({ stdout: 'ok\n' }, calls),
    });
    expect(calls[0]?.args[1]).toBe(path.join(home, 'plane_task.py'));
    expect(calls[0]?.args[1]?.includes('"')).toBe(false);
    expect((calls[0]?.opts as { shell: boolean }).shell).toBe(false);
  });
});
