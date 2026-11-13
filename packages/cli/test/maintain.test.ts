// ── [PCODE-215 | S15 | v0.1.0] T19.4 Air-gapped install (orq bundle, install --bundle), verified backups, licence and SBOM review ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
// ── [PCODE-130 | S15 | v0.1.0] Build the design-partner install kit: backup, restore, check, guide ──
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { install, type Exec } from '../src/install/install.js';
import {
  backup,
  backupName,
  check,
  checkReport,
  restore,
  sha256File,
  verifyBackup,
} from '../src/install/maintain.js';
import { bundle, loadBundle } from '../src/install/bundle.js';
import { run } from '../src/run.js';

function fakeDocker(fail: Partial<Record<string, string>> = {}): { exec: Exec; calls: string[] } {
  const calls: string[] = [];
  const exec: Exec = (cmd, args) => {
    const line = cmd + ' ' + args.join(' ');
    calls.push(line);
    const key = Object.keys(fail).find((k) => line.startsWith(k));
    if (key) return Promise.resolve({ code: 1, out: fail[key] ?? '' });
    if (line === 'docker version --format {{.Server.Version}}')
      return Promise.resolve({ code: 0, out: '27.3.1\n' });
    if (line === 'docker compose version --short')
      return Promise.resolve({ code: 0, out: '2.29.7\n' });
    // [PCODE-215 | S15 | v0.1.0] a dump that lists its tables, copies that arrive, saves that write the tar
    if (line.startsWith('docker compose exec -T db pg_restore --list'))
      return Promise.resolve({
        code: 0,
        out: ';\n; Archive created\n3001; 0 16400 TABLE DATA public items postgres\n3002; 0 16410 TABLE DATA public users postgres\n',
      });
    if (line.startsWith('docker compose cp db:')) writeFileSync(args.at(-1) ?? '', 'PGDMP dump');
    if (line.startsWith('docker save -o ')) writeFileSync(args[2] ?? '', 'TAR images');
    return Promise.resolve({ code: 0, out: '' });
  };
  return { exec, calls };
}

/** An install folder as orq install leaves it. */
function anInstall(secret = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'pe-kit-'));
  writeFileSync(join(dir, 'compose.yaml'), 'name: orqiva\n');
  writeFileSync(
    join(dir, '.env'),
    'ORQIVA_PORT=18480\n' + (secret ? 'ORQIVA_SECRET_KEY=' + 'ab'.repeat(32) + '\n' : ''),
  );
  return dir;
}

describe('orq backup', () => {
  it('dumps inside the database container and copies a dated file out', async () => {
    const dir = anInstall();
    const docker = fakeDocker();
    const r = await backup({
      dir,
      exec: docker.exec,
      log: () => undefined,
      now: new Date(2026, 9, 4, 9, 5),
    });
    expect(backupName(new Date(2026, 9, 4, 9, 5))).toBe('orqiva-20261004-0905.dump');
    expect(r.file).toBe(join(dir, 'backups', 'orqiva-20261004-0905.dump'));
    expect(docker.calls).toEqual([
      'docker compose exec -T db pg_dump -U postgres -Fc -f /tmp/orqiva.dump orqiva',
      // [PCODE-215 | S15 | v0.1.0] read back before it counts
      'docker compose exec -T db pg_restore --list /tmp/orqiva.dump',
      'docker compose cp db:/tmp/orqiva.dump ' + r.file,
      'docker compose exec -T db rm -f /tmp/orqiva.dump',
      // [PCODE-168 | S15 | v0.1.0] the uploaded files beside the dump
      'docker compose cp server:/data/blobs ' + join(dir, 'backups', 'orqiva-20261004-0905-files'),
    ]);
  });

  it('says so when there is no install or the server is down', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'pe-kit-'));
    await expect(
      backup({ dir: empty, exec: fakeDocker().exec, log: () => undefined }),
    ).rejects.toThrow('There is no Orqiva install');
    const down = fakeDocker({ 'docker compose exec -T db pg_dump': 'service "db" is not running' });
    await expect(
      backup({ dir: anInstall(), exec: down.exec, log: () => undefined }),
    ).rejects.toThrow('is Orqiva running?');
  });
});

describe('orq restore', () => {
  it('asks for --yes, then stops the server, restores in one transaction and starts it again', async () => {
    const dir = anInstall();
    const file = join(dir, 'old.dump');
    writeFileSync(file, 'PGDMP');
    const docker = fakeDocker();
    const base = {
      dir,
      file,
      exec: docker.exec,
      log: () => undefined,
      waitForHealth: () => Promise.resolve(true),
    };
    await expect(restore({ ...base, confirmed: false })).rejects.toThrow(
      'Make a backup first (orq backup)',
    );
    expect(docker.calls).toEqual([]);
    await restore({ ...base, confirmed: true });
    expect(docker.calls).toEqual([
      'docker compose stop server',
      'docker compose cp ' + file + ' db:/tmp/orqiva.dump',
      'docker compose exec -T db pg_restore -U postgres --clean --if-exists --single-transaction -d orqiva /tmp/orqiva.dump',
      'docker compose exec -T db rm -f /tmp/orqiva.dump',
      'docker compose start server',
    ]);
  });

  // [PCODE-168 | S15 | v0.1.0]
  it('puts the uploaded files of the backup back and gives them to the server', async () => {
    const dir = anInstall();
    const file = join(dir, 'old.dump');
    writeFileSync(file, 'PGDMP');
    mkdirSync(join(dir, 'old-files'));
    const docker = fakeDocker();
    await restore({
      dir,
      file,
      exec: docker.exec,
      log: () => undefined,
      waitForHealth: () => Promise.resolve(true),
      confirmed: true,
    });
    expect(docker.calls.slice(-3)).toEqual([
      'docker compose cp ' + join(dir, 'old-files') + '/. server:/data/blobs',
      'docker compose start server',
      'docker compose exec -T -u root server chown -R node:node /data',
    ]);
  });

  it('starts the server again even when the restore fails', async () => {
    const dir = anInstall();
    const file = join(dir, 'bad.dump');
    writeFileSync(file, 'x');
    const docker = fakeDocker({
      'docker compose exec -T db pg_restore': 'pg_restore: error: input file is too short',
    });
    await expect(
      restore({
        dir,
        file,
        exec: docker.exec,
        log: () => undefined,
        confirmed: true,
        waitForHealth: () => Promise.resolve(true),
      }),
    ).rejects.toThrow('the data from before is unchanged');
    expect(docker.calls.at(-1)).toBe('docker compose start server');
  });
});

describe('orq install --check', () => {
  it('reports Docker, Compose, the folder, the secret key, the disk and the server, changing nothing', async () => {
    const dir = anInstall(false);
    const docker = fakeDocker();
    const lines = await check({
      dir,
      exec: docker.exec,
      fetchImpl: () =>
        Promise.resolve(new Response('{"status":"ok","version":"0.1.0"}', { status: 200 })),
      freeBytes: () => 1.5 * 1024 ** 3,
    });
    expect(checkReport(lines)).toBe(
      [
        'ok    Docker: running, version 27.3.1',
        'ok    Docker Compose: version 2.29.7',
        'ok    Install folder: ' + dir + ' (an install is there; orq install upgrades it)',
        'FIX   Secret key: missing: run orq install once more to add it',
        'FIX   Disk: 1.5 GB free (2 GB or more is needed)',
        'ok    Server: Orqiva 0.1.0 answers on port 18480',
      ].join('\n'),
    );
    expect(
      docker.calls.every(
        (c) => c.startsWith('docker version') || c.startsWith('docker compose version'),
      ),
    ).toBe(true);
  });
});

describe('an upgrade', () => {
  it('does not ask for a first account again', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'pe-kit-')), 'orqiva');
    const log: string[] = [];
    const opts = {
      dir,
      exec: fakeDocker().exec,
      log: (l: string) => log.push(l),
      fetchImpl: () => Promise.resolve(new Response('{}', { status: 200 })),
      sleep: () => Promise.resolve(),
    };
    await install(opts);
    expect(log.at(-1)).toContain('create the first account');
    await install(opts);
    expect(log.at(-1)).toContain('Upgraded in place: your data and accounts are kept');
  });
});

// ── [PCODE-215 | S15 | v0.1.0] checked backups, offline bundles, --help ──
describe('checked backups', () => {
  it('writes a checksum, and refuses a backup that does not read back', async () => {
    const dir = anInstall();
    const r = await backup({ dir, exec: fakeDocker().exec, log: () => undefined });
    expect(readFileSync(r.file + '.sha256', 'utf8')).toBe(
      sha256File(r.file) + '  ' + basename(r.file) + '\n',
    );
    const broken = fakeDocker({
      'docker compose exec -T db pg_restore --list': 'pg_restore: error: input file is too short',
    });
    await expect(backup({ dir, exec: broken.exec, log: () => undefined })).rejects.toThrow(
      'does not read back',
    );
  });

  it('verifies an older backup and refuses to restore a changed one', async () => {
    const dir = anInstall();
    const r = await backup({ dir, exec: fakeDocker().exec, log: () => undefined });
    expect(
      await verifyBackup({ dir, file: r.file, exec: fakeDocker().exec, log: () => undefined }),
    ).toEqual({ tables: 2, checksum: 'ok' });
    writeFileSync(r.file, 'PGDMP changed');
    await expect(
      verifyBackup({ dir, file: r.file, exec: fakeDocker().exec, log: () => undefined }),
    ).rejects.toThrow('does not match its checksum');
    const docker = fakeDocker();
    await expect(
      restore({
        dir,
        file: r.file,
        exec: docker.exec,
        log: () => undefined,
        confirmed: true,
        waitForHealth: () => Promise.resolve(true),
      }),
    ).rejects.toThrow('Nothing was restored');
    expect(docker.calls).toEqual([]);
  });
});

describe('offline bundles', () => {
  it('saves the images with a manifest, and an install loads them without pulling', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'pe-bundle-')), 'orqiva.tar');
    const docker = fakeDocker();
    const m = await bundle({
      image: 'prodengine/server:0.1.0',
      out,
      version: '0.1.0',
      exec: docker.exec,
      log: () => undefined,
    });
    expect(docker.calls).toEqual([
      'docker pull postgres:17',
      'docker pull caddy:2',
      'docker save -o ' + out + ' prodengine/server:0.1.0 postgres:17 caddy:2',
    ]);
    expect(m).toMatchObject({
      orqiva: '0.1.0',
      images: ['prodengine/server:0.1.0', 'postgres:17', 'caddy:2'],
      file: 'orqiva.tar',
    });
    expect(JSON.parse(readFileSync(out + '.json', 'utf8'))).toMatchObject({ sha256: m.sha256 });
    const dir = mkdtempSync(join(tmpdir(), 'pe-airgap-'));
    const site = fakeDocker();
    await expect(
      install({
        dir,
        bundle: out,
        exec: site.exec,
        log: () => undefined,
        waitMs: 1,
        fetchImpl: () => Promise.resolve(new Response('ok')),
        sleep: () => Promise.resolve(),
      }),
    ).resolves.toBeDefined();
    expect(site.calls).toContain('docker load -i ' + out);
    expect(site.calls).toContain('docker compose up -d --remove-orphans --pull never');
    expect(site.calls.some((c) => c.startsWith('docker pull'))).toBe(false);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain(
      'ORQIVA_IMAGE=prodengine/server:0.1.0',
    );
  });

  // [PCODE-222 | S15 | v0.1.0] the closed site gets the command line too
  it('puts orq.mjs beside the bundle and names it in the manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pe-bundle-'));
    const cli = join(mkdtempSync(join(tmpdir(), 'pe-cli-')), 'orq.mjs');
    writeFileSync(cli, '// orq\n');
    const m = await bundle({
      image: 'prodengine/server:0.1.0',
      out: join(dir, 'orqiva.tar'),
      version: '0.1.0',
      cli,
      exec: fakeDocker().exec,
      log: () => undefined,
    });
    expect(readFileSync(join(dir, 'orq.mjs'), 'utf8')).toBe('// orq\n');
    expect(m.cli).toEqual({ file: 'orq.mjs', sha256: sha256File(join(dir, 'orq.mjs')) });
    expect(JSON.parse(readFileSync(join(dir, 'orqiva.tar.json'), 'utf8'))).toMatchObject({
      cli: { file: 'orq.mjs' },
    });
  });

  it('refuses a bundle that changed on the way, or comes without its manifest', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'pe-bundle-')), 'orqiva.tar');
    await bundle({
      image: 'prodengine/server:0.1.0',
      out,
      version: '0.1.0',
      exec: fakeDocker().exec,
      log: () => undefined,
    });
    writeFileSync(out, 'TAR images, one byte flipped');
    await expect(
      loadBundle({ file: out, exec: fakeDocker().exec, log: () => undefined }),
    ).rejects.toThrow('changed or damaged on the way');
    const bare = join(mkdtempSync(join(tmpdir(), 'pe-bundle-')), 'x.tar');
    writeFileSync(bare, 'TAR');
    await expect(
      loadBundle({ file: bare, exec: fakeDocker().exec, log: () => undefined }),
    ).rejects.toThrow('manifest');
  });
});

describe('--help', () => {
  it('prints the usage of the install commands instead of running them', async () => {
    for (const cmd of ['install', 'backup', 'restore', 'bundle']) {
      const docker = fakeDocker();
      const r = await run([cmd, '--help'], { exec: docker.exec, log: () => undefined });
      expect(r.code).toBe(0);
      expect(r.out).toContain('orq ' + cmd);
      expect(docker.calls).toEqual([]);
    }
  });
});
