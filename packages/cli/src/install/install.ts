// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
// ── [PCODE-239 | S15 | v0.1.0] orq reaches a local server over IPv4 when localhost's IPv6 hangs ──
// ── [PCODE-215 | S15 | v0.1.0] T19.4 Air-gapped install (orq bundle, install --bundle), verified backups, licence and SBOM review ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
// ── [PCODE-91 | S15 | v0.1.0] Package the server as a Docker Compose install started by `orq install` ──
// ── [PCODE-130 | S15 | v0.1.0] Build the design-partner install kit: backup, restore, check, guide ──
//    Why:  one command from a machine with Docker to a running Orqiva: check Docker, write the install
//          folder (keeping the secrets of an earlier install, so running it again upgrades in place), build
//          or use the image, start, and wait until the health check answers. Every external step goes
//          through `exec`, so the whole flow is testable without Docker.
import { loadBundle } from './bundle.js'; // [PCODE-215 | S15 | v0.1.0]
import { viaIPv4 } from '../loop/api.js';
import { applyLegacyEnv } from '@orqiva/shared';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CADDYFILE,
  DEFAULT_IMAGE,
  INIT_DB,
  composeFor,
  envFile,
  newSecret,
  parseEnv,
  type InstallSettings,
} from './files.js';
import type { Exec, ExecResult } from '../loop/exec.js'; // [PCODE-436 | S15 | v0.1.0]

// [PCODE-436 | S15 | v0.1.0] defined beside the loop, which must not import the installer
export type { Exec, ExecResult } from '../loop/exec.js';

export interface InstallOptions {
  dir: string;
  port?: number;
  publicUrl?: string;
  image?: string;
  /** repository root to build the image from (no registry yet) */
  build?: string;
  /** [PCODE-191 | S15 | v0.1.0] an e-mail for Let's Encrypt: adds the TLS proxy */
  tlsEmail?: string;
  /** [PCODE-215 | S15 | v0.1.0] an offline bundle (orq bundle): checked, loaded, nothing pulled */
  bundle?: string;
  exec: Exec;
  log: (line: string) => void;
  /** how long to wait for the health check, in ms */
  waitMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class InstallError extends Error {}

async function need(exec: Exec, cwd: string, args: string[], what: string): Promise<void> {
  const r = await exec('docker', args, cwd).catch((): ExecResult => ({ code: 127, out: '' }));
  if (r.code !== 0) throw new InstallError(what);
}

/** Settings of this install: from the flags, else from an earlier install's .env, else defaults. */
/** [PCODE-192 | S15 | v0.1.0] The install folder: ~/orqiva, or ~/prodengine when that is where an earlier install lives. */
export function defaultInstallDir(home: string): string {
  const now = join(home, 'orqiva');
  const before = join(home, 'prodengine');
  return !existsSync(now) && existsSync(join(before, '.env')) ? before : now;
}

export function settingsFor(
  dir: string,
  opts: Pick<InstallOptions, 'port' | 'publicUrl' | 'image' | 'tlsEmail'>,
): InstallSettings {
  const envPath = join(dir, '.env');
  const old: Record<string, string | undefined> = existsSync(envPath)
    ? parseEnv(readFileSync(envPath, 'utf8'))
    : {};
  // [PCODE-192 | S15 | v0.1.0] an .env from before the rename: its PRODENGINE_* keys stand in for ORQIVA_*, and its
  // database, owner role and compose project keep their old name (the data lives there)
  const legacy = old['PRODENGINE_DB_PASSWORD'] !== undefined && old['ORQIVA_DB_NAME'] === undefined;
  applyLegacyEnv(old);
  const port = opts.port ?? (old['ORQIVA_PORT'] ? Number(old['ORQIVA_PORT']) : 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new InstallError('The port must be a number from 1 to 65535.');
  const tls = opts.tlsEmail ?? old['ORQIVA_TLS_EMAIL'];
  return {
    image: opts.image ?? old['ORQIVA_IMAGE'] ?? DEFAULT_IMAGE,
    port,
    publicUrl: (
      opts.publicUrl ??
      old['ORQIVA_PUBLIC_URL'] ??
      'http://' + hostname().toLowerCase() + ':' + String(port)
    ).replace(/\/$/, ''),
    // an existing database was created with these passwords: never replace them
    postgresPassword: old['POSTGRES_PASSWORD'] || newSecret(),
    dbPassword: old['ORQIVA_DB_PASSWORD'] || newSecret(),
    // [PCODE-120 | S15 | v0.1.0] sealed provider keys need the same key forever: kept once made
    secretKey: old['ORQIVA_SECRET_KEY'] || newSecret() + newSecret(),
    dbName: old['ORQIVA_DB_NAME'] || (legacy ? 'prodengine' : 'orqiva'),
    projectName: old['ORQIVA_PROJECT'] || (legacy ? 'prodengine' : 'orqiva'),
    // [PCODE-191 | S15 | v0.1.0] once asked for, the proxy stays on later installs
    ...(tls ? { tlsEmail: tls } : {}),
    // [PCODE-237 | S15 | v0.1.0] the mail server's settings stay as the admin wrote them
    mail: Object.fromEntries(
      Object.entries(old).filter(
        (e): e is [string, string] =>
          /^ORQIVA_(SMTP_[A-Z_]+|MAIL_FROM)$/.test(e[0]) && typeof e[1] === 'string',
      ),
    ),
  };
}

export function writeInstallFiles(dir: string, s: InstallSettings): void {
  mkdirSync(join(dir, 'initdb'), { recursive: true });
  writeFileSync(join(dir, 'compose.yaml'), composeFor(s)); // [PCODE-191 | S15 | v0.1.0]
  if (s.tlsEmail) writeFileSync(join(dir, 'Caddyfile'), CADDYFILE);
  writeFileSync(join(dir, 'initdb', '01-orqiva.sh'), INIT_DB, { mode: 0o755 });
  writeFileSync(join(dir, '.env'), envFile(s), { mode: 0o600 });
  // the modes above apply only to new files; an existing .env is tightened too (no effect on Windows)
  chmodSync(join(dir, '.env'), 0o600);
}

// [PCODE-130 | S15 | v0.1.0] restore waits for the server the same way
export async function waitForHealth(
  url: string,
  ms: number,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetchImpl(viaIPv4(url), { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(2000);
  }
  return false;
}

export async function install(opts: InstallOptions): Promise<{ url: string }> {
  const dir = resolve(opts.dir);
  const { exec, log } = opts;
  log('Checking Docker…');
  await need(
    exec,
    process.cwd(),
    ['version', '--format', '{{.Server.Version}}'],
    'Docker is not running or not installed. Install Docker Engine (or Docker Desktop), start it, and run orq install again.',
  );
  await need(
    exec,
    process.cwd(),
    ['compose', 'version'],
    'Docker Compose v2 is missing. Install the docker-compose-plugin package and run orq install again.',
  );

  // [PCODE-215 | S15 | v0.1.0] an air-gapped install takes its images from the bundle
  const fromBundle = opts.bundle ? await loadBundle({ file: opts.bundle, exec, log }) : undefined;
  const settings = settingsFor(dir, fromBundle ? { ...opts, image: fromBundle } : opts);
  const upgrade = existsSync(join(dir, '.env'));
  writeInstallFiles(dir, settings);
  log((upgrade ? 'Updated ' : 'Wrote ') + 'the install in ' + dir);

  if (opts.build) {
    log('Building the image ' + settings.image + ' from ' + resolve(opts.build) + '…');
    const b = await exec(
      'docker',
      ['build', '-t', settings.image, resolve(opts.build)],
      process.cwd(),
    );
    if (b.code !== 0)
      throw new InstallError('The image build failed:\n' + b.out.split('\n').slice(-15).join('\n'));
  }

  log('Starting PostgreSQL and the server…');
  const up = await exec(
    'docker',
    ['compose', 'up', '-d', '--remove-orphans', ...(fromBundle ? ['--pull', 'never'] : [])],
    dir,
  );
  if (up.code !== 0)
    throw new InstallError('Starting failed:\n' + up.out.split('\n').slice(-15).join('\n'));

  const local = 'http://127.0.0.1:' + String(settings.port);
  log('Waiting for Orqiva to answer (migrations run on first start)…');
  const healthy = await waitForHealth(
    local + '/health',
    opts.waitMs ?? 180_000,
    opts.fetchImpl ?? fetch,
    opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  );
  if (!healthy) {
    const logs = await exec('docker', ['compose', 'logs', '--tail', '30', 'server'], dir);
    throw new InstallError(
      'Orqiva did not answer on ' + local + '. Its last log lines:\n' + logs.out,
    );
  }
  // [PCODE-130 | S15 | v0.1.0] an upgrade keeps everyone's accounts: only a new install asks for the first one
  log(
    'Orqiva is running at ' +
      settings.publicUrl +
      (upgrade
        ? ' . Upgraded in place: your data and accounts are kept; sign in as before.'
        : ' . Open it and create the first account.'),
  );
  return { url: settings.publicUrl };
}
