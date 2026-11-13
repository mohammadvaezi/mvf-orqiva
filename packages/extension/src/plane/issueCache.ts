// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
// ── [PCODE-36 | S07 | v0.1.0] Add a fingerprint CodeLens provider showing task title and state above markers ──
// ── [PCODE-39 | S07 | v0.1.0] Refresh docs tree, CodeLens and task panel on .plane file changes ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  lenses need a title and a state for every ref in the open file. The board in the store answers
//          most of them for free; only refs outside it (old sprints, other projects) go to Plane, at most one
//          request per ref per ten minutes, batched per tick, and never while offline or without a key.
import type { PlaneClient } from './client';
import type { Store } from '../state/store';
import { groupOf, type StateGroup } from '../state/board';

export interface IssueInfo {
  ref: string;
  title: string;
  state: { name: string; group: StateGroup };
  url?: string;
}

export type CacheEntry =
  | { kind: 'known'; info: IssueInfo }
  | { kind: 'missing' }
  | { kind: 'offline' }
  | { kind: 'pending' };

export const TTL_MS = 10 * 60 * 1000;

export interface IssueCacheDeps {
  store: Store;
  client: Pick<PlaneClient, 'getIssue' | 'getStates' | 'webUrl'>;
  hasApiKey: () => Promise<boolean>;
  now?: () => number;
  /** how long fetches wait to be batched with others (ms) */
  batchMs?: number;
}

// ── [PCODE-36 | S07 | v0.1.0] IssueCache: store first, then Plane once per ref per TTL; emits when something arrives ──
export class IssueCache {
  private readonly fetched = new Map<string, { at: number; entry: CacheEntry }>();
  private queue = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private states: Map<string, { name: string; group: StateGroup }> | null = null;
  private readonly listeners = new Set<() => void>();
  requests = 0;

  constructor(private readonly deps: IssueCacheDeps) {}

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  /** the store's board answers without a request */
  fromStore(ref: string): IssueInfo | null {
    // [PCODE-39 | S07 | v0.1.0] the active task (active.json) is In Progress, whatever the last sync said
    const active = this.deps.store.state.active;
    if (active?.task === ref)
      return {
        ref,
        title: active.title,
        state: { name: 'In Progress', group: 'started' },
        ...(active.url ? { url: active.url } : {}),
      };
    for (const s of this.deps.store.state.sprints)
      for (const i of s.items)
        if (i.ref === ref)
          return { ref, title: i.title, state: i.state, ...(i.url ? { url: i.url } : {}) };
    return null;
  }

  /** synchronous answer; schedules a fetch when nothing is known */
  get(ref: string): CacheEntry {
    const known = this.fromStore(ref);
    if (known) return { kind: 'known', info: known };
    const hit = this.fetched.get(ref);
    const now = (this.deps.now ?? Date.now)();
    if (hit && now - hit.at < TTL_MS) return hit.entry;
    this.schedule(ref);
    return hit?.entry ?? { kind: 'pending' };
  }

  private schedule(ref: string): void {
    if (this.queue.has(ref)) return;
    this.queue.add(ref);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.deps.batchMs ?? 50);
  }

  // ── [PCODE-36 | S07 | v0.1.0] flush: one pass over the queued refs; offline/no key marks them 'offline' ──
  async flush(): Promise<void> {
    const refs = [...this.queue];
    this.queue = new Set();
    if (!refs.length) return;
    const now = (this.deps.now ?? Date.now)();
    const link = this.deps.store.state.link;
    const online = this.deps.store.state.online || this.deps.store.state.lastRefresh === null;
    // [PCODE-193 | S15 | v0.1.0] a folder on Orqiva: the live board has every task of the project, so a ref it does not
    // know is not one of this project; Plane is never asked
    if (link?.server) {
      for (const r of refs) this.fetched.set(r, { at: now, entry: { kind: 'missing' } });
      this.emit();
      return;
    }
    if (!link || !online || !(await this.deps.hasApiKey())) {
      for (const r of refs) this.fetched.set(r, { at: now, entry: { kind: 'offline' } });
      this.emit();
      return;
    }
    if (!this.states) {
      try {
        this.requests++;
        this.states = new Map(
          (await this.deps.client.getStates(link.project_id)).map((s) => [
            s.id,
            { name: s.name, group: (s.group || groupOf(s.name)) as StateGroup },
          ]),
        );
      } catch {
        this.states = new Map();
      }
    }
    await Promise.all(
      refs.map(async (ref) => {
        try {
          this.requests++;
          const issue = await this.deps.client.getIssue(link.project_id, ref);
          const state: { name: string; group: StateGroup } = this.states?.get(issue.state) ?? {
            name: 'Unknown',
            group: 'backlog',
          };
          this.fetched.set(ref, {
            at: now,
            entry: {
              kind: 'known',
              info: {
                ref,
                title: issue.name,
                state,
                url: this.deps.client.webUrl(link.project_id, issue.id),
              },
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.fetched.set(ref, {
            at: now,
            entry: /\(404\)|not found/i.test(msg) ? { kind: 'missing' } : { kind: 'offline' },
          });
        }
      }),
    );
    this.emit();
  }

  /** forget fetched answers (state moved, reconnect) */
  invalidate(): void {
    this.fetched.clear();
    this.states = null;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
