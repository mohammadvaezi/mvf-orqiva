// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-10 | S02 | v0.1.0] Add .plane readers and types for project, active, queue, plan and published ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  tolerant readers for the engine-owned files: missing -> null, malformed -> null + one warning.
//          This module exports NO write function on purpose (criticals #3: engine state is read-only).
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ActiveTask,
  PlanJson,
  ProjectLink,
  PublishedState,
  QueueEntry,
  SessionInfo,
} from './types';

export type Warn = (message: string) => void;

export interface ReadFs {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, enc: 'utf8') => string;
}

const defaultFs: ReadFs = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
};

// ── [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move ──
//    The project's files live in .orqiva on a folder linked to an Orqiva server and in .plane on a folder
//    of the legacy engine, which reads that folder itself. Every path below goes through projectDir.
export const ORQIVA_DIR = '.orqiva';
export const LEGACY_DIR = '.plane';

/** The folder of the project's files: .orqiva when the folder is linked to Orqiva, else the legacy .plane. */
export function projectDir(root: string, io: Pick<ReadFs, 'existsSync'> = defaultFs): string {
  return io.existsSync(path.join(root, ORQIVA_DIR, 'project.json')) ? ORQIVA_DIR : LEGACY_DIR;
}

/** A file in the project's folder, as an absolute path. */
export function projectFile(
  root: string,
  parts: readonly string[],
  io: Pick<ReadFs, 'existsSync'> = defaultFs,
): string {
  return path.join(root, projectDir(root, io), ...parts);
}

/** A file in the project's folder, relative to the root with forward slashes: for prompts and messages. */
export function projectRel(
  root: string,
  parts: readonly string[],
  io: Pick<ReadFs, 'existsSync'> = defaultFs,
): string {
  return [projectDir(root, io), ...parts].join('/');
}

/** The project's files, inside the project's folder. */
export const PLANE_FILES = {
  project: ['project.json'],
  active: ['state', 'active.json'],
  queue: ['state', 'queue.jsonl'],
  session: ['state', 'session.json'],
  published: ['state', 'published.json'],
  plan: ['plan.json'],
  sprintsMd: ['sprints.md'],
  fingerprintsMd: ['fingerprints.md'],
  rules: ['rules.md'],
  criticals: ['criticals.md'],
  architecture: ['architecture.md'],
  designSystem: ['design-system.md'],
  security: ['security.md'],
} as const;

export type PlaneFileKey = keyof typeof PLANE_FILES;

export function planePath(
  root: string,
  key: PlaneFileKey,
  io: Pick<ReadFs, 'existsSync'> = defaultFs,
): string {
  return projectFile(root, PLANE_FILES[key], io);
}

// ── [PCODE-10 | S02 | v0.1.0] readJson: the one tolerant JSON reader every typed reader uses ──
function readJson<T>(
  file: string,
  validate: (v: unknown) => v is T,
  warn: Warn,
  io: ReadFs,
): T | null {
  if (!io.existsSync(file)) return null;
  let text: string;
  try {
    text = io.readFileSync(file, 'utf8');
  } catch (e) {
    warn(`Cannot read ${file}: ${String(e)}`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    warn(`Malformed JSON in ${file}: ${String(e)}`);
    return null;
  }
  if (!validate(parsed)) {
    warn(`Unexpected shape in ${file}`);
    return null;
  }
  return parsed;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (o: Record<string, unknown>, k: string): boolean => typeof o[k] === 'string';

export const isProjectLink = (v: unknown): v is ProjectLink =>
  isObj(v) && str(v, 'project_id') && str(v, 'identifier') && str(v, 'name');
export const isActiveTask = (v: unknown): v is ActiveTask =>
  isObj(v) && str(v, 'task') && str(v, 'issue_id') && str(v, 'title') && Array.isArray(v['files']);
export const isPublishedState = (v: unknown): v is PublishedState => isObj(v) && isObj(v['items']);
export const isSessionInfo = (v: unknown): v is SessionInfo => isObj(v) && str(v, 'session_id');
export const isPlanJson = (v: unknown): v is PlanJson => isObj(v) && Array.isArray(v['sprints']);

// ── [PCODE-105 | S15 | v0.1.0] the orq files: a folder linked with `orq link` is on Orqiva ──
export const PE_LINK = ['.orqiva', 'project.json'] as const;
export const PE_ACTIVE = ['.orqiva', 'state', 'active.json'] as const;

interface PeLink {
  server: string;
  workspaceId: string;
  projectId: string;
  projectKey: string;
  projectName: string;
}
const isPeLink = (v: unknown): v is PeLink =>
  isObj(v) &&
  str(v, 'server') &&
  str(v, 'projectId') &&
  str(v, 'projectKey') &&
  str(v, 'workspaceId');

interface PeActive {
  sessionId: string;
  ref: string;
  taskId: string;
  title: string;
  sprint: string;
  version: string;
  files: string[];
  lastCommit?: string;
}
const isPeActive = (v: unknown): v is PeActive | null =>
  v === null || (isObj(v) && str(v, 'ref') && str(v, 'taskId') && Array.isArray(v['files']));

/** The orq link in the shape the extension reads everywhere; `server` marks it as Orqiva. */
export function linkFromPe(pe: PeLink): ProjectLink {
  return {
    workspace: pe.workspaceId,
    project_id: pe.projectId,
    identifier: pe.projectKey,
    name: pe.projectName,
    version: '0.1.0',
    server: pe.server,
  };
}

export function activeFromPe(pe: PeActive, server: string): ActiveTask {
  return {
    task: pe.ref,
    issue_id: pe.taskId,
    title: pe.title,
    sprint: pe.sprint,
    sprint_name: pe.sprint,
    version: pe.version,
    session_id: pe.sessionId,
    host: '',
    started_at: '',
    files: pe.files,
    url: server.replace(/\/$/, '') + '/items/' + pe.taskId,
    ...(pe.lastCommit ? { last_commit: pe.lastCommit } : {}),
  };
}

// ── [PCODE-10 | S02 | v0.1.0] typed readers (read-only) ──
export function readProjectLink(
  root: string,
  warn: Warn = noop,
  io: ReadFs = defaultFs,
): ProjectLink | null {
  // [PCODE-105 | S15 | v0.1.0] linked to Orqiva wins over a leftover Plane link
  const pe = readJson(path.join(root, ...PE_LINK), isPeLink, warn, io);
  if (pe) return linkFromPe(pe);
  return readJson(planePath(root, 'project', io), isProjectLink, warn, io);
}

export function readActiveTask(
  root: string,
  warn: Warn = noop,
  io: ReadFs = defaultFs,
): ActiveTask | null {
  // [PCODE-105 | S15 | v0.1.0] on Orqiva the active task is the orq loop's
  const pe = readJson(path.join(root, ...PE_LINK), isPeLink, warn, io);
  if (pe) {
    const a = readJson(path.join(root, ...PE_ACTIVE), isPeActive, warn, io);
    return a ? activeFromPe(a, pe.server) : null;
  }
  return readJson(planePath(root, 'active', io), isActiveTask, warn, io);
}

export function readPublished(
  root: string,
  warn: Warn = noop,
  io: ReadFs = defaultFs,
): PublishedState | null {
  return readJson(planePath(root, 'published', io), isPublishedState, warn, io);
}

export function readSession(
  root: string,
  warn: Warn = noop,
  io: ReadFs = defaultFs,
): SessionInfo | null {
  return readJson(planePath(root, 'session', io), isSessionInfo, warn, io);
}

export function readPlan(root: string, warn: Warn = noop, io: ReadFs = defaultFs): PlanJson | null {
  return readJson(planePath(root, 'plan', io), isPlanJson, warn, io);
}

/** Pending Plane writes: one entry per non-empty line; a bad line is skipped with a warning. */
export function readQueue(root: string, warn: Warn = noop, io: ReadFs = defaultFs): QueueEntry[] {
  const file = planePath(root, 'queue', io);
  if (!io.existsSync(file)) return [];
  const out: QueueEntry[] = [];
  for (const line of io.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as unknown;
      if (isObj(e) && str(e, 'id') && str(e, 'method') && str(e, 'path'))
        out.push(e as unknown as QueueEntry);
      else warn(`Skipped queue entry without id/method/path in ${file}`);
    } catch {
      warn(`Skipped malformed queue line in ${file}`);
    }
  }
  return out;
}

export function queueLength(root: string, io: ReadFs = defaultFs): number {
  const file = planePath(root, 'queue', io);
  if (!io.existsSync(file)) return 0;
  return io
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim()).length;
}

/** Markdown documents: the text or null when absent. */
export function readText(root: string, key: PlaneFileKey, io: ReadFs = defaultFs): string | null {
  const file = planePath(root, key, io);
  return io.existsSync(file) ? io.readFileSync(file, 'utf8') : null;
}

function noop(): void {
  /* warnings are optional */
}
