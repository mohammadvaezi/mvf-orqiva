// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-51 | S10 | v0.1.0] Build the Docker panel with generate, build, run, stop, logs and health ──
//    Why:  the button matrix in every state that matters, the sentences about the files, the state read from
//          a project folder, and the protocol the panel speaks.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import type { spawn as nodeSpawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buttonsFor,
  describeService,
  filesNote,
  findComposeFile,
  findDockerfile,
  readDockerState,
} from '../../src/release/dockerState';
import { toMessage } from '../../src/webviews/docker/panel';
import { isWebviewMessage } from '../../src/webviews/protocol';

function fakeDocker(
  answers: (args: string[]) => { stdout?: string; code?: number },
): typeof nodeSpawn {
  return ((_cmd: string, args: string[]) => {
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
    child.kill = () => true;
    setTimeout(() => {
      if (a.stdout) child.stdout.emit('data', Buffer.from(a.stdout));
      child.exitCode = a.code ?? 0;
      child.emit('close', a.code ?? 0);
    }, 2);
    return child;
  }) as unknown as typeof nodeSpawn;
}

const dockerOk = (ps: string) =>
  fakeDocker((args) => {
    if (args[0] === 'version') return { stdout: '29.1.2\n' };
    if (args[0] === 'compose' && args[1] === 'version') return { stdout: 'v2.40.3\n' };
    if (args.includes('ps')) return { stdout: ps };
    return { stdout: '' };
  });

const dockerMissing = fakeDocker(() => ({ code: 1, stdout: '' }));

describe('docker panel state', () => {
  // ── [PCODE-51 | S10 | v0.1.0] the enablement matrix ──
  it('offers only what the machine and the project allow', () => {
    const base = {
      dockerOk: true,
      hasDockerfile: true,
      composeFile: 'docker-compose.yml',
      running: true,
      busy: false,
    };
    expect(buttonsFor(base)).toEqual({
      generate: false, // both files exist
      build: true,
      run: true,
      stop: true,
      logs: true,
      health: true,
    });
    expect(buttonsFor({ ...base, dockerOk: false })).toEqual({
      generate: false,
      build: false,
      run: false,
      stop: false,
      logs: false,
      health: false,
    });
    expect(buttonsFor({ ...base, hasDockerfile: false })).toMatchObject({
      generate: true,
      build: false,
      run: true,
    });
    expect(buttonsFor({ ...base, composeFile: null })).toMatchObject({
      generate: true,
      build: true,
      run: false,
      stop: false,
      logs: false,
    });
    expect(buttonsFor({ ...base, running: false })).toMatchObject({
      build: true,
      run: true,
      stop: false,
      logs: false,
      health: false,
    });
    // while something runs, nothing else may start - not even generating
    expect(buttonsFor({ ...base, busy: true })).toEqual({
      generate: false,
      build: false,
      run: false,
      stop: false,
      logs: false,
      health: false,
    });
  });

  it('says which files are there, by their path', () => {
    expect(filesNote('Dockerfile', 'docker-compose.yml')).toBe('Dockerfile · docker-compose.yml');
    expect(filesNote('infra/Dockerfile', 'infra/docker-compose.yml')).toBe(
      'infra/Dockerfile · infra/docker-compose.yml',
    );
    expect(filesNote(null, null)).toBe('No Dockerfile and no compose file yet.');
    expect(filesNote('Dockerfile', null)).toBe('Dockerfile, but no compose file yet.');
    expect(filesNote(null, 'compose.yaml')).toBe('compose.yaml, but no Dockerfile yet.');
  });

  it('describes a service the way the panel lists it', () => {
    expect(
      describeService({ name: 'p-api-1', service: 'api', state: 'running', health: 'healthy' }),
    ).toBe('api: running · healthy');
    expect(
      describeService({ name: 'p-web-1', service: 'web', state: 'exited', health: null }),
    ).toBe('web: exited');
    expect(describeService({ name: 'lone', service: '', state: 'running', health: 'none' })).toBe(
      'lone: running',
    );
  });
});

describe('readDockerState', () => {
  let root = '';
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-dockerstate-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds the compose file docker itself would use, including a monorepo folder', () => {
    expect(findComposeFile(root)).toBeNull();
    // letterman keeps it in infra/ - the root is searched first, then the usual folders
    fs.mkdirSync(path.join(root, 'infra'));
    fs.writeFileSync(path.join(root, 'infra', 'docker-compose.yml'), 'services: {}\n');
    expect(findComposeFile(root)).toBe('infra/docker-compose.yml');
    expect(findDockerfile(root)).toBeNull();
    fs.writeFileSync(path.join(root, 'infra', 'Dockerfile'), 'FROM scratch\n');
    expect(findDockerfile(root)).toBe('infra/Dockerfile');
    fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'services: {}\n');
    expect(findComposeFile(root)).toBe('docker-compose.yml'); // the root wins over infra/
    fs.writeFileSync(path.join(root, 'compose.yaml'), 'services: {}\n');
    expect(findComposeFile(root)).toBe('compose.yaml'); // compose.yaml wins, as in docker's own order
    fs.writeFileSync(path.join(root, 'Dockerfile'), 'FROM scratch\n');
    expect(findDockerfile(root)).toBe('Dockerfile');
  });

  it('reads an empty project, then one with files and a running stack', async () => {
    const empty = await readDockerState({
      root,
      projectName: 'Letterman',
      version: '0.1.0',
      docker: { spawn: dockerOk('[]') },
    });
    expect(empty).toMatchObject({ hasDockerfile: false, composeFile: null, running: false });
    expect(empty.image).toBe('letterman:0.1.0');
    expect(empty.buttons).toMatchObject({ generate: true, build: false, run: false });
    expect(empty.version.ok).toBe(true);

    fs.writeFileSync(path.join(root, 'Dockerfile'), 'FROM scratch\n');
    fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'services: {}\n');
    const running = await readDockerState({
      root,
      projectName: 'Letterman',
      version: '0.1.0',
      docker: {
        spawn: dockerOk(
          '{"Name":"ltr-api-1","Service":"api","State":"running","Health":"healthy"}',
        ),
      },
    });
    expect(running).toMatchObject({
      hasDockerfile: true,
      composeFile: 'docker-compose.yml',
      running: true,
    });
    expect(running.buttons).toMatchObject({
      generate: false,
      build: true,
      run: true,
      stop: true,
      logs: true,
    });
    const msg = toMessage(running);
    expect(msg.services).toEqual(['api: running · healthy']);
    expect(msg.docker).toBe('Docker 29.1.2 · Compose v2.40.3');
    expect(msg.image).toBe('letterman:0.1.0');
  });

  // ── [PCODE-51 | S10 | v0.1.0] no Docker: the panel still renders, with the download link ──
  it('without Docker only the download link is left', async () => {
    fs.writeFileSync(path.join(root, 'Dockerfile'), 'FROM scratch\n');
    const state = await readDockerState({
      root,
      projectName: 'x',
      version: '1.0.0',
      docker: { spawn: dockerMissing },
    });
    expect(state.version.ok).toBe(false);
    expect(state.buttons).toMatchObject({ build: false, run: false, stop: false, logs: false });
    const msg = toMessage(state);
    expect(msg.fix).toMatch(/docker\.com/);
    expect(msg.docker).toMatch(/Docker not found|not running/);
  });
});

describe('docker panel protocol', () => {
  it('accepts every action and refuses nonsense', () => {
    for (const t of [
      'refresh',
      'generate',
      'build',
      'run',
      'stop',
      'health',
      'openOutput',
      'openFix',
    ])
      expect(isWebviewMessage({ type: `docker/${t}` })).toBe(true);
    expect(isWebviewMessage({ type: 'docker/logs', on: true })).toBe(true);
    expect(isWebviewMessage({ type: 'docker/logs' })).toBe(false);
    expect(isWebviewMessage({ type: 'docker/logs', on: 'yes' })).toBe(false);
    expect(isWebviewMessage({ type: 'docker/rm -rf' })).toBe(false);
  });
});
