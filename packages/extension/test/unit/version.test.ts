// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-46 | S09 | v0.1.0] Build the Version panel with current version, last tag, commits and bump buttons ──
//    Why:  the VersionInfo for a clean repo, a dirty one, a package.json that disagrees and a repo without a
//          tag; the arithmetic of a bump; and the sentences the panel shows.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dirtyWarning,
  mismatches,
  nextVersion,
  readVersionInfo,
  tagLine,
  versionFromJson,
  versionOfTag,
} from '../../src/release/version';
import { CHANGELOG_OFFLINE, toMessage } from '../../src/webviews/version/panel';
import { isWebviewMessage } from '../../src/webviews/protocol';

describe('version arithmetic and wording', () => {
  it('bumps like the engine does', () => {
    expect(nextVersion('0.1.0', 'patch')).toBe('0.1.1');
    expect(nextVersion('0.1.9', 'minor')).toBe('0.2.0');
    expect(nextVersion('1.4.2', 'major')).toBe('2.0.0');
    expect(nextVersion('not a version', 'patch')).toBe('0.1.1'); // the engine's own fallback shape
    expect(versionOfTag('v1.2.3')).toBe('1.2.3');
    expect(versionOfTag('release-1')).toBeNull();
    expect(versionOfTag(null)).toBeNull();
  });

  it('names every disagreement', () => {
    expect(mismatches({ version: '0.1.0', packageVersion: '0.1.0', lastTag: 'v0.1.0' })).toEqual(
      [],
    );
    expect(mismatches({ version: '0.1.0', packageVersion: null, lastTag: null })).toEqual([]);
    expect(mismatches({ version: '0.1.0', packageVersion: '0.0.9', lastTag: null })).toEqual([
      'package.json says 0.0.9',
    ]);
    expect(mismatches({ version: '0.1.0', packageVersion: '0.1.0', lastTag: 'v0.2.0' })).toEqual([
      'the last tag is v0.2.0',
    ]);
    expect(mismatches({ version: '0.1.0', packageVersion: null, lastTag: 'nightly' })).toEqual([
      'the last tag nightly is not a version tag',
    ]);
  });

  it('reads a version out of a json file', () => {
    const io = {
      existsSync: (p: string) => !p.includes('missing'),
      readFileSync: (p: string) => (p.includes('broken') ? '{oops' : '{"version": "9.9.9"}'),
    };
    expect(versionFromJson('package.json', io)).toBe('9.9.9');
    expect(versionFromJson('missing.json', io)).toBeNull();
    expect(versionFromJson('broken.json', io)).toBeNull();
  });

  it('accepts the panel messages', () => {
    expect(isWebviewMessage({ type: 'version/refresh' })).toBe(true);
    expect(isWebviewMessage({ type: 'version/bump', part: 'minor' })).toBe(true);
    expect(isWebviewMessage({ type: 'version/bump', part: 'nightly' })).toBe(false);
  });
});

// ── [PCODE-46 | S09 | v0.1.0] the four states against a real repository ──
describe('readVersionInfo (real git)', () => {
  const available = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
  let root = '';
  const git = (...args: string[]): void => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  const writePackage = (version: string): void => {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      `${JSON.stringify({ name: 'x', version }, null, 2)}\n`,
    );
  };

  beforeEach(() => {
    if (!available) return;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-version-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.test');
    git('config', 'user.name', 'Orqiva Test');
    git('config', 'commit.gpgsign', 'false');
    writePackage('0.1.0');
    git('add', '-A');
    git('commit', '-qm', 'FIX-1 First');
  });
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(!available)('clean, no tag: ready to bump', async () => {
    const info = await readVersionInfo({ root, version: '0.1.0' });
    expect(info).toMatchObject({
      version: '0.1.0',
      packageVersion: '0.1.0',
      lastTag: null,
      isRepo: true,
      dirty: false,
      mismatch: [],
      canBump: true,
    });
    expect(info.commitsSinceTag).toBe(1);
    expect(info.next).toEqual({ patch: '0.1.1', minor: '0.2.0', major: '1.0.0' });
    expect(tagLine(info)).toBe('no tag yet · 1 commit since');
    expect(dirtyWarning(info)).toBe('');
    // [PCODE-47 | S09 | v0.1.0] a bump writes the changelog, so the panel needs one to enable the buttons
    const msg = toMessage(info, '## v0.1.1 (2026-02-06)\n');
    expect(msg.canBump).toBe(true);
    expect(msg.changelogNote).toBe('');
    expect(msg.commits[0]?.subject).toBe('FIX-1 First');
    const offline = toMessage(info);
    expect(offline.canBump).toBe(false);
    expect(offline.changelogNote).toBe(CHANGELOG_OFFLINE);
  });

  it.skipIf(!available)('dirty: bumping is refused and the files are named', async () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'x\n');
    const info = await readVersionInfo({ root, version: '0.1.0' });
    expect(info.dirty).toBe(true);
    expect(info.changed).toEqual(['a.txt']);
    expect(info.canBump).toBe(false);
    expect(dirtyWarning(info)).toBe('Commit or stash 1 changed file before bumping.');
    fs.writeFileSync(path.join(root, 'b.txt'), 'y\n');
    expect(dirtyWarning(await readVersionInfo({ root, version: '0.1.0' }))).toBe(
      'Commit or stash 2 changed files before bumping.',
    );
  });

  it.skipIf(!available)('a tag and a disagreeing package.json', async () => {
    git('tag', 'v0.1.0');
    fs.writeFileSync(path.join(root, 'c.txt'), 'z\n');
    git('add', '-A');
    git('commit', '-qm', 'FIX-2 Second');
    const info = await readVersionInfo({ root, version: '0.1.0' });
    expect(info.lastTag).toBe('v0.1.0');
    expect(info.commitsSinceTag).toBe(1);
    expect(tagLine(info)).toBe('v0.1.0 · 1 commit since');
    expect(info.canBump).toBe(true);

    writePackage('0.0.9');
    git('add', '-A');
    git('commit', '-qm', 'FIX-3 Wrong package version');
    const mismatched = await readVersionInfo({ root, version: '0.1.0' });
    expect(mismatched.mismatch).toEqual(['package.json says 0.0.9']);
    expect(mismatched.canBump).toBe(false);
  });

  it.skipIf(!available)('not a repository at all', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-norepo-'));
    try {
      const info = await readVersionInfo({ root: plain, version: '0.1.0' });
      expect(info).toMatchObject({
        isRepo: false,
        dirty: false,
        canBump: false,
        commitsSinceTag: 0,
      });
      expect(dirtyWarning(info)).toBe(
        'This folder is not a git repository — the engine cannot commit or tag.',
      );
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
