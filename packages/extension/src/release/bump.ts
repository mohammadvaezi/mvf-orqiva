// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-48 | S09 | v0.1.0] Bump version via plane version bump with clean-worktree guard and tag check ──
// ── [PCODE-49 | S09 | v0.1.0] Create or update the Release item in Plane on bump via plane new ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the engine is the only thing that commits and tags (criticals #7). So the order is fixed: refuse a
//          dirty or disagreeing worktree, ask once, write CHANGELOG.md and package.json, stage exactly those
//          two, then let `plane version bump` write project.json and commit *everything staged* - which is
//          how the changelog lands in the version commit - and finally check that the tag really exists.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Services } from '../services';
import { lastTag, stage, tagDate, type GitOptions } from '../util/git';
import { OrqivaError } from '../util/errors';
import {
  CHANGELOG_FILE,
  collectChangelog,
  renderSection,
  writeChangelog,
  type ChangelogIo,
} from './changelog';
import { ensureReleaseItem, type ReleaseItemResult } from './releaseItem';
import { nextVersion, readVersionInfo, type BumpPart, type VersionInfo } from './version';

export const PACKAGE_FILE = 'package.json';
export const CHANGELOG_OFFLINE =
  'Changelog needs the tracker — sign in to see what goes into the release.';

export type ReleaseServices = Pick<
  Services,
  'client' | 'store' | 'secrets' | 'log' | 'engine' | 'root'
>;

// ── [PCODE-48 | S09 | v0.1.0] changelogPreview: the section a bump of `part` would write, null while offline ──
export async function changelogPreview(
  services: Pick<Services, 'client' | 'store' | 'secrets' | 'log'>,
  info: VersionInfo,
  part: BumpPart,
  root: string,
  today: string,
  git?: Omit<GitOptions, 'cwd'>,
): Promise<string | null> {
  const link = services.store.state.link;
  if (!link || !(await services.secrets.hasApiKey())) return null;
  try {
    const [issues, states, labels] = await Promise.all([
      services.client.getIssues(link.project_id),
      services.client.getStates(link.project_id),
      services.client.getLabels(link.project_id),
    ]);
    const sinceIso = info.lastTag ? await tagDate(info.lastTag, { cwd: root, ...git }) : null;
    return renderSection(
      nextVersion(info.version, part),
      today,
      collectChangelog({
        issues,
        states,
        labels,
        identifier: link.identifier,
        sinceIso,
        commits: info.commits,
      }),
    );
  } catch (e) {
    services.log.warn(
      `changelog preview unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

// ── [PCODE-48 | S09 | v0.1.0] writePackageVersion: the version line only - never a reformatted package.json ──
export function writePackageVersion(root: string, version: string, io: ChangelogIo): boolean {
  const file = path.join(root, PACKAGE_FILE);
  if (!io.existsSync(file)) return false;
  const text = io.readFileSync(file, 'utf8');
  const replaced = text.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${version}$3`);
  if (replaced === text) return false;
  io.writeFileSync(file, replaced, 'utf8');
  return true;
}

export function confirmMessage(from: string, to: string): string {
  return `Bump ${from} to ${to}? This writes CHANGELOG.md and package.json, commits and tags v${to}.`;
}

export interface BumpResult {
  from: string;
  to: string;
  tag: string;
  changelogFile: string;
  packageUpdated: boolean;
  /** what the engine printed */
  engine: { from: string; to: string };
  /** [PCODE-49 | S09 | v0.1.0] the Release item in Plane, when one could be found or made */
  release?: ReleaseItemResult;
}

export interface BumpDeps {
  services: ReleaseServices;
  part: BumpPart;
  today?: string;
  /** the changelog section; when absent it is built here (and a missing one refuses the bump) */
  section?: string | null;
  confirm?: (message: string) => Promise<boolean>;
  git?: Omit<GitOptions, 'cwd'>;
  io?: ChangelogIo;
  /** injected for tests */
  staged?: (files: string[]) => void;
}

const defaultIo: ChangelogIo = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, d, enc) => {
    fs.writeFileSync(p, d, enc);
  },
};

// ── [PCODE-48 | S09 | v0.1.0] bumpVersion: guard -> confirm -> write -> stage -> engine -> verify the tag ──
export async function bumpVersion(deps: BumpDeps): Promise<BumpResult | undefined> {
  const { services, part } = deps;
  const io = deps.io ?? defaultIo;
  const root = services.root();
  const link = services.store.state.link;
  if (!root || !link)
    throw new OrqivaError('Link this folder to an Orqiva project first.', 'config');
  const git: GitOptions = { cwd: root, ...deps.git };
  const today = deps.today ?? new Date().toISOString().slice(0, 10);

  // the guard is read again here, not taken from the panel: minutes may have passed
  const info = await readVersionInfo({
    root,
    version: link.version,
    ...(deps.git ? { git: deps.git } : {}),
  });
  if (!info.isRepo)
    throw new OrqivaError(
      'This folder is not a git repository — the engine cannot commit or tag.',
      'user',
    );
  if (info.dirty)
    throw new OrqivaError(
      `Commit or stash ${String(info.changed.length)} changed file(s) before bumping: ${info.changed.slice(0, 5).join(', ')}`,
      'user',
    );
  if (info.mismatch.length)
    throw new OrqivaError(`Versions disagree: ${info.mismatch.join('; ')}.`, 'user');

  const section =
    deps.section === undefined
      ? await changelogPreview(services, info, part, root, today, deps.git)
      : deps.section;
  if (!section) throw new OrqivaError(CHANGELOG_OFFLINE, 'config');

  const to = nextVersion(info.version, part);
  if (deps.confirm && !(await deps.confirm(confirmMessage(info.version, to)))) return undefined;

  const { file: changelogFile } = writeChangelog(root, to, section, io);
  const packageUpdated = writePackageVersion(root, to, io);
  const files = [CHANGELOG_FILE, ...(packageUpdated ? [PACKAGE_FILE] : [])];
  await stage(files, git);
  deps.staged?.(files);

  // the engine writes project.json, commits (taking the staged files with it) and tags
  const engine = await services.engine.versionBump(part);

  const tag = await lastTag(git);
  if (tag !== `v${to}`)
    throw new OrqivaError(
      `The engine reported ${engine.from} -> ${engine.to} but git's last tag is ${tag ?? 'none'}.`,
      'engine',
    );
  services.store.load(root); // project.json now says `to`
  services.log.info(`version ${info.version} -> ${to} (tag ${tag})`);
  // [PCODE-49 | S09 | v0.1.0] the release item is a convenience, never a reason to fail a finished bump
  let release: ReleaseItemResult | undefined;
  try {
    release = await ensureReleaseItem({
      client: services.client,
      engine: services.engine,
      store: services.store,
      hasApiKey: () => services.secrets.hasApiKey(),
      version: to,
      section,
      today,
      log: (l) => {
        services.log.warn(l);
      },
    });
    if (release.created) services.log.info(`release item ${release.ref ?? ''} created`);
  } catch (e) {
    services.log.warn(`release item not created: ${e instanceof Error ? e.message : String(e)}`);
  }
  return {
    from: info.version,
    to,
    tag,
    changelogFile,
    packageUpdated,
    engine,
    ...(release ? { release } : {}),
  };
}
