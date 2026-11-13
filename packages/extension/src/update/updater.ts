// ── [PCODE-458 | S15 | v0.1.0] VS Code extension updates itself from GitHub: CI publishes the build, Update button installs it ──
//    Why:  testers got every fix as a zip with a script to run. Now GitHub builds the extension on every push
//          and publishes it as the release `ide-latest` (orqiva.vsix, orq.mjs and build.json). The Update
//          button reads that release, compares its build.json with the one this extension was built with,
//          and when GitHub's is newer it downloads the .vsix, has VS Code install it and puts the new orq
//          next to the old one (kept as orq.mjs.before-update). A private repository is read with the
//          VS Code GitHub sign-in. Free of vscode: the command passes in fetch, the sign-in and the install.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface BuildInfo {
  commit: string;
  builtAt: string;
  version: string;
}

export const VSIX_ASSET = 'orqiva.vsix';
export const ORQ_ASSET = 'orq.mjs';
export const BUILD_ASSET = 'build.json';

const isBuild = (v: unknown): v is BuildInfo =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as BuildInfo).commit === 'string' &&
  typeof (v as BuildInfo).builtAt === 'string' &&
  !Number.isNaN(Date.parse((v as BuildInfo).builtAt));

/** The build this extension is: dist/build.json next to the bundle; null for a build from before it. */
export function ownBuild(extensionPath: string): BuildInfo | null {
  try {
    const v: unknown = JSON.parse(
      fs.readFileSync(path.join(extensionPath, 'dist', 'build.json'), 'utf8'),
    );
    return isBuild(v) ? v : null;
  } catch {
    return null;
  }
}

/** GitHub's build is the one to install: another commit, built later (or nothing known about ours). */
export function isNewer(remote: BuildInfo, own: BuildInfo | null): boolean {
  if (!own) return true;
  return remote.commit !== own.commit && Date.parse(remote.builtAt) > Date.parse(own.builtAt);
}

export interface UpdateSource {
  /** owner/name */
  repository: string;
  /** the release's tag */
  release: string;
}

export interface UpdateDeps {
  fetchImpl?: typeof fetch;
  /** a GitHub token for a private repository; null when there is none (and none should be asked for) */
  token: () => Promise<string | null>;
}

interface Asset {
  name: string;
  url: string;
  size: number;
}

const API = 'https://api.github.com/repos/';

// ── [PCODE-458 | S15 | v0.1.0] the release: read without a token first, with the GitHub sign-in when private ──
async function github(
  url: string,
  accept: string,
  d: UpdateDeps,
): Promise<{ res: Response; authed: boolean }> {
  const f = d.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'orqiva-vscode',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const res = await f(url, { headers });
  if (res.status !== 404 && res.status !== 401 && res.status !== 403) return { res, authed: false };
  const token = await d.token();
  if (!token) return { res, authed: false };
  return {
    res: await f(url, { headers: { ...headers, Authorization: 'Bearer ' + token } }),
    authed: true,
  };
}

export class UpdateError extends Error {}

async function releaseAssets(src: UpdateSource, d: UpdateDeps): Promise<Asset[]> {
  const { res, authed } = await github(
    API + src.repository + '/releases/tags/' + encodeURIComponent(src.release),
    'application/vnd.github+json',
    d,
  );
  if (res.status === 404)
    throw new UpdateError(
      authed
        ? `No release "${src.release}" in ${src.repository} yet. It appears after the next push to GitHub has been built.`
        : `${src.repository} could not be read. If it is private, sign in to GitHub in VS Code (Accounts, bottom left) and try again.`,
    );
  if (!res.ok) throw new UpdateError(`GitHub answered ${String(res.status)} for the release.`);
  const body = (await res.json()) as { assets?: { name?: string; url?: string; size?: number }[] };
  return (body.assets ?? [])
    .filter((a) => a.name && a.url)
    .map((a) => ({ name: a.name ?? '', url: a.url ?? '', size: a.size ?? 0 }));
}

async function download(a: Asset, d: UpdateDeps): Promise<Buffer> {
  const { res } = await github(a.url, 'application/octet-stream', d);
  if (!res.ok) throw new UpdateError(`${a.name} could not be downloaded (${String(res.status)}).`);
  return Buffer.from(await res.arrayBuffer());
}

export interface UpdateCheck {
  remote: BuildInfo;
  own: BuildInfo | null;
  newer: boolean;
  assets: Asset[];
}

// ── [PCODE-458 | S15 | v0.1.0] check: GitHub's build.json against ours ──
export async function checkForUpdate(
  src: UpdateSource,
  own: BuildInfo | null,
  d: UpdateDeps,
): Promise<UpdateCheck> {
  const assets = await releaseAssets(src, d);
  const info = assets.find((a) => a.name === BUILD_ASSET);
  if (!info || !assets.some((a) => a.name === VSIX_ASSET))
    throw new UpdateError(`The release "${src.release}" has no ${VSIX_ASSET} and ${BUILD_ASSET}.`);
  const remote: unknown = JSON.parse((await download(info, d)).toString('utf8'));
  if (!isBuild(remote)) throw new UpdateError(`The release's ${BUILD_ASSET} cannot be read.`);
  return { remote, own, newer: isNewer(remote, own), assets };
}

export interface ApplyDeps extends UpdateDeps {
  /** VS Code installs the .vsix (workbench.extensions.installExtension) */
  install: (vsix: string) => Promise<void>;
  /** where this computer's orq lives; null when it has none (then orq is left alone) */
  orqPath: string | null;
  tmpDir?: string;
}

// ── [PCODE-458 | S15 | v0.1.0] apply: the .vsix into VS Code, the new orq next to the old one ──
export async function applyUpdate(
  check: UpdateCheck,
  d: ApplyDeps,
): Promise<{ vsix: string; orq: 'updated' | 'none' }> {
  const vsixAsset = check.assets.find((a) => a.name === VSIX_ASSET);
  if (!vsixAsset) throw new UpdateError(`The release has no ${VSIX_ASSET}.`);
  const dir = fs.mkdtempSync(path.join(d.tmpDir ?? os.tmpdir(), 'orqiva-update-'));
  const vsix = path.join(dir, 'orqiva-' + check.remote.commit.slice(0, 7) + '.vsix');
  const bytes = await download(vsixAsset, d);
  if (bytes.length < 1000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new UpdateError('The downloaded extension is not a .vsix file.');
  fs.writeFileSync(vsix, bytes);
  await d.install(vsix);
  let orq: 'updated' | 'none' = 'none';
  const orqAsset = check.assets.find((a) => a.name === ORQ_ASSET);
  if (orqAsset && d.orqPath && fs.existsSync(path.dirname(d.orqPath))) {
    const text = await download(orqAsset, d);
    if (fs.existsSync(d.orqPath)) fs.copyFileSync(d.orqPath, d.orqPath + '.before-update');
    fs.writeFileSync(d.orqPath, text);
    orq = 'updated';
  }
  return { vsix, orq };
}

/** "23 Oct 2026, 12:35" in the user's time zone, for messages. */
export function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
