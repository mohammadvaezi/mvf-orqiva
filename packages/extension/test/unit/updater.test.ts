// ── [PCODE-458 | S15 | v0.1.0] VS Code extension updates itself from GitHub: CI publishes the build, Update button installs it ──
//    Why:  the update against a fake GitHub: a newer build is found and installed with the new orq next to
//          the old one (backed up); the same or an older build is left alone; a private repository is
//          read with the sign-in's token only after GitHub refused without one; a broken release says why.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyUpdate,
  checkForUpdate,
  isNewer,
  ownBuild,
  UpdateError,
  type BuildInfo,
} from '../../src/update/updater';

const SRC = { repository: 'acme/orqiva', release: 'ide-latest' };
const REL = 'https://api.github.com/repos/acme/orqiva/releases/tags/ide-latest';
const VSIX = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(2000, 1)]);

function fakeGitHub(opts: { private?: boolean; build?: BuildInfo; assets?: string[] } = {}) {
  const calls: { url: string; auth: boolean }[] = [];
  const build: BuildInfo = opts.build ?? {
    commit: 'bbbbbbb1',
    builtAt: '2026-10-23T12:00:00Z',
    version: '0.1.7',
  };
  const files: Record<string, Buffer> = {
    'build.json': Buffer.from(JSON.stringify(build)),
    'orqiva.vsix': VSIX,
    'orq.mjs': Buffer.from('// new orq'),
  };
  const names = opts.assets ?? Object.keys(files);
  const fetchImpl = ((url: string, init: RequestInit) => {
    const auth = Boolean((init.headers as Record<string, string>)['Authorization']);
    calls.push({ url, auth });
    if (opts.private && !auth) return Promise.resolve(new Response('{}', { status: 404 }));
    if (url === REL)
      return Promise.resolve(
        new Response(
          JSON.stringify({
            assets: names.map((n) => ({ name: n, url: 'https://api.github.com/a/' + n, size: 1 })),
          }),
        ),
      );
    const name = url.replace('https://api.github.com/a/', '');
    const body = files[name];
    return Promise.resolve(body ? new Response(new Uint8Array(body)) : new Response('', { status: 404 }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orqiva-upd-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const own: BuildInfo = { commit: 'aaaaaaa1', builtAt: '2026-10-22T09:00:00Z', version: '0.1.0' };

describe('the update from GitHub', () => {
  it('finds a newer build, installs it and puts the new orq next to the old one', async () => {
    const gh = fakeGitHub();
    const check = await checkForUpdate(SRC, own, {
      fetchImpl: gh.fetchImpl,
      token: () => Promise.resolve(null),
    });
    expect(check.newer).toBe(true);
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'orq.mjs'), '// old orq');
    const installed: string[] = [];
    const r = await applyUpdate(check, {
      fetchImpl: gh.fetchImpl,
      token: () => Promise.resolve(null),
      install: (v) => {
        installed.push(v);
        return Promise.resolve();
      },
      orqPath: path.join(bin, 'orq.mjs'),
      tmpDir: dir,
    });
    expect(installed).toEqual([r.vsix]);
    expect(fs.readFileSync(r.vsix).equals(VSIX)).toBe(true);
    expect(r.orq).toBe('updated');
    expect(fs.readFileSync(path.join(bin, 'orq.mjs'), 'utf8')).toBe('// new orq');
    expect(fs.readFileSync(path.join(bin, 'orq.mjs.before-update'), 'utf8')).toBe('// old orq');
  });

  it('leaves the same or an older build alone, and installs over a build without build.json', () => {
    const remote = { commit: 'bbbbbbb1', builtAt: '2026-10-23T12:00:00Z', version: '0.1.7' };
    expect(isNewer(remote, own)).toBe(true);
    expect(isNewer(remote, { ...own, commit: 'bbbbbbb1' })).toBe(false);
    expect(isNewer(remote, { ...own, builtAt: '2026-10-24T00:00:00Z' })).toBe(false);
    expect(isNewer(remote, null)).toBe(true);
    expect(ownBuild(dir)).toBeNull();
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.writeFileSync(path.join(dir, 'dist', 'build.json'), JSON.stringify(own));
    expect(ownBuild(dir)).toEqual(own);
  });

  it('reads a private repository with the GitHub sign-in, only after GitHub refused without it', async () => {
    const gh = fakeGitHub({ private: true });
    let asked = 0;
    const token = (): Promise<string | null> => {
      asked++;
      return Promise.resolve('gho_test');
    };
    const check = await checkForUpdate(SRC, own, { fetchImpl: gh.fetchImpl, token });
    expect(check.newer).toBe(true);
    expect(asked).toBeGreaterThan(0);
    expect(gh.calls[0]).toEqual({ url: REL, auth: false });
    expect(gh.calls[1]).toEqual({ url: REL, auth: true });
    // without a sign-in, it says what to do
    await expect(
      checkForUpdate(SRC, own, { fetchImpl: gh.fetchImpl, token: () => Promise.resolve(null) }),
    ).rejects.toThrow(/sign in to GitHub in VS Code/);
  });

  it('says what is wrong with a release that lacks the files, and refuses a download that is no .vsix', async () => {
    const gh = fakeGitHub({ assets: ['orqiva.vsix'] });
    await expect(
      checkForUpdate(SRC, own, { fetchImpl: gh.fetchImpl, token: () => Promise.resolve(null) }),
    ).rejects.toBeInstanceOf(UpdateError);
    const ok = fakeGitHub();
    const check = await checkForUpdate(SRC, own, {
      fetchImpl: ok.fetchImpl,
      token: () => Promise.resolve(null),
    });
    const bad = (() => Promise.resolve(new Response('<html>'))) as unknown as typeof fetch;
    await expect(
      applyUpdate(check, {
        fetchImpl: bad,
        token: () => Promise.resolve(null),
        install: () => Promise.resolve(),
        orqPath: null,
        tmpDir: dir,
      }),
    ).rejects.toThrow('not a .vsix');
  });
});
