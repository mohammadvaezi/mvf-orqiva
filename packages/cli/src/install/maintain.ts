// ── [PCODE-215 | S15 | v0.1.0] T19.4 Air-gapped install (orq bundle, install --bundle), verified backups, licence and SBOM review ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
// ── [PCODE-130 | S15 | v0.1.0] Build the design-partner install kit: backup, restore, check, guide ──
//    Why:  what a team needs to run Orqiva on its own machine without us: a check that says what is
//          wrong before anything changes, a backup into a dated file, and a restore that puts one back.
//          Backups are pg_dump's custom format, made inside the database container and copied out, so no
//          PostgreSQL tools are needed on the host. Every step goes through `exec`, testable without Docker.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { InstallError, type Exec, type ExecResult } from './install.js';
import { parseEnv } from './files.js';

const IN_CONTAINER = '/tmp/orqiva.dump';

async function docker(exec: Exec, cwd: string, args: string[], what: string): Promise<ExecResult> {
  const r = await exec('docker', args, cwd).catch((): ExecResult => ({ code: 127, out: '' }));
  if (r.code !== 0)
    throw new InstallError(what + (r.out ? ':\n' + r.out.split('\n').slice(-10).join('\n') : ''));
  return r;
}

/** [PCODE-192 | S15 | v0.1.0] The install's database: orqiva, or prodengine for an install made before the rename. */
export function dbNameOf(dir: string): string {
  const envPath = join(dir, '.env');
  const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
  return (
    env['ORQIVA_DB_NAME'] || (env['PRODENGINE_DB_PASSWORD'] !== undefined ? 'prodengine' : 'orqiva')
  );
}

function installed(dir: string): void {
  if (!existsSync(join(dir, '.env')) || !existsSync(join(dir, 'compose.yaml')))
    throw new InstallError(
      'There is no Orqiva install in ' + dir + '. Install it with orq install.',
    );
}

/** orqiva-20261004-0915.dump */
export function backupName(at: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    'orqiva-' +
    String(at.getFullYear()) +
    p(at.getMonth() + 1) +
    p(at.getDate()) +
    '-' +
    p(at.getHours()) +
    p(at.getMinutes()) +
    '.dump'
  );
}

/** orqiva-20261004-0915.dump → orqiva-20261004-0915-files */
export const filesDirOf = (dump: string): string => dump.replace(/\.dump$/, '') + '-files';

export async function backup(opts: {
  dir: string;
  exec: Exec;
  log: (line: string) => void;
  out?: string;
  now?: Date;
}): Promise<{ file: string }> {
  const dir = resolve(opts.dir);
  installed(dir);
  const file = resolve(opts.out ?? join(dir, 'backups', backupName(opts.now ?? new Date())));
  mkdirSync(resolve(file, '..'), { recursive: true });
  opts.log('Dumping the database…');
  await docker(
    opts.exec,
    dir,
    [
      'compose',
      'exec',
      '-T',
      'db',
      'pg_dump',
      '-U',
      'postgres',
      '-Fc',
      '-f',
      IN_CONTAINER,
      dbNameOf(dir),
    ],
    'The database dump failed (is Orqiva running? orq install starts it)',
  );
  // [PCODE-215 | S15 | v0.1.0] a backup counts once it reads back: pg_restore lists what it holds
  const tables = await listedTables(opts.exec, dir);
  await docker(
    opts.exec,
    dir,
    ['compose', 'cp', 'db:' + IN_CONTAINER, file],
    'Copying the dump out failed',
  );
  await opts
    .exec('docker', ['compose', 'exec', '-T', 'db', 'rm', '-f', IN_CONTAINER], dir)
    .catch(() => undefined);
  if (!existsSync(file)) throw new InstallError('The dump did not arrive at ' + file);
  writeFileSync(file + '.sha256', sha256File(file) + '  ' + basename(file) + '\n');
  opts.log(
    'Checked: the dump reads back with ' +
      String(tables) +
      ' tables; checksum in ' +
      basename(file) +
      '.sha256',
  );
  // [PCODE-168 | S15 | v0.1.0] uploaded files: their blobs go next to the dump (names are content hashes)
  const files = filesDirOf(file);
  const copied = await opts
    .exec('docker', ['compose', 'cp', 'server:/data/blobs', files], dir)
    .then(
      () => true,
      () => false,
    );
  opts.log(copied ? 'Uploaded files copied to ' + files : 'No uploaded files to copy yet');
  opts.log('Backup written to ' + file);
  return { file };
}

// ── [PCODE-215 | S15 | v0.1.0] checksums and reading a dump back ──
export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** How many tables the dump in the database container holds; refuses one that does not read back. */
async function listedTables(exec: Exec, dir: string): Promise<number> {
  const r = await exec(
    'docker',
    ['compose', 'exec', '-T', 'db', 'pg_restore', '--list', IN_CONTAINER],
    dir,
  ).catch((): ExecResult => ({ code: 127, out: '' }));
  if (r.code !== 0)
    throw new InstallError(
      'The dump does not read back (pg_restore --list failed): ' + r.out.slice(-300),
    );
  const tables = r.out.split('\n').filter((l) => / TABLE DATA /.test(l)).length;
  if (!tables) throw new InstallError('The dump holds no table data; it is not a usable backup');
  return tables;
}

/** Checks an older backup: its checksum, and that PostgreSQL reads it back. */
export async function verifyBackup(opts: {
  dir: string;
  file: string;
  exec: Exec;
  log: (line: string) => void;
}): Promise<{ tables: number; checksum: 'ok' | 'missing' }> {
  const dir = resolve(opts.dir);
  installed(dir);
  const file = resolve(opts.file);
  if (!existsSync(file)) throw new InstallError('There is no backup file ' + file);
  let checksum: 'ok' | 'missing' = 'missing';
  if (existsSync(file + '.sha256')) {
    const want =
      readFileSync(file + '.sha256', 'utf8')
        .trim()
        .split(/\s+/)[0] ?? '';
    if (sha256File(file) !== want)
      throw new InstallError(
        basename(file) + ' does not match its checksum: it was changed or damaged',
      );
    checksum = 'ok';
  }
  await docker(
    opts.exec,
    dir,
    ['compose', 'cp', file, 'db:' + IN_CONTAINER],
    'Copying the backup in failed',
  );
  try {
    const tables = await listedTables(opts.exec, dir);
    opts.log(
      basename(file) +
        ': ' +
        String(tables) +
        ' tables, checksum ' +
        (checksum === 'ok' ? 'matches' : 'file missing'),
    );
    return { tables, checksum };
  } finally {
    await opts
      .exec('docker', ['compose', 'exec', '-T', 'db', 'rm', '-f', IN_CONTAINER], dir)
      .catch(() => undefined);
  }
}

export async function restore(opts: {
  dir: string;
  file: string;
  exec: Exec;
  log: (line: string) => void;
  /** restore replaces all data; the command asks for --yes */
  confirmed: boolean;
  waitForHealth: () => Promise<boolean>;
}): Promise<void> {
  const dir = resolve(opts.dir);
  installed(dir);
  const file = resolve(opts.file);
  if (!existsSync(file)) throw new InstallError('There is no backup file ' + file);
  if (!opts.confirmed)
    throw new InstallError(
      'Restoring replaces everything in this install with ' +
        basename(file) +
        '. Make a backup first (orq backup), then run the restore again with --yes.',
    );
  // [PCODE-215 | S15 | v0.1.0] a dump that changed since its backup is not restored
  if (existsSync(file + '.sha256')) {
    const want =
      readFileSync(file + '.sha256', 'utf8')
        .trim()
        .split(/\s+/)[0] ?? '';
    if (sha256File(file) !== want)
      throw new InstallError(
        basename(file) +
          ' does not match its checksum: it was changed or damaged after the backup. Nothing was restored.',
      );
  } else opts.log('No checksum file next to ' + basename(file) + ': restoring it unchecked');
  opts.log('Stopping the server…');
  await docker(opts.exec, dir, ['compose', 'stop', 'server'], 'Stopping the server failed');
  try {
    await docker(
      opts.exec,
      dir,
      ['compose', 'cp', file, 'db:' + IN_CONTAINER],
      'Copying the backup in failed',
    );
    opts.log('Restoring ' + basename(file) + '…');
    await docker(
      opts.exec,
      dir,
      [
        'compose',
        'exec',
        '-T',
        'db',
        'pg_restore',
        '-U',
        'postgres',
        '--clean',
        '--if-exists',
        '--single-transaction',
        '-d',
        dbNameOf(dir),
        IN_CONTAINER,
      ],
      'The restore failed; the data from before is unchanged',
    );
  } finally {
    await opts
      .exec('docker', ['compose', 'exec', '-T', 'db', 'rm', '-f', IN_CONTAINER], dir)
      .catch(() => undefined);
    // [PCODE-168 | S15 | v0.1.0] the uploaded files of the backup go back before the server starts
    const files = filesDirOf(file);
    if (existsSync(files))
      await docker(
        opts.exec,
        dir,
        ['compose', 'cp', files + '/.', 'server:/data/blobs'],
        'Copying the uploaded files back failed',
      ).catch((e: unknown) => {
        opts.log(e instanceof Error ? e.message : 'Copying the uploaded files back failed');
      });
    opts.log('Starting the server…');
    await docker(opts.exec, dir, ['compose', 'start', 'server'], 'Starting the server failed');
    if (existsSync(files))
      await opts
        .exec(
          'docker',
          ['compose', 'exec', '-T', '-u', 'root', 'server', 'chown', '-R', 'node:node', '/data'],
          dir,
        )
        .catch(() => undefined);
  }
  if (!(await opts.waitForHealth()))
    throw new InstallError(
      'The data is restored, but the server does not answer; see docker compose logs server',
    );
  opts.log('Restored. Orqiva is running with the data of ' + basename(file) + '.');
}

export interface CheckLine {
  ok: boolean;
  what: string;
  detail: string;
}

/** What would stand in the way of installing or running here; changes nothing. */
export async function check(opts: {
  dir: string;
  port?: number;
  exec: Exec;
  fetchImpl?: typeof fetch;
  /** bytes free where the install lives; injectable for tests */
  freeBytes?: (dir: string) => number;
}): Promise<CheckLine[]> {
  const dir = resolve(opts.dir);
  const lines: CheckLine[] = [];
  const run = (args: string[]): Promise<ExecResult> =>
    opts.exec('docker', args, process.cwd()).catch((): ExecResult => ({ code: 127, out: '' }));
  const v = await run(['version', '--format', '{{.Server.Version}}']);
  lines.push({
    ok: v.code === 0,
    what: 'Docker',
    detail: v.code === 0 ? 'running, version ' + v.out.trim() : 'not running or not installed',
  });
  const c = await run(['compose', 'version', '--short']);
  lines.push({
    ok: c.code === 0,
    what: 'Docker Compose',
    detail:
      c.code === 0 ? 'version ' + c.out.trim() : 'missing (install the docker-compose-plugin)',
  });
  const env = existsSync(join(dir, '.env'))
    ? parseEnv(readFileSync(join(dir, '.env'), 'utf8'))
    : null;
  lines.push({
    ok: true,
    what: 'Install folder',
    detail: env ? dir + ' (an install is there; orq install upgrades it)' : dir + ' (new install)',
  });
  if (env)
    lines.push({
      ok: Boolean(env['ORQIVA_SECRET_KEY']),
      what: 'Secret key',
      detail: env['ORQIVA_SECRET_KEY']
        ? 'set (AI provider keys can be stored)'
        : 'missing: run orq install once more to add it',
    });
  const free = (opts.freeBytes ?? freeBytesAt)(existsSync(dir) ? dir : resolve(dir, '..'));
  const gb = free / 1024 ** 3;
  lines.push({
    ok: gb >= 2,
    what: 'Disk',
    detail: gb.toFixed(1) + ' GB free' + (gb >= 2 ? '' : ' (2 GB or more is needed)'),
  });
  const port = opts.port ?? (env?.['ORQIVA_PORT'] ? Number(env['ORQIVA_PORT']) : 8080);
  const health = await (opts.fetchImpl ?? fetch)('http://127.0.0.1:' + String(port) + '/health', {
    signal: AbortSignal.timeout(3000),
  })
    .then(async (r) => (r.ok ? ((await r.json()) as { version?: string }) : null))
    .catch(() => null);
  lines.push(
    health
      ? {
          ok: true,
          what: 'Server',
          detail: 'Orqiva ' + (health.version ?? '') + ' answers on port ' + String(port),
        }
      : {
          ok: true,
          what: 'Server',
          detail:
            'nothing answers on port ' +
            String(port) +
            (env ? ' (start it with orq install)' : ' (free to use)'),
        },
  );
  return lines;
}

function freeBytesAt(dir: string): number {
  const s = statfsSync(dir);
  return s.bavail * s.bsize;
}

export const checkReport = (lines: CheckLine[]): string =>
  lines.map((l) => (l.ok ? 'ok    ' : 'FIX   ') + l.what + ': ' + l.detail).join('\n');
