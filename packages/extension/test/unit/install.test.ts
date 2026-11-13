// ── [PCODE-28 | S05 | v0.1.0] Install hooks, plane command and MCP server through install.py with progress ──
//    Why:  the key appears in argv exactly once, every logged line has it masked, a failing install surfaces the
//          engine's ERROR line, and no key means no spawn.
import { EventEmitter } from 'node:events';
import type { spawn as nodeSpawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { runEngine } from '../../src/engine/run';
import { installHooks } from '../../src/setup/install';
import { clearRegisteredSecrets } from '../../src/util/redact';

const KEY = 'plane_api_install_key_0123456789';
const spec = { python: ['py', '-3'], home: 'C:\\Tools\\engine' };

function fakeSpawn(
  stdout: string,
  code: number,
  calls: { command: string; args: string[]; cwd: string }[],
): typeof nodeSpawn {
  return ((command: string, args: string[], opts: { cwd: string }) => {
    calls.push({ command, args, cwd: opts.cwd });
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
      child.stdout.emit('data', Buffer.from(stdout));
      child.exitCode = code;
      child.emit('close', code);
    }, 5);
    return child;
  }) as unknown as typeof nodeSpawn;
}

describe('installHooks', () => {
  it('passes the key once in argv, masks it in the log, runs in the engine folder', async () => {
    clearRegisteredSecrets();
    const calls: { command: string; args: string[]; cwd: string }[] = [];
    const lines: string[] = [];
    const r = await installHooks({
      spec,
      apiKey: KEY,
      baseUrl: 'https://plan.broszio.com',
      workspace: 'prodsystem',
      onLine: (l) => lines.push(l),
      run: (s, script, args, opts) =>
        runEngine(s, script, args, {
          ...opts,
          spawn: fakeSpawn(
            `Credentials stored: x\nHooks written\nDone. Restart Claude Code. key=${KEY}\n`,
            0,
            calls,
          ),
        }),
    });
    expect(r.summary).toBe('Done. Restart Claude Code. key=***');
    expect(calls[0]?.cwd).toBe('C:\\Tools\\engine');
    expect(calls[0]?.args).toEqual([
      '-3',
      'C:\\Tools\\engine\\install.py',
      '--key',
      KEY,
      '--url',
      'https://plan.broszio.com',
      '--workspace',
      'prodsystem',
    ]);
    expect(calls[0]?.args.filter((a) => a === KEY)).toHaveLength(1);
    expect(lines[0]).toBe(
      '> install.py --key *** --url https://plan.broszio.com --workspace prodsystem',
    );
    expect(lines.join('\n')).not.toContain(KEY);
  });

  it('surfaces the engine error line and refuses without a key or engine', async () => {
    await expect(
      installHooks({
        spec,
        apiKey: KEY,
        baseUrl: 'https://p',
        workspace: 'ws',
        onLine: () => undefined,
        run: (s, script, args, opts) =>
          runEngine(s, script, args, {
            ...opts,
            spawn: fakeSpawn('ERROR: No credentials stored.\n', 1, []),
          }),
      }),
    ).rejects.toMatchObject({ message: 'No credentials stored.' });
    let spawned = 0;
    await expect(
      installHooks({
        spec,
        apiKey: undefined,
        baseUrl: 'https://p',
        workspace: 'ws',
        onLine: () => undefined,
        run: () => {
          spawned++;
          return Promise.resolve({ code: 0, stdout: '', stderr: '' });
        },
      }),
    ).rejects.toThrow(/Connect the legacy tracker first/);
    await expect(
      installHooks({
        spec: { python: ['py'], home: '' },
        apiKey: KEY,
        baseUrl: 'https://p',
        workspace: 'ws',
        onLine: () => undefined,
        run: () => {
          spawned++;
          return Promise.resolve({ code: 0, stdout: '', stderr: '' });
        },
      }),
    ).rejects.toThrow(/Engine folder/);
    expect(spawned).toBe(0);
  });
});
