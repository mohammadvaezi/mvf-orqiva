// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-58 | S11 | v0.1.0] Build the Deploy panel with targets, deploy button, progress and history ──
//    Why:  target_explicit - the adapter is only ever given the target that was named; the summary line and
//          the version warnings; the form's validation per kind; and a Coolify target without a token.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import type { spawn as nodeSpawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  confirmMessage,
  deployedLine,
  formatDuration,
  runDeploy,
  versionWarnings,
} from '../../src/deploy/deployService';
import {
  saveTarget,
  validateTarget,
  type DeployTarget,
  type SecretBag,
} from '../../src/deploy/targets';
import { buildMessage } from '../../src/webviews/deploy/panel';
import type { Services } from '../../src/services';
import { Store } from '../../src/state/store';
import { Logger } from '../../src/util/log';
import { isWebviewMessage } from '../../src/webviews/protocol';

const COOLIFY: DeployTarget = {
  name: 'prod',
  kind: 'coolify',
  url: 'https://coolify.example.test',
  appUuid: 'app-1',
};
const SSH: DeployTarget = {
  name: 'staging',
  kind: 'ssh',
  host: 'staging.example.test',
  user: 'deploy',
  path: '/srv/app',
};

function bag(entries: Record<string, string> = {}): SecretBag {
  const map = new Map(Object.entries(entries));
  return {
    get: (k) => Promise.resolve(map.get(k)),
    store: (k, v) => {
      map.set(k, v);
      return Promise.resolve();
    },
    delete: (k) => {
      map.delete(k);
      return Promise.resolve();
    },
  };
}

describe('deploy service', () => {
  it('reads a duration and the summary line', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(43_000)).toBe('43s');
    expect(formatDuration(103_000)).toBe('1m 43s');
    expect(deployedLine('0.1.1', 'prod', 103_000)).toBe('Deployed v0.1.1 to prod in 1m 43s');
    expect(confirmMessage('0.2.0', COOLIFY)).toBe(
      'Deploy v0.2.0 to prod (Coolify)? This triggers a deployment on the server.',
    );
    expect(confirmMessage('0.2.0', SSH)).toMatch(/to staging \(SSH\)\?/);
  });

  it('warns about an untagged version and a dirty worktree', () => {
    expect(
      versionWarnings({ version: '0.1.1', dirty: false, changed: [], lastTag: 'v0.1.1' }),
    ).toEqual([]);
    const warnings = versionWarnings({
      version: '0.1.1',
      dirty: true,
      changed: ['a.ts', 'b.ts'],
      lastTag: 'v0.1.0',
    });
    expect(warnings[0]).toBe(
      '2 uncommitted change(s) — what you deploy is not what the repo holds.',
    );
    expect(warnings[1]).toBe(
      'v0.1.1 is not tagged yet (the last tag is v0.1.0) — bump the version first.',
    );
    expect(versionWarnings({ version: '0.1.0', dirty: false, changed: [], lastTag: null })[0]).toBe(
      'v0.1.0 is not tagged yet — bump the version first.',
    );
  });

  // ── [PCODE-58 | S11 | v0.1.0] target_explicit: the adapter sees the named target and no other ──
  it('deploys the named target with the adapter of its kind', async () => {
    const seen: string[] = [];
    const ssh = await runDeploy({
      target: SSH,
      version: '0.1.1',
      secrets: bag(),
      spawn: ((_cmd: string, args: string[]) => {
        seen.push(args.at(-1) ?? '');
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
          child.stdout.emit('data', Buffer.from('NAME  STATUS\napi   running\n'));
          child.exitCode = 0;
          child.emit('close', 0);
        }, 1);
        return child;
      }) as unknown as typeof nodeSpawn,
    });
    expect(ssh).toMatchObject({ target: 'staging', kind: 'ssh', version: '0.1.1' });
    expect(seen[0]).toContain('test -f');
    expect(seen[1]).toContain('docker compose pull');
    expect(seen.join(' ')).not.toContain('prod'); // the other target was never touched
  });

  it('refuses a Coolify deploy without a token, before any request', async () => {
    let requests = 0;
    await expect(
      runDeploy({
        target: COOLIFY,
        version: '0.1.1',
        secrets: bag(),
        http: () => {
          requests++;
          return Promise.resolve({ status: 200, text: '{}' });
        },
      }),
    ).rejects.toThrow(/No token stored for prod/);
    expect(requests).toBe(0);
  });

  it('validates the form per kind', () => {
    expect(validateTarget({ name: 'x', kind: 'coolify' }).map((p) => p.field)).toEqual([
      'url',
      'appUuid',
    ]);
    expect(validateTarget({ name: 'x', kind: 'ssh' }).map((p) => p.field)).toEqual([
      'host',
      'path',
    ]);
    expect(isWebviewMessage({ type: 'deploy/deploy', name: 'prod' })).toBe(true);
    expect(isWebviewMessage({ type: 'deploy/deploy', name: '' })).toBe(false);
    expect(isWebviewMessage({ type: 'deploy/save', target: { kind: 'ssh' } })).toBe(true);
    expect(isWebviewMessage({ type: 'deploy/save', target: {} })).toBe(false);
  });
});

describe('deploy panel message', () => {
  let root = '';
  const services = (): Services => {
    const store = new Store();
    store.state.root = root;
    store.state.link = {
      project_id: 'p1',
      identifier: 'FIX',
      name: 'Fixture',
      workspace: 'ws',
      version: '0.1.0',
    };
    return { store, log: new Logger(), root: () => root } as unknown as Services;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-deploypanel-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists the targets with their token state and never the token', async () => {
    const secrets = bag();
    await saveTarget(root, { ...COOLIFY, token: 'coolify_secret_value' }, secrets);
    await saveTarget(root, SSH, secrets);
    const message = await buildMessage(services(), secrets, ['Deployed v0.1.0 to prod'], null);
    expect(message.targets.map((t) => t.summary)).toEqual([
      'prod · Coolify · https://coolify.example.test',
      'staging · SSH · deploy@staging.example.test:/srv/app',
    ]);
    expect(message.targets[0]?.tokenStored).toBe(true);
    expect(JSON.stringify(message)).not.toContain('coolify_secret_value');
    expect(message.canDeploy).toBe(true);
    expect(message.history).toEqual(['Deployed v0.1.0 to prod']);
    // a Coolify target whose token is gone is listed, but not deployable
    const without = await buildMessage(services(), bag(), [], null);
    expect(without.targets[0]?.tokenStored).toBe(false);
    // while something runs nothing else may start
    const busy = await buildMessage(services(), secrets, [], 'deploy to prod');
    expect(busy.canDeploy).toBe(false);
  });

  it('says so when the folder is not linked and when there is no target', async () => {
    const empty = await buildMessage(services(), bag(), [], null);
    expect(empty.targets).toEqual([]);
    expect(empty.canDeploy).toBe(false);
    const svc = services();
    svc.store.state.link = null;
    const unlinked = await buildMessage(svc, bag(), [], null);
    expect(unlinked.warnings).toEqual(['Link this folder to an Orqiva project first.']);
  });
});
