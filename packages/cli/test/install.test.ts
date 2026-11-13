// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
// ── [PCODE-91 | S15 | v0.1.0] Package the server as a Docker Compose install started by `orq install` ──
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CADDYFILE,
  COMPOSE,
  INIT_DB,
  composeFor,
  envFile,
  parseEnv,
} from '../src/install/files.js';
import { defaultInstallDir, install, settingsFor, type Exec } from '../src/install/install.js';
import { dbNameOf } from '../src/install/maintain.js';
import { run } from '../src/run.js';

const okHealth: typeof fetch = () =>
  Promise.resolve(new Response('{"status":"ok"}', { status: 200 }));
const noSleep = (): Promise<void> => Promise.resolve();

function fakeDocker(fail: Partial<Record<string, string>> = {}): { exec: Exec; calls: string[] } {
  const calls: string[] = [];
  const exec: Exec = (cmd, args) => {
    const line = cmd + ' ' + args.join(' ');
    calls.push(line);
    const key = Object.keys(fail).find((k) => line.startsWith(k));
    return Promise.resolve(key ? { code: 1, out: fail[key] ?? '' } : { code: 0, out: '' });
  };
  return { exec, calls };
}

describe('install files', () => {
  it('keep secrets out of the compose file and connect the server as the owner role, not the superuser', () => {
    expect(COMPOSE).not.toMatch(/PASSWORD: [a-f0-9]{8}/);
    expect(COMPOSE).toContain(
      'postgres://${ORQIVA_DB_NAME:-orqiva}:${ORQIVA_DB_PASSWORD}@db:5432/${ORQIVA_DB_NAME:-orqiva}',
    );
    expect(COMPOSE).toContain('condition: service_healthy');
    expect(INIT_DB).toContain('NOSUPERUSER NOBYPASSRLS');
    expect(INIT_DB).not.toContain('\r');
  });
});

describe('orq install', () => {
  it('writes the install, starts it, waits for health and prints the address', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'pe-install-')), 'orqiva');
    const docker = fakeDocker();
    const log: string[] = [];
    const r = await install({
      dir,
      port: 18080,
      publicUrl: 'https://pe.example.test/',
      exec: docker.exec,
      log: (l) => log.push(l),
      fetchImpl: okHealth,
      sleep: noSleep,
    });
    expect(r.url).toBe('https://pe.example.test');
    expect(docker.calls).toEqual([
      'docker version --format {{.Server.Version}}',
      'docker compose version',
      'docker compose up -d --remove-orphans',
    ]);
    const env = parseEnv(readFileSync(join(dir, '.env'), 'utf8'));
    expect(env['ORQIVA_PORT']).toBe('18080');
    expect(env['ORQIVA_DB_PASSWORD']).toMatch(/^[0-9a-f]{32}$/);
    expect(env['POSTGRES_PASSWORD']).not.toBe(env['ORQIVA_DB_PASSWORD']);
    // [PCODE-120 | S15 | v0.1.0] the server's key for sealing provider keys: 32 bytes as hex
    expect(env['ORQIVA_SECRET_KEY']).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== 'win32') expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600);
    expect(log.at(-1)).toContain('Orqiva is running at https://pe.example.test');
  });

  it('keeps the passwords of an earlier install, so running it again upgrades in place', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'pe-install-')), 'orqiva');
    const opts = {
      dir,
      exec: fakeDocker().exec,
      log: () => undefined,
      fetchImpl: okHealth,
      sleep: noSleep,
    };
    await install(opts);
    const first = parseEnv(readFileSync(join(dir, '.env'), 'utf8'));
    await install({ ...opts, port: 9090 });
    const second = parseEnv(readFileSync(join(dir, '.env'), 'utf8'));
    expect(second['ORQIVA_DB_PASSWORD']).toBe(first['ORQIVA_DB_PASSWORD']);
    expect(second['POSTGRES_PASSWORD']).toBe(first['POSTGRES_PASSWORD']);
    expect(second['ORQIVA_SECRET_KEY']).toBe(first['ORQIVA_SECRET_KEY']);
    expect(second['ORQIVA_PORT']).toBe('9090');
  });

  it('builds the image first when asked', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'pe-install-')), 'orqiva');
    const docker = fakeDocker();
    await install({
      dir,
      build: '.',
      image: 'orqiva/server:dev',
      exec: docker.exec,
      log: () => undefined,
      fetchImpl: okHealth,
      sleep: noSleep,
    });
    expect(docker.calls.some((c) => c.startsWith('docker build -t orqiva/server:dev '))).toBe(true);
  });

  it('says what to do when Docker is missing, and exits 1', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'pe-install-')), 'orqiva');
    const r = await run(['install', '--dir', dir], {
      exec: fakeDocker({ 'docker version': '' }).exec,
      log: () => undefined,
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('Docker is not running or not installed');
  });

  it('shows the server log when the health check never answers', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'pe-install-')), 'orqiva');
    const down: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));
    await expect(
      install({
        dir,
        exec: fakeDocker().exec,
        log: () => undefined,
        fetchImpl: down,
        sleep: noSleep,
        waitMs: 1,
      }),
    ).rejects.toThrow(/did not answer/);
  });
});

// [PCODE-191 | S15 | v0.1.0]
describe('the TLS proxy', () => {
  it('adds Caddy with on-demand certificates only when asked, and keeps it on later installs', () => {
    expect(composeFor({})).toBe(COMPOSE);
    const tls = composeFor({ tlsEmail: 'ops@example.com' });
    expect(tls).toContain('image: caddy:2');
    expect(tls).toContain("- '443:443'");
    expect(tls).toContain('caddy-data:');
    expect(tls).toContain('db-data:');
    expect(CADDYFILE).toContain('ask http://server:8080/internal/tls/allow');
    expect(CADDYFILE).toContain('reverse_proxy server:8080');
    const dir = mkdtempSync(join(tmpdir(), 'pe-tls-'));
    expect(settingsFor(dir, {}).tlsEmail).toBeUndefined();
    expect(settingsFor(dir, { tlsEmail: 'ops@example.com' }).tlsEmail).toBe('ops@example.com');
  });
});

// [PCODE-237 | S15 | v0.1.0]
describe('the mail server settings', () => {
  it('passes them to the server and keeps them when orq install runs again', () => {
    expect(COMPOSE).toContain('ORQIVA_SMTP_HOST: ${ORQIVA_SMTP_HOST:-}');
    expect(COMPOSE).toContain('ORQIVA_MAIL_FROM: ${ORQIVA_MAIL_FROM:-}');
    const dir = mkdtempSync(join(tmpdir(), 'pe-mail-'));
    writeFileSync(
      join(dir, '.env'),
      [
        'ORQIVA_PORT=8080',
        'ORQIVA_SMTP_HOST=mail.example.com',
        'ORQIVA_SMTP_USER=orqiva',
        'ORQIVA_MAIL_FROM=Orqiva <orqiva@example.com>',
        'SOMETHING_ELSE=x',
      ].join(String.fromCharCode(10)),
    );
    const s = settingsFor(dir, {});
    expect(s.mail).toEqual({
      ORQIVA_SMTP_HOST: 'mail.example.com',
      ORQIVA_SMTP_USER: 'orqiva',
      ORQIVA_MAIL_FROM: 'Orqiva <orqiva@example.com>',
    });
    const env = parseEnv(envFile(s));
    expect(env['ORQIVA_SMTP_HOST']).toBe('mail.example.com');
    expect(env['SOMETHING_ELSE']).toBeUndefined();
  });
});

// [PCODE-192 | S15 | v0.1.0]
describe('an install from before the rename', () => {
  it('keeps its database, project, passwords and key, and its folder', () => {
    const home = mkdtempSync(join(tmpdir(), 'pe-home-'));
    const dir = join(home, 'prodengine');
    mkdirSync(dir);
    writeFileSync(
      join(dir, '.env'),
      [
        'PRODENGINE_IMAGE=prodengine/server:0.1.0',
        'PRODENGINE_PORT=8480',
        'PRODENGINE_PUBLIC_URL=http://localhost:8480',
        'POSTGRES_PASSWORD=' + 'a'.repeat(32),
        'PRODENGINE_DB_PASSWORD=' + 'b'.repeat(32),
        'PRODENGINE_SECRET_KEY=' + 'c'.repeat(64),
      ].join('\n'),
    );
    expect(defaultInstallDir(home)).toBe(dir);
    const s = settingsFor(dir, {});
    expect(s).toMatchObject({
      image: 'prodengine/server:0.1.0',
      port: 8480,
      dbName: 'prodengine',
      projectName: 'prodengine',
      dbPassword: 'b'.repeat(32),
      secretKey: 'c'.repeat(64),
    });
    expect(dbNameOf(dir)).toBe('prodengine');
    const fresh = mkdtempSync(join(tmpdir(), 'pe-new-'));
    expect(settingsFor(fresh, {})).toMatchObject({ dbName: 'orqiva', projectName: 'orqiva' });
    expect(defaultInstallDir(fresh)).toBe(join(fresh, 'orqiva'));
  });
});
