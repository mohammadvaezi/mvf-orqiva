// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-55 | S11 | v0.1.0] Add deploy target storage in .plane/deploy.json with tokens in SecretStorage ──
//    Why:  never_writes_token - whatever the form hands in, deploy.json must not hold a credential; the
//          validation speaks per field; and a file a human edited keeps its unknown keys.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEPLOY_FILE,
  SCHEMA_NOTE,
  describeTarget,
  deployPath,
  getToken,
  hasToken,
  readDeployFile,
  readTargets,
  removeTarget,
  saveTarget,
  stripToken,
  tokenKey,
  validateTarget,
  writeDeployFile,
  type DeployTarget,
  type SecretBag,
} from '../../src/deploy/targets';
import { clearRegisteredSecrets, redact } from '../../src/util/redact';

// [PCODE-66 | S13 | v0.1.0] orqiva:allow-secret - invented, and asserted never to be written to disk
const TOKEN = 'coolify_token_that_must_never_be_written';

function bag(): SecretBag & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
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

const coolify = (over: Partial<DeployTarget> = {}): DeployTarget => ({
  name: 'prod',
  kind: 'coolify',
  url: 'https://coolify.example.test',
  appUuid: 'abc-123',
  ...over,
});

const ssh = (over: Partial<DeployTarget> = {}): DeployTarget => ({
  name: 'staging',
  kind: 'ssh',
  host: 'staging.example.test',
  user: 'deploy',
  path: '/srv/app',
  ...over,
});

describe('deploy targets', () => {
  let root = '';
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-targets-'));
    clearRegisteredSecrets();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    clearRegisteredSecrets();
  });

  it('strips every credential-shaped key', () => {
    const { target, token } = stripToken({ ...coolify(), token: TOKEN, password: 'other' });
    expect(token).toBe(TOKEN);
    expect(Object.keys(target)).toEqual(['name', 'kind', 'url', 'appUuid']);
    expect(stripToken(coolify()).token).toBeNull();
  });

  // ── [PCODE-55 | S11 | v0.1.0] never_writes_token ──
  it('writes the target to the file and the token to SecretStorage only', async () => {
    const secrets = bag();
    const r = await saveTarget(root, { ...coolify(), token: TOKEN }, secrets);
    expect(r.tokenStored).toBe(true);
    const raw = fs.readFileSync(deployPath(root), 'utf8');
    expect(raw).not.toContain(TOKEN);
    expect(raw).toContain(SCHEMA_NOTE);
    expect(JSON.parse(raw)).toMatchObject({
      targets: [{ name: 'prod', kind: 'coolify', url: 'https://coolify.example.test' }],
    });
    const saved = JSON.parse(raw) as { targets: Record<string, unknown>[] };
    expect(Object.keys(saved.targets[0] ?? {})).not.toContain('token');
    expect(secrets.map.get(tokenKey('prod'))).toBe(TOKEN);
    expect(await hasToken('prod', secrets)).toBe(true);
    // loading merges them back, and the value is masked wherever it is logged
    expect(await getToken('prod', secrets)).toBe(TOKEN);
    expect(redact(`Authorization: Bearer ${TOKEN}`)).toBe('Authorization: Bearer ***');
    expect(readTargets(root)).toHaveLength(1);
    expect(deployPath(root).endsWith(path.join(...DEPLOY_FILE))).toBe(true);
  });

  it('validates per field and refuses a duplicate name', () => {
    expect(validateTarget(coolify())).toEqual([]);
    expect(validateTarget(ssh())).toEqual([]);
    expect(validateTarget(coolify({ name: '' }))[0]).toMatchObject({ field: 'name' });
    expect(validateTarget(coolify({ name: 'pro/d' }))[0]).toMatchObject({ field: 'name' });
    expect(validateTarget(coolify({ url: 'http://coolify.example.test' }))[0]).toMatchObject({
      field: 'url',
      message: 'Use an https address — the token travels with it.',
    });
    expect(validateTarget(coolify({ appUuid: '' }))[0]).toMatchObject({ field: 'appUuid' });
    expect(validateTarget(ssh({ host: '' }))[0]).toMatchObject({ field: 'host' });
    expect(validateTarget(ssh({ path: '' }))[0]).toMatchObject({ field: 'path' });
    expect(validateTarget(coolify({ healthUrl: 'localhost/health' }))[0]).toMatchObject({
      field: 'healthUrl',
    });
    expect(validateTarget(coolify(), [coolify()])[0]).toMatchObject({
      field: 'name',
      message: 'A target named prod already exists.',
    });
  });

  it('refuses to save an invalid target and writes nothing', async () => {
    const secrets = bag();
    await expect(saveTarget(root, coolify({ url: 'ftp://x' }), secrets)).rejects.toThrow(/url:/);
    expect(fs.existsSync(deployPath(root))).toBe(false);
    expect(secrets.map.size).toBe(0);
  });

  // ── [PCODE-55 | S11 | v0.1.0] a hand-edited file keeps its own keys ──
  it('keeps unknown keys of the file and of a target', async () => {
    fs.mkdirSync(path.join(root, '.plane'), { recursive: true });
    fs.writeFileSync(
      deployPath(root),
      JSON.stringify(
        {
          healthUrl: 'https://prod.example.test/health',
          note: 'edited by hand',
          targets: [
            {
              name: 'prod',
              kind: 'coolify',
              url: 'https://old.example.test',
              appUuid: 'u',
              team: 7,
            },
          ],
        },
        null,
        2,
      ),
    );
    const secrets = bag();
    await saveTarget(root, coolify({ url: 'https://new.example.test' }), secrets);
    const file = readDeployFile(root);
    expect(file['note']).toBe('edited by hand');
    expect(file.healthUrl).toBe('https://prod.example.test/health');
    expect(file.targets[0]).toMatchObject({ url: 'https://new.example.test', team: 7 });
    expect(file.targets).toHaveLength(1); // edited, not duplicated
  });

  it('adds a second target and removes one with its token', async () => {
    const secrets = bag();
    await saveTarget(root, { ...coolify(), token: TOKEN }, secrets);
    await saveTarget(root, ssh(), secrets);
    expect(readTargets(root).map((t) => t.name)).toEqual(['prod', 'staging']);
    expect(describeTarget(readTargets(root)[0] ?? coolify())).toBe(
      'prod · Coolify · https://coolify.example.test',
    );
    expect(describeTarget(ssh())).toBe('staging · SSH · deploy@staging.example.test:/srv/app');
    expect(await removeTarget(root, 'prod', secrets)).toBe(true);
    expect(readTargets(root).map((t) => t.name)).toEqual(['staging']);
    expect(secrets.map.has(tokenKey('prod'))).toBe(false);
    expect(await removeTarget(root, 'nothing', secrets)).toBe(false);
  });

  it('treats a broken file as an empty one', () => {
    fs.mkdirSync(path.join(root, '.plane'), { recursive: true });
    fs.writeFileSync(deployPath(root), '{ not json');
    expect(readTargets(root)).toEqual([]);
    fs.writeFileSync(deployPath(root), '{"targets": "nonsense"}');
    expect(readTargets(root)).toEqual([]);
    writeDeployFile(root, { targets: [ssh()] });
    expect(readTargets(root)).toHaveLength(1);
  });
});
