// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-10 | S02 | v0.1.0] Add .plane readers and types for project, active, queue, plan and published ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Why:  the same rule as plane_common.find_project - walk up to the nearest .plane/project.json (or the
//          legacy .plane.json) and skip fixtures - so the extension and the engine agree on the root.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PE_LINK, linkFromPe } from './files';
import type { ProjectLink } from './types';

const isPeLinkJson = (v: unknown): v is Parameters<typeof linkFromPe>[0] =>
  typeof v === 'object' && v !== null && 'server' in v && 'projectKey' in v && 'projectId' in v;

export interface FoundProject {
  root: string;
  link: ProjectLink;
}

export interface ProjectFs {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, enc: 'utf8') => string;
  /** [PCODE-61 | S12 | v0.1.0] the path as the file system spells it; optional, so tests need not supply it */
  realpath?: (p: string) => string;
}

const defaultFs: ProjectFs = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  realpath: (p) => fs.realpathSync.native(p),
};

// ── [PCODE-61 | S12 | v0.1.0] canonical: the root is kept the way the file system spells it ──
//    A folder opened through an 8.3 short name (C:\Users\ADMINI~1\…, which is what a script passing %TEMP%
//    hands over) is the same folder under a second spelling, while everything the store later compares it
//    with - watcher events, document uris, fingerprint paths - arrives in the long one. Resolving once here
//    keeps them equal. A failure (path gone, platform without the call) leaves the input as it was.
function canonical(folder: string, io: ProjectFs): string {
  try {
    return io.realpath ? io.realpath(folder) : folder;
  } catch {
    return folder;
  }
}

export const PLANE_DIR = '.plane';
const LEGACY_LINK = '.plane.json';

// ── [PCODE-10 | S02 | v0.1.0] findProjectFrom: one start folder, walking up ──
export function findProjectFrom(start: string, io: ProjectFs = defaultFs): FoundProject | null {
  let folder = path.resolve(start);
  let depth = 0;
  for (;;) {
    for (const candidate of [
      // [PCODE-105 | S15 | v0.1.0] a folder linked with `orq link` is on Orqiva; it wins over Plane
      path.join(folder, ...PE_LINK),
      path.join(folder, PLANE_DIR, 'project.json'),
      path.join(folder, LEGACY_LINK),
    ]) {
      if (!io.existsSync(candidate)) continue;
      let link: ProjectLink;
      try {
        const raw = JSON.parse(io.readFileSync(candidate, 'utf8')) as unknown;
        link = isPeLinkJson(raw) ? linkFromPe(raw) : (raw as ProjectLink);
      } catch {
        return null;
      }
      if (link.fixture && depth > 0) break; // test data met while walking up: keep going (opened directly = intended)
      if (typeof link.project_id !== 'string' || typeof link.identifier !== 'string') return null;
      return { root: canonical(folder, io), link };
    }
    const parent = path.dirname(folder);
    if (parent === folder) return null;
    folder = parent;
    depth += 1;
  }
}

// ── [PCODE-10 | S02 | v0.1.0] findProject: first workspace folder that resolves; subfolders resolve up ──
export function findProject(
  folders: readonly string[],
  io: ProjectFs = defaultFs,
): FoundProject | null {
  for (const f of folders) {
    const found = findProjectFrom(f, io);
    if (found) return found;
  }
  return null;
}
