// ── [PCODE-46 | S09 | v0.1.0] Build the Version panel with current version, last tag, commits and bump buttons ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  three places claim to know the version - .plane/project.json (the engine's truth, and what the
//          fingerprints carry), package.json and the last git tag. The panel shows all three and names any
//          disagreement instead of quietly picking one; bumping is refused while they disagree or the
//          worktree is dirty, because the engine's bump commits whatever is staged.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { changedFiles, isRepo, lastTag, logSince, type Commit, type GitOptions } from '../util/git';

export type BumpPart = 'patch' | 'minor' | 'major';

export interface VersionInfo {
  /** .plane/project.json - the version the engine bumps and the fingerprints carry */
  version: string;
  /** package.json, when the project has one */
  packageVersion: string | null;
  lastTag: string | null;
  commitsSinceTag: number;
  commits: Commit[];
  isRepo: boolean;
  dirty: boolean;
  changed: string[];
  /** one line per disagreement; empty means the three agree */
  mismatch: string[];
  next: Record<BumpPart, string>;
  canBump: boolean;
}

export const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

// ── [PCODE-46 | S09 | v0.1.0] nextVersion: the engine's own arithmetic (plane_task.cmd_version) ──
export function nextVersion(version: string, part: BumpPart): string {
  const m = VERSION_RE.exec(version.trim());
  const [major, minor, patch] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 1, 0];
  if (part === 'major') return `${String(major + 1)}.0.0`;
  if (part === 'minor') return `${String(major)}.${String(minor + 1)}.0`;
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
}

export function versionOfTag(tag: string | null): string | null {
  if (!tag) return null;
  const m = VERSION_RE.exec(tag.replace(/^v/, ''));
  return m ? tag.replace(/^v/, '') : null;
}

export interface VersionIo {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, enc: 'utf8') => string;
}

const defaultIo: VersionIo = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
};

/** the version field of a JSON file, or null when the file is missing or unreadable */
export function versionFromJson(file: string, io: VersionIo = defaultIo): string | null {
  if (!io.existsSync(file)) return null;
  try {
    const v = (JSON.parse(io.readFileSync(file, 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

// ── [PCODE-46 | S09 | v0.1.0] mismatches: what to say when the three sources disagree ──
export function mismatches(input: {
  version: string;
  packageVersion: string | null;
  lastTag: string | null;
}): string[] {
  const out: string[] = [];
  if (input.packageVersion && input.packageVersion !== input.version)
    out.push(`package.json says ${input.packageVersion}`);
  const tagged = versionOfTag(input.lastTag);
  if (input.lastTag && !tagged) out.push(`the last tag ${input.lastTag} is not a version tag`);
  else if (tagged && tagged !== input.version) out.push(`the last tag is ${input.lastTag ?? ''}`);
  return out;
}

export interface VersionDeps {
  root: string;
  /** .plane/project.json version, usually store.state.link.version */
  version: string;
  io?: VersionIo;
  git?: Omit<GitOptions, 'cwd'>;
}

// ── [PCODE-46 | S09 | v0.1.0] readVersionInfo: project.json + package.json + git, in one answer ──
export async function readVersionInfo(deps: VersionDeps): Promise<VersionInfo> {
  const io = deps.io ?? defaultIo;
  const git: GitOptions = { cwd: deps.root, ...deps.git };
  const packageVersion = versionFromJson(path.join(deps.root, 'package.json'), io);
  const repo = await isRepo(git);
  const tag = repo ? await lastTag(git) : null;
  const commits = repo ? await logSince(tag, git) : [];
  const changed = repo ? await changedFiles(git) : [];
  const mismatch = mismatches({ version: deps.version, packageVersion, lastTag: tag });
  return {
    version: deps.version,
    packageVersion,
    lastTag: tag,
    commitsSinceTag: commits.length,
    commits,
    isRepo: repo,
    dirty: changed.length > 0,
    changed,
    mismatch,
    next: {
      patch: nextVersion(deps.version, 'patch'),
      minor: nextVersion(deps.version, 'minor'),
      major: nextVersion(deps.version, 'major'),
    },
    canBump: repo && changed.length === 0 && mismatch.length === 0,
  };
}

// ── [PCODE-46 | S09 | v0.1.0] the sentences the panel shows, so the wording is tested, not the markup ──
export function dirtyWarning(info: VersionInfo): string {
  if (!info.isRepo) return 'This folder is not a git repository — the engine cannot commit or tag.';
  if (!info.dirty) return '';
  const n = info.changed.length;
  return `Commit or stash ${String(n)} changed file${n === 1 ? '' : 's'} before bumping.`;
}

export function tagLine(info: VersionInfo): string {
  const tag = info.lastTag ?? 'no tag yet';
  const n = info.commitsSinceTag;
  return `${tag} · ${String(n)} commit${n === 1 ? '' : 's'} since`;
}
