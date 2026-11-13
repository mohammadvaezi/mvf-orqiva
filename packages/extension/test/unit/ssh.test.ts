// ── [PCODE-57 | S11 | v0.1.0] Implement the SSH adapter running docker compose pull and up on the host ──
//    Why:  the argv (BatchMode, connect timeout, destination), a remote path with a space, the sentences a
//          refused key or a missing compose file turn into, and the streamed output.
import { EventEmitter } from 'node:events';
import type { spawn as nodeSpawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  CONNECT_TIMEOUT_SECONDS,
  checkCommand,
  deployCommand,
  deployOverSsh,
  destination,
  explainSsh,
  quote,
  runSsh,
  sshArgs,
} from '../../src/deploy/ssh';
import type { DeployTarget } from '../../src/deploy/targets';

const TARGET: DeployTarget = {
  name: 'staging',
  kind: 'ssh',
  host: 'staging.example.test',
  user: 'deploy',
  path: '/srv/app/',
};

interface Answer {
  stdout?: string;
  stderr?: string;
  code?: number;
}

function fakeSsh(answers: (remote: string) => Answer, calls: string[][] = []): typeof nodeSpawn {
  return ((_cmd: string, args: string[]) => {
    calls.push(args);
    const a = answers(args.at(-1) ?? '');
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

describe('ssh adapter', () => {
  it('builds the destination and quotes a path with spaces', () => {
    expect(destination(TARGET)).toBe('deploy@staging.example.test');
    expect(destination({ ...TARGET, user: '' })).toBe('staging.example.test');
    expect(quote('/srv/app')).toBe("'/srv/app'");
    expect(quote('/srv/my app')).toBe("'/srv/my app'");
    expect(quote("/srv/o'brien")).toBe("'/srv/o'\\''brien'");
    expect(deployCommand({ ...TARGET, path: '/srv/my app/' })).toBe(
      "cd '/srv/my app' && docker compose pull && docker compose up -d && docker compose ps",
    );
    expect(checkCommand({ ...TARGET, path: '/srv/my app' })).toBe(
      "test -f '/srv/my app/docker-compose.yml'",
    );
  });

  // ── [PCODE-57 | S11 | v0.1.0] the argv: never a password prompt ──
  it('never lets ssh ask for a password', () => {
    expect(sshArgs(TARGET, 'echo hi')).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      `ConnectTimeout=${String(CONNECT_TIMEOUT_SECONDS)}`,
      'deploy@staging.example.test',
      'echo hi',
    ]);
  });

  it('turns what ssh printed into what to do', () => {
    expect(explainSsh(TARGET, 255, 'deploy@host: Permission denied (publickey).')).toBe(
      'Permission denied by staging.example.test — add your key to the agent or to ~/.ssh/config for staging.example.test.',
    );
    expect(explainSsh(TARGET, 255, 'Host key verification failed.')).toMatch(/not known yet/);
    expect(explainSsh(TARGET, 255, 'ssh: Could not resolve hostname staging')).toMatch(
      /cannot be resolved/,
    );
    expect(explainSsh(TARGET, 255, 'connect to host port 22: Connection refused')).toMatch(
      /refused the connection/,
    );
    expect(explainSsh(TARGET, 255, 'Connection timed out')).toMatch(/did not answer within 10 s/);
    expect(explainSsh(TARGET, 1, 'docker: command not found')).toBe(
      'ssh exited with 1 — docker: command not found.',
    );
  });

  it('streams the remote output', async () => {
    const lines: string[] = [];
    const r = await runSsh(TARGET, 'echo hi', {
      spawn: fakeSsh(() => ({ stdout: 'pulling\napi Pulled\n', stderr: 'warning: noise\n' })),
      onLine: (l) => lines.push(l),
    });
    expect(r.code).toBe(0);
    expect(lines).toEqual(['pulling', 'api Pulled', 'warning: noise']);
  });

  // ── [PCODE-57 | S11 | v0.1.0] the flow: check the folder, then pull/up/ps ──
  it('checks the compose file first, then pulls and starts', async () => {
    const calls: string[][] = [];
    const lines: string[] = [];
    const r = await deployOverSsh(TARGET, {
      spawn: fakeSsh(
        (remote) =>
          remote.startsWith('test -f')
            ? {}
            : { stdout: 'api Pulled\napi Started\nNAME      STATUS\napi       running\n' },
        calls,
      ),
      onLine: (l) => lines.push(l),
      now: (() => {
        let t = 1000;
        return () => (t += 1000);
      })(),
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.at(-1)).toBe("test -f '/srv/app/docker-compose.yml'");
    expect(calls[1]?.at(-1)).toBe(
      "cd '/srv/app' && docker compose pull && docker compose up -d && docker compose ps",
    );
    expect(r.ps).toContain('api       running');
    expect(r.ms).toBeGreaterThan(0);
    expect(lines[0]).toBe(
      "> ssh deploy@staging.example.test test -f '/srv/app/docker-compose.yml'",
    );
  });

  it('names a missing compose file and a refused key, without running the deploy', async () => {
    const calls: string[][] = [];
    await expect(
      deployOverSsh(TARGET, { spawn: fakeSsh(() => ({ code: 1 }), calls) }),
    ).rejects.toThrow(
      '/srv/app/docker-compose.yml does not exist on staging.example.test — check the folder of this target.',
    );
    expect(calls).toHaveLength(1); // the deploy command was never sent

    await expect(
      deployOverSsh(TARGET, {
        spawn: fakeSsh(() => ({ code: 255, stderr: 'Permission denied (publickey).' })),
      }),
    ).rejects.toThrow(/add your key to the agent/);

    await expect(
      deployOverSsh(TARGET, {
        spawn: fakeSsh((remote) =>
          remote.startsWith('test -f') ? {} : { code: 1, stderr: 'docker: not found' },
        ),
      }),
    ).rejects.toThrow('ssh exited with 1 — docker: not found.');
  });

  it('reports a missing ssh binary as a config error', async () => {
    const throwing: typeof nodeSpawn = () => {
      throw new Error('spawn ssh ENOENT');
    };
    await expect(runSsh(TARGET, 'echo', { spawn: throwing })).rejects.toMatchObject({
      kind: 'config',
    });
  });
});
