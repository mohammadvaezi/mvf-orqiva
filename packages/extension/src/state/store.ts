// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-11 | S02 | v0.1.0] Add the state store with a .plane file watcher and change events ──
// ── [PCODE-13 | S03 | v0.1.0] Add the Orqiva activity bar container and the Sprints tree view ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the single in-memory picture of the project (architecture.md BoardState). Loads from files on
//          activation with no network; re-reads what the watcher reports; consumers subscribe and never
//          read files themselves. Writes nothing (criticals #3).
import * as files from './files';
import { boardFromSprintsMd, todayIso, type Sprint } from './board';
import { parseSprintsMd } from './sprintsMd';
import type { ActiveTask, PlanJson, ProjectLink, PublishedState } from './types';
import {
  PlaneWatcher,
  PROJECT_DOCS,
  type Disposable,
  type ProjectDoc,
  type WatchBackend,
  type WatchedFile,
} from './watcher';

export type StoreKey =
  | 'link'
  | 'active'
  | 'queueLength'
  | 'sprints'
  | 'published'
  | 'plan'
  | 'fingerprints'
  | 'online'
  | 'docs'; // [PCODE-35 | S07 | v0.1.0] a listed document appeared or vanished

export interface BoardState {
  root: string | null;
  link: ProjectLink | null;
  active: ActiveTask | null;
  queueLength: number;
  /** The board: from the server (Orqiva live, or Plane on demand), else from sprints.md (source per sprint). */
  sprints: Sprint[];
  published: PublishedState | null;
  plan: PlanJson | null;
  fingerprintsMd: string | null;
  online: boolean;
  lastRefresh: Date | null;
  lastError: string | null;
}

const DOC_KEYS: Record<ProjectDoc, StoreKey[]> = {
  'state/published.json': ['published'],
  'sprints.md': ['sprints'],
  'fingerprints.md': ['fingerprints'],
  'plan.json': ['plan'],
  // [PCODE-35 | S07 | v0.1.0] documents: existence matters, content is read by the editor
  'rules.md': ['docs'],
  'criticals.md': ['docs'],
  'architecture.md': ['docs'],
  'design-system.md': ['docs'],
  'security.md': ['docs'],
  'description/description.md': ['docs'],
};

// [PCODE-455 | S15 | v0.1.0] the project's files are read from .orqiva or .plane, whichever the folder uses
function docsIn<P extends string>(dir: P): Record<`${P}/${ProjectDoc}`, StoreKey[]> {
  return Object.fromEntries(PROJECT_DOCS.map((d) => [dir + '/' + d, DOC_KEYS[d]])) as Record<
    `${P}/${ProjectDoc}`,
    StoreKey[]
  >;
}

const FILE_TO_KEYS: Record<WatchedFile, StoreKey[]> = {
  '.plane/project.json': ['link'],
  '.plane/state/active.json': ['active'],
  '.plane/state/queue.jsonl': ['queueLength'],
  '.plane/state/session.json': [],
  ...docsIn('.plane'),
  // [PCODE-105 | S15 | v0.1.0] the same keys, read from the orq files when the folder is on Orqiva
  // [PCODE-455 | S15 | v0.1.0] a new link moves every file to .orqiva: all of them are read again
  '.orqiva/project.json': [
    'link',
    'active',
    'published',
    'plan',
    'sprints',
    'fingerprints',
    'docs',
  ],
  '.orqiva/state/active.json': ['active'],
  ...docsIn('.orqiva'),
};

// ── [PCODE-11 | S02 | v0.1.0] Store: load() from files, watch() for changes, onDidChange(keys) ──
export class Store implements Disposable {
  readonly state: BoardState = {
    root: null,
    link: null,
    active: null,
    queueLength: 0,
    sprints: [],
    published: null,
    plan: null,
    fingerprintsMd: null,
    online: false,
    lastRefresh: null,
    lastError: null,
  };
  private readonly listeners = new Set<(keys: StoreKey[]) => void>();
  private watcher: PlaneWatcher | null = null;

  constructor(private readonly warn: (m: string) => void = () => undefined) {}

  onDidChange(listener: (keys: StoreKey[]) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  /** Read every file once. No network. Returns the keys that were populated. */
  load(root: string | null): StoreKey[] {
    this.state.root = root;
    if (!root) {
      this.state.link = null;
      this.state.active = null;
      this.state.queueLength = 0;
      this.state.sprints = [];
      this.state.published = null;
      this.state.plan = null;
      this.state.fingerprintsMd = null;
      const keys: StoreKey[] = [
        'link',
        'active',
        'queueLength',
        'sprints',
        'published',
        'plan',
        'fingerprints',
      ];
      this.emit(keys);
      return keys;
    }
    const keys = this.reread(root, [...(Object.keys(FILE_TO_KEYS) as WatchedFile[])]);
    this.emit(keys);
    return keys;
  }

  /** Start watching `root`; each change re-reads only the affected file(s). */
  watch(backend: WatchBackend, debounceMs = 250): void {
    this.watcher?.dispose();
    const root = this.state.root;
    if (!root) return;
    this.watcher = new PlaneWatcher(root, backend, debounceMs);
    this.watcher.onDidChange((changed) => {
      const keys = this.reread(root, changed);
      if (keys.length) this.emit(keys);
    });
  }

  // ── [PCODE-13 | S03 | v0.1.0] applyBoard: the board source hands in the server's board; it wins over the file ──
  applyBoard(sprints: Sprint[]): void {
    this.state.sprints = sprints;
    this.emit(['sprints']);
  }

  setOnline(online: boolean, error: string | null = null): void {
    this.state.online = online;
    this.state.lastError = error;
    if (online) this.state.lastRefresh = new Date();
    this.emit(['online']);
  }

  // ── [PCODE-11 | S02 | v0.1.0] reread: one file -> its keys; tolerant readers, warnings to the log ──
  private reread(root: string, changed: readonly WatchedFile[]): StoreKey[] {
    const keys = new Set<StoreKey>();
    for (const file of changed) {
      for (const key of FILE_TO_KEYS[file]) {
        switch (key) {
          case 'link':
            this.state.link = files.readProjectLink(root, this.warn);
            break;
          case 'active':
            this.state.active = files.readActiveTask(root, this.warn);
            break;
          case 'queueLength':
            this.state.queueLength = files.queueLength(root);
            break;
          case 'published':
            this.state.published = files.readPublished(root, this.warn);
            break;
          case 'plan':
            this.state.plan = files.readPlan(root, this.warn);
            break;
          case 'sprints': {
            // [PCODE-105 | S15 | v0.1.0] a board from a server (Plane or Orqiva) wins over the file
            const md = files.readText(root, 'sprintsMd');
            if (md && !this.state.sprints.some((x) => x.source !== 'file'))
              this.state.sprints = boardFromSprintsMd(parseSprintsMd(md), todayIso());
            else if (!md && !this.state.sprints.some((x) => x.source !== 'file'))
              this.state.sprints = [];
            break;
          }
          case 'fingerprints':
            this.state.fingerprintsMd = files.readText(root, 'fingerprintsMd');
            break;
          case 'online':
          case 'docs':
            break;
        }
        keys.add(key);
      }
    }
    return [...keys];
  }

  private emit(keys: StoreKey[]): void {
    for (const l of this.listeners) l(keys);
  }

  dispose(): void {
    this.watcher?.dispose();
    this.watcher = null;
    this.listeners.clear();
  }
}
