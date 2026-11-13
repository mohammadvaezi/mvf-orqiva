// ── [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-11 | S02 | v0.1.0] Add the state store with a .plane file watcher and change events ──
// ── [PCODE-35 | S07 | v0.1.0] Add the Docs tree view listing .plane documents with open and preview actions ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  orq, the legacy engine and Claude's hooks write the project's files (.orqiva, or .plane on a
//          legacy folder); the store must notice within a moment.
//          The backend is injectable: VS Code's FileSystemWatcher in the extension host, fs.watch under vitest.
//          This module never writes (criticals #3).
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Disposable {
  dispose(): void;
}

// [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move
/** The project's own files, inside its folder (.orqiva, or .plane on a legacy engine folder). */
export const PROJECT_DOCS = [
  'state/published.json',
  'sprints.md',
  'fingerprints.md',
  'plan.json',
  // [PCODE-35 | S07 | v0.1.0] documents the Docs view lists (existence only; nothing is parsed)
  'rules.md',
  'criticals.md',
  'architecture.md',
  'design-system.md',
  'security.md',
  'description/description.md',
] as const;
export type ProjectDoc = (typeof PROJECT_DOCS)[number];

/** Relative paths (posix, from the project root) the store cares about. */
export const WATCHED_FILES = [
  // the legacy engine's own state
  '.plane/project.json',
  '.plane/state/active.json',
  '.plane/state/queue.jsonl',
  '.plane/state/session.json',
  ...PROJECT_DOCS.map((d) => `.plane/${d}` as const),
  // [PCODE-105 | S15 | v0.1.0] a folder on Orqiva: the orq link and the orq loop's active task
  '.orqiva/project.json',
  '.orqiva/state/active.json',
  ...PROJECT_DOCS.map((d) => `.orqiva/${d}` as const),
] as const;

export type WatchedFile = (typeof WATCHED_FILES)[number];

export type WatchBackend = (root: string, onChange: (relPath: string) => void) => Disposable;

// ── [PCODE-11 | S02 | v0.1.0] nodeBackend: fs.watch on .plane and .plane/state (used by tests and as fallback) ──
export const nodeBackend: WatchBackend = (root, onChange) => {
  const dirs = [
    path.join(root, '.plane'),
    path.join(root, '.plane', 'state'),
    path.join(root, '.plane', 'description'), // [PCODE-35 | S07 | v0.1.0]
    path.join(root, '.orqiva'), // [PCODE-105 | S15 | v0.1.0] the orq link and the orq loop's state
    path.join(root, '.orqiva', 'state'),
    path.join(root, '.orqiva', 'description'), // [PCODE-455 | S15 | v0.1.0]
  ];
  const watchers: fs.FSWatcher[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const w = fs.watch(dir, { persistent: false }, (_event, filename) => {
        if (typeof filename !== 'string') return;
        onChange(path.relative(root, path.join(dir, filename)).replace(/\\/g, '/'));
      });
      w.on('error', () => undefined);
      watchers.push(w);
    } catch {
      /* a missing folder is fine: nothing to watch yet */
    }
  }
  return {
    dispose: () => {
      watchers.forEach((w) => {
        w.close();
      });
    },
  };
};

// ── [PCODE-11 | S02 | v0.1.0] PlaneWatcher: debounced (250 ms) per file; fires only for WATCHED_FILES ──
export class PlaneWatcher implements Disposable {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<(files: WatchedFile[]) => void>();
  private pending = new Set<WatchedFile>();
  private readonly sub: Disposable;

  constructor(
    root: string,
    backend: WatchBackend,
    private readonly debounceMs = 250,
  ) {
    this.sub = backend(root, (rel) => {
      this.notice(rel);
    });
  }

  onDidChange(listener: (files: WatchedFile[]) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private notice(rel: string): void {
    const key = rel.replace(/\\/g, '/');
    if (!(WATCHED_FILES as readonly string[]).includes(key)) return;
    this.pending.add(key as WatchedFile);
    const existing = this.timers.get('flush');
    if (existing) clearTimeout(existing);
    this.timers.set(
      'flush',
      setTimeout(() => {
        const files = [...this.pending];
        this.pending = new Set();
        this.timers.delete('flush');
        for (const l of this.listeners) l(files);
      }, this.debounceMs),
    );
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.listeners.clear();
    this.sub.dispose();
  }
}
