// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-65 | S13 | v0.1.0] Build the multi-project dashboard panel across the Plane workspace ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  "Open folder" can only offer folders this machine has already seen, and Plane cannot know them -
//          a project id says nothing about where the repository sits. So every time a folder is opened or
//          linked, its identifier and path are remembered in globalState (per machine, not in the repo and
//          not synced), and a path that no longer exists is dropped rather than offered.
import * as fs from 'node:fs';

export const FOLDERS_KEY = 'orqiva.projectFolders';

/** The slice of vscode.Memento this module uses; `get` is untyped because the value is validated here. */
export interface MementoLike {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}

export type FolderMap = Record<string, string>;

export function readFolders(memento: MementoLike): FolderMap {
  const raw = memento.get(FOLDERS_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: FolderMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

// ── [PCODE-65 | S13 | v0.1.0] rememberFolder: last one wins; a project may move machines or folders ──
export async function rememberFolder(
  memento: MementoLike,
  identifier: string,
  folder: string,
): Promise<FolderMap> {
  if (!identifier || !folder) return readFolders(memento);
  const map = readFolders(memento);
  if (map[identifier] === folder) return map;
  const next = { ...map, [identifier]: folder };
  await memento.update(FOLDERS_KEY, next);
  return next;
}

// ── [PCODE-65 | S13 | v0.1.0] knownFolders: only paths that still exist are offered ──
export function knownFolders(
  memento: MementoLike,
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): FolderMap {
  const out: FolderMap = {};
  for (const [k, v] of Object.entries(readFolders(memento))) if (exists(v)) out[k] = v;
  return out;
}

/** Drops the folders that have gone, writing back only when something changed. */
export async function pruneFolders(
  memento: MementoLike,
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): Promise<FolderMap> {
  const all = readFolders(memento);
  const live = knownFolders(memento, exists);
  if (Object.keys(all).length !== Object.keys(live).length) await memento.update(FOLDERS_KEY, live);
  return live;
}
