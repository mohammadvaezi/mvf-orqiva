// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-50 | S10 | v0.1.0] Add Docker CLI helpers: version, build, compose up/down/logs, inspect health ──
//    Why:  the argv of every helper, lines streamed as they arrive, a cancelled log stream killing its
//          process, the image tag, both shapes of `compose ps --format json`, and the http health states.
import { EventEmitter } from 'node:events';
import type { spawn as nodeSpawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  build,
  buildArgs,
  composeDown,
  composeLogs,
  composePs,
  composeUp,
  DOCKER_URL,
  describeHttpHealth,
  httpHealth,
  imageTag,
  inspectHealth,
  parseComposePs,
  runDocker,
  version,
} from '../../src/release/docker';
import { registerSecret, clearRegisteredSecrets } from '../../src/util/redact';

interface Answer {
  stdout?: string;
  stderr?: string;
  code?: number;
  /** emit these chunks one after the other before closing */
  chunks?: string[];
  /** never close on its own - the caller has to cancel */
  hang?: boolean;
}

function fakeDocker(
  answers: (args: string[]) => Answer,
  calls: string[][] = [],
  killed: { count: number } = { count: 0 },
): typeof nodeSpawn {
  return ((_cmd: string, args: string[]) => {
    calls.push(args);
    const a = answers(args);
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
      killed.count++;
      child.killed = true;
      return true;
    };
    setTimeout(() => {
      for (const chunk of a.chunks ?? []) child.stdout.emit('data', Buffer.from(chunk));
      if (a.stdout) child.stdout.emit('data', Buffer.from(a.stdout));
      if (a.stderr) child.stderr.emit('data', Buffer.from(a.stderr));
      if (a.hang) return;
      child.exitCode = a.code ?? 0;
      child.emit('close', a.code ?? 0);
    }, 2);
    return child;
  }) as unknown as typeof nodeSpawn;
}

const cwd = 'C:\\proj';

describe('docker helpers', () => {
  it('names the image after the project and its version', () => {
    expect(imageTag('Letterman', '0.1.0')).toBe('letterman:0.1.0');
    expect(imageTag('Orqiva Extension', '1.2.3')).toBe('orqiva-extension:1.2.3');
    expect(imageTag('  ', '')).toBe('app:latest');
    expect(imageTag('Ärger & Co.', '0.1.0')).toBe('rger-co:0.1.0');
  });

  it('builds the argv of each command', async () => {
    const calls: string[][] = [];
    const spawn = fakeDocker(() => ({ stdout: '' }), calls);
    expect(buildArgs({ tag: 'app:0.1.0' })).toEqual([
      'build',
      '-t',
      'app:0.1.0',
      '-f',
      'Dockerfile',
      '.',
    ]);
    await build({ tag: 'app:0.1.0', file: 'docker/Dockerfile', context: 'src' }, { cwd, spawn });
    await composeUp('docker-compose.yml', { cwd, spawn });
    await composeDown('docker-compose.yml', { cwd, spawn });
    await inspectHealth('proj-api-1', { cwd, spawn });
    expect(calls).toEqual([
      ['build', '-t', 'app:0.1.0', '-f', 'docker/Dockerfile', 'src'],
      ['compose', '-f', 'docker-compose.yml', 'up', '-d'],
      ['compose', '-f', 'docker-compose.yml', 'down'],
      ['inspect', '--format', '{{.State.Health.Status}}', 'proj-api-1'],
    ]);
  });

  // ── [PCODE-50 | S10 | v0.1.0] lines arrive as they are produced, redacted ──
  it('streams stdout and stderr line by line, masking secrets', async () => {
    clearRegisteredSecrets();
    registerSecret('plane_api_super_secret_value');
    const lines: string[] = [];
    const spawn = fakeDocker(() => ({
      chunks: ['#1 [internal] load bu', 'ild definition\n#2 transferring\n'],
      stderr: 'warn: key=plane_api_super_secret_value\n',
      code: 0,
    }));
    const r = await runDocker(['build', '.'], { cwd, spawn, onLine: (l) => lines.push(l) });
    expect(r.code).toBe(0);
    expect(lines).toEqual([
      '#1 [internal] load build definition',
      '#2 transferring',
      'warn: key=***',
    ]);
    clearRegisteredSecrets();
  });

  it('kills the log stream when the token cancels', async () => {
    const killed = { count: 0 };
    const spawn = fakeDocker(() => ({ hang: true, chunks: ['api-1  | started\n'] }), [], killed);
    let fire: (() => void) | null = null;
    const cancel = {
      isCancellationRequested: false,
      onCancellationRequested: (l: () => void) => {
        fire = l;
        return { dispose: () => undefined };
      },
    };
    const lines: string[] = [];
    const promise = composeLogs('docker-compose.yml', (l) => lines.push(l), { cwd, spawn, cancel });
    await new Promise((r) => setTimeout(r, 20));
    expect(lines).toEqual(['api-1  | started']);
    (fire as unknown as () => void)();
    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' });
    expect(killed.count).toBe(1);
  });

  // ── [PCODE-50 | S10 | v0.1.0] a missing or stopped Docker is a state, not an exception ──
  it('reports version, a stopped engine and a missing binary', async () => {
    const ok = await version({
      cwd,
      spawn: fakeDocker((args) =>
        args[0] === 'version' ? { stdout: '29.1.2\n' } : { stdout: 'v2.40.3\n' },
      ),
    });
    expect(ok).toMatchObject({ ok: true, docker: '29.1.2', compose: 'v2.40.3', fix: null });
    expect(ok.detail).toBe('Docker 29.1.2 · Compose v2.40.3');

    const stopped = await version({
      cwd,
      spawn: fakeDocker(() => ({
        code: 1,
        stderr:
          'error during connect: open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file\n',
      })),
    });
    expect(stopped).toMatchObject({ ok: false, fix: DOCKER_URL });
    expect(stopped.detail).toBe('Docker is installed but not running — start Docker Desktop.');

    const throwing: typeof nodeSpawn = () => {
      throw new Error('spawn docker ENOENT');
    };
    const absent = await version({ cwd, spawn: throwing });
    expect(absent).toMatchObject({ ok: false, docker: null, fix: DOCKER_URL });
    expect(absent.detail).toMatch(/install Docker Desktop/);
  });

  it('reads compose ps in both shapes', async () => {
    const line =
      '{"Name":"proj-api-1","Service":"api","State":"running","Health":"healthy"}\n{"Name":"proj-web-1","Service":"web","State":"running","Health":""}';
    expect(parseComposePs(line)).toEqual([
      { name: 'proj-api-1', service: 'api', state: 'running', health: 'healthy' },
      { name: 'proj-web-1', service: 'web', state: 'running', health: null },
    ]);
    const array = '[{"Name":"proj-api-1","Service":"api","State":"exited","Health":""}]';
    expect(parseComposePs(array)).toEqual([
      { name: 'proj-api-1', service: 'api', state: 'exited', health: null },
    ]);
    expect(parseComposePs('')).toEqual([]);
    expect(parseComposePs('no containers')).toEqual([]);
    const services = await composePs('docker-compose.yml', {
      cwd,
      spawn: fakeDocker(() => ({ stdout: array })),
    });
    expect(services[0]?.service).toBe('api');
    // a failing ps means "nothing is running", not an error
    expect(
      await composePs('docker-compose.yml', {
        cwd,
        spawn: fakeDocker(() => ({ code: 1, stderr: 'no such file' })),
      }),
    ).toEqual([]);
  });

  it('answers the health of a container, with or without a healthcheck', async () => {
    const healthy = await inspectHealth('c', {
      cwd,
      spawn: fakeDocker(() => ({ stdout: 'healthy\n' })),
    });
    expect(healthy).toBe('healthy');
    const none = await inspectHealth('c', {
      cwd,
      spawn: fakeDocker(() => ({ stdout: '<no value>\n' })),
    });
    expect(none).toBe('none');
    const gone = await inspectHealth('c', {
      cwd,
      spawn: fakeDocker(() => ({ code: 1, stderr: 'No such object' })),
    });
    expect(gone).toBe('unknown');
  });

  // ── [PCODE-50 | S10 | v0.1.0] httpHealth: ok, refused, timed out ──
  it('checks an http endpoint', async () => {
    const ok = await httpHealth('http://localhost:8000/health', 1000, () =>
      Promise.resolve({ status: 200 }),
    );
    expect(ok).toMatchObject({ ok: true, status: 200, error: null });
    expect(describeHttpHealth('http://localhost:8000/health', ok)).toMatch(
      /^http:\/\/localhost:8000\/health: 200 in \d+ ms$/,
    );
    const bad = await httpHealth('http://x/health', 1000, () => Promise.resolve({ status: 503 }));
    expect(bad).toMatchObject({ ok: false, status: 503 });
    const refused = await httpHealth('http://x/health', 1000, () =>
      Promise.reject(new Error('ECONNREFUSED')),
    );
    expect(refused).toMatchObject({ ok: false, status: null, error: 'ECONNREFUSED' });
    expect(describeHttpHealth('http://x/health', refused)).toBe('http://x/health: ECONNREFUSED');
    const timedOut = await httpHealth(
      'http://x/health',
      20,
      (_u, init) =>
        new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => {
            rej(new Error('aborted'));
          });
        }),
    );
    expect(timedOut).toMatchObject({ ok: false, status: null });
    expect(timedOut.error).toBe('no answer within 0 s');
  });
});

// ── [PCODE-50 | S10 | v0.1.0] the real docker on this machine, when it is there ──
describe('docker version (real CLI)', () => {
  it('reports Docker or says it is missing, but never throws', async () => {
    const v = await version({ cwd: process.cwd(), timeoutMs: 30_000 });
    if (v.ok) {
      expect(v.docker).toMatch(/^\d+\./);
      expect(v.detail).toMatch(/^Docker \d/);
    } else {
      expect(v.fix).toBe(DOCKER_URL);
      expect(v.detail.length).toBeGreaterThan(10);
    }
  }, 60_000);
});
