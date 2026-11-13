// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-48 | S09 | v0.1.0] Bump version via plane version bump with clean-worktree guard and tag check ──
//    Why:  the guard, the order (write, stage, then the engine - so the engine's commit carries the
//          changelog), the engine call itself, the tag check, and one real bump with the real engine.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bumpVersion, confirmMessage, writePackageVersion } from '../../src/release/bump';
import { EngineCommands } from '../../src/engine/commands';
import { runEngine } from '../../src/engine/run';
import type { Services } from '../../src/services';
import { Store } from '../../src/state/store';
import { Logger, resetLoggerForTests } from '../../src/util/log';

const versionIn = (file: string): string =>
  (JSON.parse(fs.readFileSync(file, 'utf8')) as { version: string }).version;

const SECTION = '## v0.1.1 (2026-02-06)\n\n### Features\n\n- FIX-2 Something\n';
const available = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-bump-'));
  const git = (...args: string[]): void => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.test');
  git('config', 'user.name', 'Orqiva Test');
  git('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(root, '.plane'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.plane', 'project.json'),
    `${JSON.stringify(
      {
        workspace: 'ws',
        project_id: '00000000-0000-4000-8000-000000000000',
        identifier: 'FIX',
        name: 'Fixture',
        version: '0.1.0',
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'x', version: '0.1.0' }, null, 2)}\n`,
  );
  git('add', '-A');
  git('commit', '-qm', 'FIX-1 First');
  return root;
}

function services(root: string, engine: EngineCommands): Services & { store: Store } {
  const store = new Store();
  store.load(root);
  return {
    store,
    log: new Logger(),
    root: () => root,
    engine,
    secrets: { hasApiKey: () => Promise.resolve(false) },
    client: {},
  } as unknown as Services & { store: Store };
}

/** an engine that only records the call and does what plane_task.cmd_version does */
function fakeEngine(root: string, calls: string[][], opts: { tag?: boolean } = {}): EngineCommands {
  return new EngineCommands((_script, args) => {
    calls.push(args);
    const link = JSON.parse(fs.readFileSync(path.join(root, '.plane', 'project.json'), 'utf8')) as {
      version: string;
    };
    const [major, minor, patch] = link.version.split('.').map(Number) as [number, number, number];
    const part = args[2];
    const to =
      part === 'major'
        ? `${String(major + 1)}.0.0`
        : part === 'minor'
          ? `${String(major)}.${String(minor + 1)}.0`
          : `${String(major)}.${String(minor)}.${String(patch + 1)}`;
    fs.writeFileSync(
      path.join(root, '.plane', 'project.json'),
      `${JSON.stringify({ ...link, version: to }, null, 2)}\n`,
    );
    const git = (...a: string[]): void => {
      spawnSync('git', a, { cwd: root, encoding: 'utf8' });
    };
    git('add', '.plane/project.json');
    git('commit', '-qm', `chore(plane): version ${to}`);
    if (opts.tag !== false) git('tag', '-f', `v${to}`);
    return Promise.resolve({
      code: 0,
      stdout: `Version ${link.version} -> ${to} (tag v${to})\n`,
      stderr: '',
    });
  });
}

describe('bumpVersion', () => {
  let root = '';
  beforeEach(() => {
    resetLoggerForTests();
    if (available) root = repo();
  });
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('asks with both versions', () => {
    expect(confirmMessage('0.1.0', '0.2.0')).toBe(
      'Bump 0.1.0 to 0.2.0? This writes CHANGELOG.md and package.json, commits and tags v0.2.0.',
    );
  });

  it('writes only the version line of package.json', () => {
    const io = {
      existsSync: () => true,
      readFileSync: () => '{\n  "name": "x",\n  "version": "0.1.0",\n  "scripts": {}\n}\n',
      writeFileSync: (_p: string, data: string) => {
        written = data;
      },
    };
    let written = '';
    expect(writePackageVersion('C:\\p', '0.2.0', io)).toBe(true);
    expect(written).toBe('{\n  "name": "x",\n  "version": "0.2.0",\n  "scripts": {}\n}\n');
    expect(writePackageVersion('C:\\p', '0.2.0', { ...io, existsSync: () => false })).toBe(false);
  });

  // ── [PCODE-48 | S09 | v0.1.0] refuses_dirty_worktree ──
  it.skipIf(!available)('refuses a dirty worktree and a version mismatch', async () => {
    const calls: string[][] = [];
    const svc = services(root, fakeEngine(root, calls));
    fs.writeFileSync(path.join(root, 'dirty.txt'), 'x\n');
    await expect(bumpVersion({ services: svc, part: 'patch', section: SECTION })).rejects.toThrow(
      /Commit or stash 1 changed file\(s\) before bumping: dirty.txt/,
    );
    fs.unlinkSync(path.join(root, 'dirty.txt'));

    fs.writeFileSync(
      path.join(root, 'package.json'),
      `${JSON.stringify({ name: 'x', version: '0.0.9' }, null, 2)}\n`,
    );
    spawnSync('git', ['commit', '-qam', 'FIX-9 wrong version'], { cwd: root });
    await expect(bumpVersion({ services: svc, part: 'patch', section: SECTION })).rejects.toThrow(
      /Versions disagree: package.json says 0.0.9/,
    );
    expect(calls).toEqual([]);
    expect(fs.existsSync(path.join(root, 'CHANGELOG.md'))).toBe(false);
  });

  it.skipIf(!available)('a cancelled confirmation changes nothing', async () => {
    const calls: string[][] = [];
    const svc = services(root, fakeEngine(root, calls));
    const r = await bumpVersion({
      services: svc,
      part: 'patch',
      section: SECTION,
      confirm: () => Promise.resolve(false),
    });
    expect(r).toBeUndefined();
    expect(calls).toEqual([]);
    expect(fs.existsSync(path.join(root, 'CHANGELOG.md'))).toBe(false);
  });

  // ── [PCODE-48 | S09 | v0.1.0] uses_engine_bump + stages_changelog_and_package_before_engine ──
  it.skipIf(!available)('writes, stages, then lets the engine commit and tag', async () => {
    const calls: string[][] = [];
    const svc = services(root, fakeEngine(root, calls));
    let stagedWhenEngineRan: string[] = [];
    const r = await bumpVersion({
      services: svc,
      part: 'minor',
      section: '## v0.2.0 (2026-02-06)\n\n- FIX-2 Something\n',
      today: '2026-02-06',
      confirm: () => Promise.resolve(true),
      staged: (files) => {
        stagedWhenEngineRan = [
          ...spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' })
            .stdout.split('\n')
            .filter(Boolean),
        ];
        expect(files).toEqual(['CHANGELOG.md', 'package.json']);
      },
    });
    expect(calls).toEqual([['version', 'bump', 'minor']]);
    // both files were staged before the engine ran, so its commit carries them
    expect(stagedWhenEngineRan.sort()).toEqual(['CHANGELOG.md', 'package.json']);
    expect(r).toMatchObject({ from: '0.1.0', to: '0.2.0', tag: 'v0.2.0', packageUpdated: true });
    expect(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')).toContain(
      '## v0.2.0 (2026-02-06)',
    );
    expect(versionIn(path.join(root, 'package.json'))).toBe('0.2.0');
    expect(svc.store.state.link?.version).toBe('0.2.0'); // the store reloaded the link
    const show = spawnSync('git', ['show', '--stat', '--name-only', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout;
    expect(show).toContain('CHANGELOG.md');
    expect(show).toContain('.plane/project.json');
    expect(
      spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    ).toBe('');
  });

  // ── [PCODE-48 | S09 | v0.1.0] verifies_tag ──
  it.skipIf(!available)('complains when the engine did not tag', async () => {
    const calls: string[][] = [];
    const svc = services(root, fakeEngine(root, calls, { tag: false }));
    await expect(
      bumpVersion({
        services: svc,
        part: 'patch',
        section: SECTION,
        confirm: () => Promise.resolve(true),
      }),
    ).rejects.toThrow(/but git's last tag is none/);
  });
});

// ── [PCODE-48 | S09 | v0.1.0] the same bump, with the engine that ships ──
describe('bumpVersion (real engine)', () => {
  const home = process.env['PLANE_CLAUDE_HOME'] ?? '';
  const python = (() => {
    for (const c of [['py', '-3'], ['python3'], ['python']]) {
      const r = spawnSync(c[0] ?? '', [...c.slice(1), '--version'], { encoding: 'utf8' });
      if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return c;
    }
    return null;
  })();
  const canRun =
    available &&
    Boolean(python) &&
    Boolean(home) &&
    fs.existsSync(path.join(home, 'plane_task.py'));
  let root = '';
  beforeEach(() => {
    resetLoggerForTests();
    if (canRun) root = repo();
  });
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it.skipIf(!canRun)(
    'bumps patch to 0.1.1, tags it and commits the changelog',
    async () => {
      // cmd_version needs credentials to construct its client, but never calls Plane
      const env = {
        PLANE_API_KEY: 'plane_api_not_a_real_key',
        PLANE_WORKSPACE_SLUG: 'ws',
        PLANE_BASE_URL: 'https://plane.example.test',
      };
      const engine = new EngineCommands((script, args) =>
        runEngine({ python: python ?? [], home }, script, args, { cwd: root, env }),
      );
      const svc = services(root, engine);
      const r = await bumpVersion({
        services: svc,
        part: 'patch',
        section: SECTION,
        today: '2026-02-06',
        confirm: () => Promise.resolve(true),
      });
      expect(r).toMatchObject({ from: '0.1.0', to: '0.1.1', tag: 'v0.1.1', packageUpdated: true });
      expect(versionIn(path.join(root, '.plane', 'project.json'))).toBe('0.1.1');
      expect(versionIn(path.join(root, 'package.json'))).toBe('0.1.1');
      expect(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')).toContain(
        '## v0.1.1 (2026-02-06)',
      );
      const describe_ = spawnSync('git', ['describe', '--tags', '--abbrev=0'], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(describe_.stdout.trim()).toBe('v0.1.1');
      const files = spawnSync('git', ['show', '--name-only', '--format=', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).stdout;
      expect(files).toContain('CHANGELOG.md');
      expect(files).toContain('package.json');
      expect(files).toContain('.plane/project.json');
    },
    60_000,
  );
});
