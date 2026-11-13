// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-103 | S15 | v0.1.0] Build the CLI `orq` and the Claude Code hooks against the new server ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Why:  where orq keeps things. The personal token lives in ~/.orqiva/credentials.json, readable by
//          its owner only, never in a repository. A repository is linked to a project by
//          .orqiva/project.json (committed: it says which server, workspace and project). Fast local
//          state for the hooks (the active task, files touched, the offline queue) lives in
//          .orqiva/state/, which is not committed.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface Credentials {
  servers: Record<string, { token: string; email: string }>;
}

export interface ProjectLink {
  server: string;
  workspaceId: string;
  projectId: string;
  projectKey: string;
  projectName: string;
}

export interface LoopRules {
  reviewBeforeDone: boolean;
  autoTestState: boolean;
  unguardedPaths: string[];
  /** [PCODE-247 | S15 | v0.1.0] the agent the task is assigned to, and the files and branches it may touch */
  agent?: { name: string; files: string[]; branches: string[] };
  /** [PCODE-290 | S15 | v0.1.0] the UI kit rule, when the project has a kit */
  kit?: string;
}

/** The local copy of the active task, so hooks answer in milliseconds without the network. */
export interface ActiveTask {
  sessionId: string;
  ref: string;
  taskId: string;
  title: string;
  sprint: string;
  version: string;
  marker: string;
  rules: LoopRules;
  /** the Claude Code session that started or last confirmed it */
  clientSession: string;
  files: string[];
  pending: string[];
  lastProgressAt: number;
  lastCommit: string;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T names the shape of the file
export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeJson(path: string, value: unknown, privateFile = false): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', privateFile ? { mode: 0o600 } : {});
  if (privateFile) chmodSync(path, 0o600);
}

export const credentialsPath = (home: string): string => join(home, '.orqiva', 'credentials.json');

// [PCODE-192 | S15 | v0.1.0] before the rename the token lived in ~/.prodengine; it is copied over once
const LEGACY_DIR = '.prodengine';

export function loadCredentials(home: string): Credentials {
  const now = readJson<Credentials>(credentialsPath(home));
  if (now) return now;
  const before = readJson<Credentials>(join(home, LEGACY_DIR, 'credentials.json'));
  if (before) saveCredentials(home, before);
  return before ?? { servers: {} };
}

export function saveCredentials(home: string, c: Credentials): void {
  writeJson(credentialsPath(home), c, true);
}

/** The repository root: the nearest folder upwards with .orqiva/project.json. */
export function findRoot(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, '.orqiva', 'project.json'))) return dir;
    // [PCODE-192 | S15 | v0.1.0] a repository linked before the rename: its folder moves to the new name once
    if (existsSync(join(dir, LEGACY_DIR, 'project.json')) && !existsSync(join(dir, '.orqiva'))) {
      try {
        renameSync(join(dir, LEGACY_DIR), join(dir, '.orqiva'));
        return dir;
      } catch {
        // in use (an editor holds a file): read the old folder this time
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** [PCODE-192 | S15 | v0.1.0] The repository's own folder: .orqiva, or the old .prodengine while it could not move. */
export const dotDir = (root: string): string =>
  !existsSync(join(root, '.orqiva')) && existsSync(join(root, LEGACY_DIR))
    ? join(root, LEGACY_DIR)
    : join(root, '.orqiva');
export const linkPath = (root: string): string => join(dotDir(root), 'project.json');
export const statePath = (root: string, name: string): string => join(dotDir(root), 'state', name);

export function loadLink(root: string): ProjectLink | null {
  return readJson<ProjectLink>(linkPath(root));
}

export function loadActive(root: string): ActiveTask | null {
  return readJson<ActiveTask>(statePath(root, 'active.json'));
}

export function saveActive(root: string, a: ActiveTask | null): void {
  const p = statePath(root, 'active.json');
  if (a) writeJson(p, a);
  else if (existsSync(p)) writeFileSync(p, 'null\n');
}

/** State is local to one machine: keep it out of the repository. */
export function ensureStateIgnored(root: string): void {
  // [PCODE-105 | S15 | v0.1.0] the folder exists from the link on, so editors can watch it
  mkdirSync(join(dotDir(root), 'state'), { recursive: true });
  const p = join(dotDir(root), '.gitignore');
  if (!existsSync(p)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, 'state/\n');
  }
}
