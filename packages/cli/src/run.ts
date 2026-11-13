// ── [PCODE-296 | S15 | v0.1.0] T30.9 Accessibility checks: alt text, names, focus order, target size, in the code and on the page ──
// ── [PCODE-295 | S15 | v0.1.0] T30.8b Visual regression: baselines, pixel diff, orq visual check, the Visual tab ──
// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
// ── [PCODE-215 | S15 | v0.1.0] T19.4 Air-gapped install (orq bundle, install --bundle), verified backups, licence and SBOM review ──
// ── [PCODE-211 | S15 | v0.1.0] T18.3 Scale test (20 projects, 50 live users, under 1 s event-to-screen) and orq portfolio ──
// ── [PCODE-207 | S15 | v0.1.0] T17.5 Releases from the terminal and VS Code: orq release, orq env, orq train ──
// ── [PCODE-201 | S15 | v0.1.0] T16.5 Docs and handover from the terminal and VS Code: orq docs scan/build/drift, orq handover ──
// ── [PCODE-195 | S15 | v0.1.0] B8.3 CLI parity: inbox, approvals, comments, time, agents and ideas from the terminal, offline queue ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
// ── [PCODE-85 | S08 | v0.1.0] Build our own licence checker and SBOM generator that fail CI on a denied licence ──
// ── [PCODE-91 | S15 | v0.1.0] Package the server as a Docker Compose install started by `orq install` ──
// ── [PCODE-103 | S15 | v0.1.0] Build the CLI `orq` and the Claude Code hooks against the new server ──
// ── [PCODE-107 | S15 | v0.1.0] Build the Plane importer: projects, items, states, comments, cycles, history ──
// ── [PCODE-148 | S15 | v0.1.0] Add signed licence keys with seats, features and expiry ──
// ── [PCODE-141 | S15 | v0.1.0] Audit dependencies against the OSV database ──
// ── [PCODE-140 | S15 | v0.1.0] Write our own secret scanner and code rules: orq scan ──
// ── [PCODE-136 | S15 | v0.1.0] Stream test results from a running suite and import JUnit ──
// ── [PCODE-133 | S15 | v0.1.0] Add infrastructure templates and deploy from a gate ──
// ── [PCODE-132 | S15 | v0.1.0] Run deploys through our own runner and stream each step ──
// ── [PCODE-130 | S15 | v0.1.0] Build the design-partner install kit: backup, restore, check, guide ──
//    Why:  argument handling kept apart from process I/O, so every command is testable as a function.
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_VERSION, PRODUCT_NAME } from '@orqiva/shared';
import { spawnExec } from './install/exec.js';
import {
  InstallError,
  defaultInstallDir,
  install,
  waitForHealth,
  type Exec,
} from './install/install.js';
// [PCODE-130 | S15 | v0.1.0]
import { backup, check, checkReport, restore, verifyBackup } from './install/maintain.js';
import { bundle } from './install/bundle.js'; // [PCODE-215 | S15 | v0.1.0]
// [PCODE-132 | S15 | v0.1.0]
import { runForever, runOnce, spawnShell, type RunnerDeps } from './runner/runner.js';
// [PCODE-133 | S15 | v0.1.0]
import { writeTemplates } from './infra/templates.js';
// [PCODE-136 | S15 | v0.1.0]
import { runTests, TEST_USAGE } from './tests/command.js';
// [PCODE-140 | S15 | v0.1.0]
import { runScan, SCAN_USAGE } from './scan/command.js';
// [PCODE-141 | S15 | v0.1.0]
import { osvClient, scanDependencies } from './scan/deps.js';
// [PCODE-148 | S15 | v0.1.0]
import { keygen, LicenceError, licenceFrom, readPrivateKey, signLicence } from './keys/licence.js';
import { readFile as readText } from 'node:fs/promises';
import { loadLink } from './loop/config.js';
import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from './install/files.js';
import { runLicences } from './licences/command.js';
import { findRoot } from './loop/config.js';
import { ApiError } from './loop/api.js';
import { LOOP_USAGE, LoopError, runLoop, type LoopDeps } from './loop/commands.js';
import { IMPORT_USAGE, runImport } from './import/command.js';
import { PlaneError, type PlaneReaderOptions } from './import/plane.js';
import { installHooks, runHook } from './loop/hooks.js';
import { runTeam, TEAM_USAGE } from './loop/team.js'; // [PCODE-195 | S15 | v0.1.0]
import { DOCS_USAGE, runDocs } from './loop/docs.js'; // [PCODE-201 | S15 | v0.1.0]
import { KIT_USAGE, runKit } from './loop/kit.js'; // [PCODE-290 | S15 | v0.1.0]
import { VISUAL_USAGE, runVisual } from './loop/visual.js'; // [PCODE-295 | S15 | v0.1.0]
import { A11Y_USAGE, runA11y } from './loop/a11y.js'; // [PCODE-296 | S15 | v0.1.0]
import { RELEASE_USAGE, runRelease } from './loop/release.js'; // [PCODE-207 | S15 | v0.1.0]
import { PORTFOLIO_USAGE, runPortfolio } from './loop/portfolio.js'; // [PCODE-211 | S15 | v0.1.0]

export interface CliResult {
  code: number;
  out: string;
}

export interface CliDeps {
  exec?: Exec;
  /** progress lines while a command runs */
  log?: (line: string) => void;
  /** [PCODE-103 | S15 | v0.1.0] the loop's view of the machine; the real one when left out */
  loop?: Partial<LoopDeps>;
  /** the hook's JSON, as Claude Code sends it on stdin */
  stdin?: () => Promise<string>;
  /** [PCODE-107 | S15 | v0.1.0] how the Plane reader paces itself (tests: no pause) */
  plane?: PlaneReaderOptions;
  /** [PCODE-130 | S15 | v0.1.0] health checks of an install (tests: a fake server) */
  fetchImpl?: typeof fetch;
}

function loopDeps(deps: CliDeps): LoopDeps {
  return {
    cwd: process.cwd(),
    home: homedir(),
    hostname: hostname(),
    exec: deps.exec ?? spawnExec,
    env: process.env,
    ...deps.loop,
  };
}

// [PCODE-215 | S15 | v0.1.0] what --help says for the install commands
const INSTALL_HELP: Record<string, string> = {
  install:
    'orq install [--dir DIR] [--port N] [--public-url URL] [--image NAME] [--build REPO] [--tls-email ADDRESS] [--bundle FILE]\n' +
    '  Installs or upgrades Orqiva with Docker Compose. --bundle installs from an offline bundle (orq bundle) without pulling.\n' +
    'orq install --check [--dir DIR] [--port N]\n  Checks what would stand in the way; changes nothing.',
  backup:
    'orq backup [--dir DIR] [--out FILE]\n  Dumps the database (and uploaded files), reads it back and writes FILE.sha256.\n' +
    'orq backup --verify FILE [--dir DIR]\n  Checks an older backup: its checksum and that PostgreSQL reads it.',
  restore:
    'orq restore FILE --yes [--dir DIR]\n  Replaces the data of the install with a backup; refuses one that does not match its checksum.',
  bundle:
    'orq bundle [--out FILE] [--image NAME] [--build REPO] [--cli orq.mjs]\n  Saves the server, PostgreSQL and Caddy images into FILE (with FILE.json), and orq.mjs beside it, for a site without internet.',
};

const USAGE = [
  'Usage: orq <command>',
  '',
  'Commands:',
  '  install [--dir DIR] [--port N] [--public-url URL] [--image NAME] [--build REPO] [--tls-email ADDRESS] [--bundle FILE]',
  '              install or upgrade Orqiva with Docker Compose (default dir ~/orqiva, or ~/prodengine for an earlier install)',
  '  install --check [--dir DIR] [--port N]',
  '              check Docker, disk, port and the server without changing anything',
  '  backup [--dir DIR] [--out FILE] | backup --verify FILE',
  '              dump the database into a dated file (default DIR/backups), checked and with a checksum',
  '  bundle [--out FILE] [--image NAME] [--build REPO]',
  '              save the images for an install without internet (then: install --bundle FILE)',
  '  restore FILE --yes [--dir DIR]',
  '              replace the data of the install with a backup',
  '  infra init [--force]',
  '              write deploy templates (Docker Compose, OpenTofu) into this repository',
  '  licence issue --key FILE --customer NAME --email ADDR --plan team|business|enterprise --seats N [--days N] [--features a,b]',
  '              sign a licence with the vendor key (vendor only); licence keygen --out DIR makes a key pair',
  '  runner --server URL [--token T] [--repo DIR] [--once]',
  '              run deploys on this machine (token from Settings, or ORQIVA_RUNNER_TOKEN)',
  '  licences [--root DIR] [--out DIR]',
  '              check every shipped third-party licence, write the SBOM and notices',
  '',
  'The task loop:',
  ...LOOP_USAGE,
  '',
  'With the team (the web app, from the terminal):',
  ...TEAM_USAGE,
  ...DOCS_USAGE, // [PCODE-201 | S15 | v0.1.0]
  ...KIT_USAGE, // [PCODE-290 | S15 | v0.1.0]
  ...VISUAL_USAGE, // [PCODE-295 | S15 | v0.1.0]
  ...A11Y_USAGE, // [PCODE-296 | S15 | v0.1.0]
  ...RELEASE_USAGE, // [PCODE-207 | S15 | v0.1.0]
  ...PORTFOLIO_USAGE, // [PCODE-211 | S15 | v0.1.0]
  '',
  'Import, tests and scans:', // [PCODE-218 | S15 | v0.1.0] a header, so the docs site names the section
  IMPORT_USAGE,
  TEST_USAGE,
  SCAN_USAGE,
  '',
  '  --version   print the version',
  '  --help      print this help',
].join('\n');

/** Value of `--name value` in argv, if present. */
function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

export async function run(argv: readonly string[], deps: CliDeps = {}): Promise<CliResult> {
  const [command] = argv;
  if (command === '--version' || command === '-v') {
    return { code: 0, out: PRODUCT_NAME + ' ' + PLATFORM_VERSION };
  }
  if (command === undefined || command === '--help' || command === '-h') {
    return { code: 0, out: USAGE };
  }
  // [PCODE-85 | S08 | v0.1.0] the licence gate
  if (command === 'licences' || command === 'licenses') {
    const root = option(argv, '--root');
    const out = option(argv, '--out');
    const r = runLicences({ ...(root ? { root } : {}), ...(out ? { out } : {}) });
    return { code: r.code, out: r.out };
  }
  // [PCODE-91 | S15 | v0.1.0] one command to a running install
  // [PCODE-130 | S15 | v0.1.0] the design-partner kit: check, backup, restore
  const installDir = option(argv, '--dir') ?? defaultInstallDir(homedir());
  const say = deps.log ?? ((l: string) => process.stdout.write(l + '\n'));
  if (command === 'install' && argv.includes('--check')) {
    const port = option(argv, '--port');
    const lines = await check({
      dir: installDir,
      ...(port ? { port: Number(port) } : {}),
      exec: deps.exec ?? spawnExec,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
    return { code: lines.every((l) => l.ok) ? 0 : 1, out: checkReport(lines) };
  }
  // [PCODE-132 | S15 | v0.1.0] the deploy runner on this machine
  // [PCODE-148 | S15 | v0.1.0] the vendor's licence tools
  if (command === 'licence' || command === 'license') {
    try {
      if (argv[1] === 'keygen') {
        const dir = option(argv, '--out');
        if (!dir)
          return { code: 2, out: 'Usage: orq licence keygen --out DIR (outside any repository)' };
        const k = keygen(dir);
        return {
          code: 0,
          out:
            'Private key: ' +
            k.privatePath +
            ' (keep it safe and backed up)\nPublic key:\n' +
            k.publicPem,
        };
      }
      if (argv[1] === 'issue') {
        const key = option(argv, '--key');
        const customer = option(argv, '--customer');
        const email = option(argv, '--email');
        const seats = Number(option(argv, '--seats'));
        if (!key || !customer || !email || !Number.isInteger(seats))
          return {
            code: 2,
            out: 'Usage: orq licence issue --key FILE --customer NAME --email ADDR --plan PLAN --seats N [--days N] [--features a,b]',
          };
        const days = option(argv, '--days');
        const token = signLicence(
          licenceFrom({
            customer,
            email,
            plan: option(argv, '--plan') ?? 'team',
            seats,
            days: days ? Number(days) : null,
            features: (option(argv, '--features') ?? '')
              .split(',')
              .map((f) => f.trim())
              .filter(Boolean),
            now: new Date(),
          }),
          readPrivateKey(key),
        );
        return { code: 0, out: token };
      }
      return { code: 2, out: 'Usage: orq licence issue … | orq licence keygen --out DIR' };
    } catch (err) {
      if (err instanceof LicenceError) return { code: 1, out: err.message };
      throw err;
    }
  }
  // [PCODE-133 | S15 | v0.1.0] deploy templates for this repository
  if (command === 'infra') {
    if (argv[1] !== 'init') return { code: 2, out: 'Usage: orq infra init [--force]' };
    const cwd = deps.loop?.cwd ?? process.cwd();
    const root = findRoot(cwd) ?? cwd;
    const key = loadLink(root)?.projectKey ?? 'APP';
    const r = writeTemplates(root, key, argv.includes('--force'));
    return {
      code: 0,
      out:
        (r.written.length ? 'Wrote ' + r.written.join(', ') + '.' : 'Nothing new to write.') +
        (r.kept.length ? ' Kept ' + r.kept.join(', ') + ' (use --force to replace).' : '') +
        ' Secrets stay in Orqiva; see deploy/README.md.',
    };
  }
  if (command === 'runner') {
    const server = option(argv, '--server')?.replace(/\/$/, '');
    const token = option(argv, '--token') ?? process.env['ORQIVA_RUNNER_TOKEN'];
    if (!server || !token)
      return { code: 2, out: 'Usage: orq runner --server URL --token TOKEN [--repo DIR] [--once]' };
    const rd: RunnerDeps = {
      server,
      token,
      cwd: option(argv, '--repo') ?? process.cwd(),
      shell: spawnShell,
      fetchImpl: deps.fetchImpl ?? fetch,
      log: say,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    if (argv.includes('--once')) {
      const ran = await runOnce(rd);
      return { code: 0, out: ran ? 'Done.' : 'Nothing to deploy.' };
    }
    say('Runner started; waiting for deploys of ' + server + ' (Ctrl+C stops it)');
    let stopped = false;
    process.once('SIGINT', () => {
      stopped = true;
    });
    await runForever(rd, () => stopped);
    return { code: 0, out: 'Runner stopped.' };
  }
  // ── [PCODE-215 | S15 | v0.1.0] --help prints the usage of the install commands instead of running them ──
  if (
    ['install', 'backup', 'restore', 'bundle'].includes(command) &&
    (argv.includes('--help') || argv.includes('-h'))
  )
    return { code: 0, out: INSTALL_HELP[command] ?? USAGE };
  if (command === 'bundle') {
    const out = option(argv, '--out') ?? 'orqiva-bundle-' + PLATFORM_VERSION + '.tar';
    const build = option(argv, '--build');
    // [PCODE-222 | S15 | v0.1.0] the command line in the bundle: --cli, this file when it is orq.mjs,
    // or the single-file build next to this one
    const self = fileURLToPath(import.meta.url);
    const single = fileURLToPath(new URL('../dist-single/orq.mjs', import.meta.url));
    const cli =
      option(argv, '--cli') ??
      (/\.mjs$/.test(self) ? self : existsSync(single) ? single : undefined);
    try {
      const m = await bundle({
        ...(cli ? { cli } : {}),
        image: option(argv, '--image') ?? 'prodengine/server:' + PLATFORM_VERSION,
        ...(build ? { build } : {}),
        out,
        version: PLATFORM_VERSION,
        exec: deps.exec ?? spawnExec,
        log: say,
      });
      return {
        code: 0,
        out:
          'Done: ' +
          m.file +
          ' (' +
          m.images.join(', ') +
          (m.cli ? ', and orq.mjs' : '') +
          '), sha256 ' +
          m.sha256,
      };
    } catch (err) {
      if (err instanceof InstallError) return { code: 1, out: err.message };
      throw err;
    }
  }
  if (command === 'backup' || command === 'restore') {
    try {
      // [PCODE-215 | S15 | v0.1.0] checks an older backup
      const verify = command === 'backup' ? option(argv, '--verify') : undefined;
      if (verify) {
        const v = await verifyBackup({
          dir: installDir,
          file: verify,
          exec: deps.exec ?? spawnExec,
          log: say,
        });
        return {
          code: 0,
          out:
            'OK: ' +
            String(v.tables) +
            ' tables' +
            (v.checksum === 'ok' ? ', checksum matches' : ', no checksum file'),
        };
      }
      if (command === 'backup') {
        const out = option(argv, '--out');
        const r = await backup({
          dir: installDir,
          exec: deps.exec ?? spawnExec,
          log: say,
          ...(out ? { out } : {}),
        });
        return { code: 0, out: 'Done: ' + r.file };
      }
      const file = argv[1];
      if (!file || file.startsWith('--'))
        return { code: 2, out: 'Usage: orq restore FILE --yes [--dir DIR]' };
      const envPath = join(installDir, '.env');
      const port = existsSync(envPath)
        ? parseEnv(readFileSync(envPath, 'utf8'))['ORQIVA_PORT']
        : undefined;
      await restore({
        dir: installDir,
        file,
        exec: deps.exec ?? spawnExec,
        log: say,
        confirmed: argv.includes('--yes'),
        waitForHealth: () =>
          waitForHealth(
            'http://127.0.0.1:' + (port ?? '8080') + '/health',
            180_000,
            deps.fetchImpl ?? fetch,
            (ms) => new Promise((r) => setTimeout(r, ms)),
          ),
      });
      return { code: 0, out: 'Done.' };
    } catch (err) {
      if (err instanceof InstallError) return { code: 1, out: err.message };
      throw err;
    }
  }
  if (command === 'install') {
    const port = option(argv, '--port');
    const publicUrl = option(argv, '--public-url');
    const image = option(argv, '--image');
    const build = option(argv, '--build');
    const tlsEmail = option(argv, '--tls-email'); // [PCODE-191 | S15 | v0.1.0]
    const fromBundle = option(argv, '--bundle'); // [PCODE-215 | S15 | v0.1.0]
    try {
      const r = await install({
        dir: option(argv, '--dir') ?? defaultInstallDir(homedir()),
        ...(port ? { port: Number(port) } : {}),
        ...(publicUrl ? { publicUrl } : {}),
        ...(image ? { image } : {}),
        ...(build ? { build } : {}),
        ...(tlsEmail ? { tlsEmail } : {}),
        ...(fromBundle ? { bundle: fromBundle } : {}),
        exec: deps.exec ?? spawnExec,
        log: deps.log ?? ((l) => process.stdout.write(l + '\n')),
      });
      return { code: 0, out: 'Done: ' + r.url };
    } catch (err) {
      if (err instanceof InstallError) return { code: 1, out: err.message };
      throw err;
    }
  }
  // [PCODE-103 | S15 | v0.1.0] the loop and the Claude Code hooks
  if (command === 'hook') {
    // a hook never breaks the session: whatever happens, exit 0
    try {
      const r = await runHook(argv[1] ?? '', deps.stdin ? await deps.stdin() : '', loopDeps(deps));
      return { code: 0, out: r.stdout };
    } catch {
      return { code: 0, out: '' };
    }
  }
  if (command === 'hooks') {
    if (argv[1] !== 'install') return { code: 2, out: 'Usage: orq hooks install' };
    const ld = loopDeps(deps);
    const root = findRoot(ld.cwd);
    if (!root)
      return { code: 1, out: 'Link this folder first: orq link <PROJECT-KEY> --server <url>' };
    // [PCODE-222 | S15 | v0.1.0] in the single-file build (orq.mjs) this code is the command itself
    const self = fileURLToPath(import.meta.url);
    const main =
      ld.env['PE_MAIN'] ??
      (/[\\/]run\.[jt]s$/.test(self) ? fileURLToPath(new URL('./main.js', import.meta.url)) : self);
    return { code: 0, out: 'Hooks written to ' + installHooks(root, main.replace(/\\/g, '/')) };
  }
  // [PCODE-107 | S15 | v0.1.0] imports from other tools
  if (command === 'import') {
    try {
      return await runImport(argv, {
        ...loopDeps(deps),
        ...(deps.plane ? { plane: deps.plane } : {}),
        log: deps.log ?? ((l) => process.stderr.write(l + '\n')),
      });
    } catch (err) {
      if (err instanceof LoopError || err instanceof ApiError || err instanceof PlaneError)
        return { code: 1, out: err.message };
      throw err;
    }
  }
  // [PCODE-136 | S15 | v0.1.0] test runs streamed from a suite, and JUnit imports
  // [PCODE-140 | S15 | v0.1.0] our own scanner
  if (command === 'scan') {
    try {
      // [PCODE-141 | S15 | v0.1.0] --deps adds the dependency audit against OSV
      const fetchImpl = deps.fetchImpl ?? fetch;
      return await runScan(
        argv,
        loopDeps(deps),
        argv.includes('--deps')
          ? (root, files) =>
              scanDependencies(
                files,
                (f) => readText(join(root, f), 'utf8').catch(() => null),
                osvClient(fetchImpl),
              )
          : undefined,
      );
    } catch (err) {
      if (err instanceof LoopError || err instanceof ApiError) return { code: 1, out: err.message };
      throw err;
    }
  }
  if (command === 'test') {
    try {
      return await runTests(argv, loopDeps(deps));
    } catch (err) {
      if (err instanceof LoopError || err instanceof ApiError) return { code: 1, out: err.message };
      throw err;
    }
  }
  // [PCODE-211 | S15 | v0.1.0] the portfolio
  try {
    const pf = await runPortfolio(argv, loopDeps(deps));
    if (pf) return pf;
  } catch (err) {
    if (err instanceof LoopError || err instanceof ApiError) return { code: 1, out: err.message };
    throw err;
  }
  // [PCODE-207 | S15 | v0.1.0] releases, environments and trains
  try {
    const rel = await runRelease(argv, loopDeps(deps));
    if (rel) return rel;
  } catch (err) {
    if (err instanceof LoopError || err instanceof ApiError) return { code: 1, out: err.message };
    throw err;
  }
  // [PCODE-201 | S15 | v0.1.0] docs from code and the handover
  try {
    const docs = await runDocs(argv, loopDeps(deps));
    if (docs) return docs;
    // [PCODE-290 | S15 | v0.1.0] the UI kit in the code
    const kit = await runKit(argv, loopDeps(deps));
    if (kit) return kit;
    // [PCODE-295 | S15 | v0.1.0] visual regression from CI
    const visual = await runVisual(argv, loopDeps(deps));
    if (visual) return visual;
    // [PCODE-296 | S15 | v0.1.0] accessibility in the code and on the page
    const a11y = await runA11y(argv, loopDeps(deps));
    if (a11y) return a11y;
  } catch (err) {
    if (err instanceof LoopError || err instanceof ApiError) return { code: 1, out: err.message };
    throw err;
  }
  // [PCODE-195 | S15 | v0.1.0] inbox, approvals, comments, time, agents, ideas
  try {
    const team = await runTeam(argv, loopDeps(deps));
    if (team) return team;
  } catch (err) {
    if (err instanceof LoopError || err instanceof ApiError) return { code: 1, out: err.message };
    throw err;
  }
  const loop = await runLoop(argv, loopDeps(deps));
  if (loop) return loop;
  return { code: 2, out: 'Unknown command: ' + command + '\n\n' + USAGE };
}
