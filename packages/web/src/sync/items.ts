// ── [PCODE-260 | S15 | v0.1.0] T27.2 Interactive Gantt: drag, resize, link, shift-drag, split, zoom, colour rules, outline levels ──
// ── [PCODE-257 | S15 | v0.1.0] T26.6 Hierarchy: initiatives, custom item types, custom fields ──
// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
// ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
// ── [PCODE-250 | S15 | v0.1.0] T25.5 Profiles, GDPR export and erasure, version check on task edits ──
// ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-166 | S15 | v0.1.0] B2.2 Planning live in the web app: sprint header, board, backlog, Planner draft, capacity, reports, retro ──
// ── [PCODE-96 | S15 | v0.1.0] Build our own local-first sync for items: client cache, optimistic writes, reconnect ──
//    Why:  lists feel instant because the screen never waits for the server. The store keeps the server's
//          copy of every item and, on top of it, the person's own edits that the server has not confirmed
//          yet. The screen shows both combined. Each edit is sent at once; when the server confirms, its copy
//          replaces ours; when it refuses, the edit is dropped and the person told why; when the network is
//          gone, edits wait in a queue (kept in browser storage, so a reload keeps them) and go out, in order,
//          on reconnect.
//
//    [PCODE-250 | S15 | v0.1.0] Text is the exception: an edit of the title or the description carries the version it was
//    made on, and the server refuses it when someone else changed the task since; the task is reloaded and the
//    person told, so nobody overwrites words they never saw. My own queued edits move up with each version
//    my earlier edits make, so they never conflict with themselves.
//
//    Conflict rule, per field: the last write the server accepts wins. While an edit of mine is pending, my
//    value for that field stays on screen even if someone else's change arrives meanwhile; my edit reaches
//    the server after theirs, so it is the last write and the screen and the server agree once it lands.
//    Fields I did not touch always show the server's latest value. If my edit is refused (the item was
//    deleted, the state no longer exists), it is rolled back and the server's value shows again.
import type { ActivityEvent } from '@orqiva/shared';
import { api, type ApiError } from '../core/api.js';

export interface Item {
  id: string;
  ref: string;
  projectId: string;
  sequence: number;
  title: string;
  description: string;
  stateId: string;
  assigneeId: string | null;
  estimate: number | null;
  parentId: string | null;
  labelIds: string[];
  sprintId: string | null;
  rank: number;
  version: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  // [PCODE-166 | S15 | v0.1.0] the plan fields (absent in a queue saved before they existed)
  kind?: string;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  durationDays?: number | null;
  percentDone?: number | null;
  ready?: boolean;
  carriedCount?: number;
  scheduleMode?: string;
  agentId?: string | null; // [PCODE-246 | S15 | v0.1.0] the agent the task is assigned to
  // [PCODE-254 | S15 | v0.1.0] the definitions ticked off, and whether it waits in triage
  checks?: { ready: string[]; done: string[] };
  triage?: boolean;
  // [PCODE-257 | S15 | v0.1.0] the project's own type and fields
  typeId?: string | null;
  custom?: Record<string, unknown>;
  // [PCODE-260 | S15 | v0.1.0] the constraint and the pauses
  constraintType?: string;
  constraintDate?: string | null;
  splits?: { after: number; gap: number }[];
}

// [PCODE-99 | S15 | v0.1.0] planning fields: sprint and rank
export type ItemFields = Partial<
  Pick<
    Item,
    | 'title'
    | 'description'
    | 'stateId'
    | 'assigneeId'
    | 'estimate'
    | 'parentId'
    | 'labelIds'
    | 'sprintId'
    | 'rank'
    // [PCODE-166 | S15 | v0.1.0]
    | 'kind'
    | 'priority'
    | 'startDate'
    | 'dueDate'
    | 'durationDays'
    | 'percentDone'
    | 'ready'
    | 'scheduleMode'
    | 'agentId'
    | 'typeId'
    | 'custom'
    | 'constraintType'
    | 'constraintDate'
    | 'splits'
  >
>;

/** [PCODE-250 | S15 | v0.1.0] the fields whose edits are checked against the version they were made on */
const TEXT_FIELDS = ['title', 'description'] as const;

interface PendingEdit {
  opId: string;
  itemId: string;
  fields: ItemFields;
  /** [PCODE-250 | S15 | v0.1.0] the server's version of the item when the edit was made */
  seen?: number;
  /** a create keeps its local placeholder id until the server answers */
  create?: { projectId: string; title: string };
}

/** Where the queue survives a reload; browser storage, or nothing in tests. */
export interface QueueStorage {
  load(key: string): string | null;
  save(key: string, value: string): void;
}

export interface ItemStoreOptions {
  workspaceId: string;
  fetchImpl?: typeof fetch;
  storage?: QueueStorage;
  /** told when an edit is refused and rolled back */
  onRejected?: (error: ApiError, edit: { itemId: string; fields: ItemFields }) => void;
}

let opCounter = 0;
const nextOpId = (): string => 'op-' + String(Date.now()) + '-' + String(++opCounter);

export class ItemStore {
  /** the server's copies */
  private readonly base = new Map<string, Item>();
  private pending: PendingEdit[] = [];
  private sending: Promise<void> | null = null;
  /** [PCODE-255 | S15 | v0.1.0] the last edits, each with the values it replaced, newest last */
  private undoStack: { itemIds: string[]; before: Map<string, ItemFields>; at: number }[] = [];
  private online = true;
  private readonly listeners = new Set<() => void>();
  private readonly fetchImpl: typeof fetch;
  private readonly key: string;
  /** bumps on every change, so screens can tell they need to redraw */
  revision = 0;

  constructor(private readonly opts: ItemStoreOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.key = 'pe-pending-' + opts.workspaceId;
    const saved = opts.storage?.load(this.key);
    if (saved) {
      try {
        this.pending = JSON.parse(saved) as PendingEdit[];
      } catch {
        this.pending = [];
      }
    }
  }

  private path(p: string): string {
    return '/api/workspaces/' + this.opts.workspaceId + p;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.revision++;
    this.opts.storage?.save(this.key, JSON.stringify(this.pending));
    for (const l of this.listeners) l();
  }

  /** What the screen shows: the server's copy with my unconfirmed edits on top. */
  item(id: string): Item | undefined {
    let it = this.base.get(id);
    for (const p of this.pending) {
      if (p.itemId !== id) continue;
      if (p.create && !it) {
        it = {
          id,
          ref: '…',
          projectId: p.create.projectId,
          sequence: 0,
          title: p.create.title,
          description: '',
          stateId: '',
          assigneeId: null,
          estimate: null,
          parentId: null,
          labelIds: [],
          sprintId: null,
          rank: Number.MAX_SAFE_INTEGER,
          version: 0,
          commentCount: 0,
          createdAt: '',
          updatedAt: '',
        };
      }
      if (it) it = { ...it, ...p.fields };
    }
    return it;
  }

  /** The items of a project as the screen shows them, by number (new local ones last). */
  items(projectId: string): Item[] {
    const ids = new Set([...this.base.keys(), ...this.pending.map((p) => p.itemId)]);
    return [...ids]
      .map((id) => this.item(id))
      .filter((it): it is Item => it !== undefined && it.projectId === projectId)
      .sort(
        (a, b) => (a.sequence || Number.MAX_SAFE_INTEGER) - (b.sequence || Number.MAX_SAFE_INTEGER),
      );
  }

  /** true while an edit of this item waits for the server */
  isPending(id: string): boolean {
    return this.pending.some((p) => p.itemId === id);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  async loadProject(projectId: string): Promise<ApiError | null> {
    const r = await api<Item[]>(
      'GET',
      this.path('/projects/' + projectId + '/items'),
      undefined,
      this.fetchImpl,
    );
    if (!r.ok) return r.error;
    for (const id of [...this.base.keys()])
      if (this.base.get(id)?.projectId === projectId) this.base.delete(id);
    for (const it of r.data) this.base.set(it.id, it);
    this.changed();
    return null;
  }

  /**
   * [PCODE-255 | S15 | v0.1.0] Remembers what a change replaces, so it can be undone: one entry per edit, or one for a bulk
   * edit whose earlier values the server gave.
   */
  remember(before: Map<string, ItemFields>): void {
    if (!before.size) return;
    this.undoStack.push({ itemIds: [...before.keys()], before, at: Date.now() });
    if (this.undoStack.length > 20) this.undoStack.shift();
  }

  /** [PCODE-255 | S15 | v0.1.0] Whether there is something to undo from the last `withinMs`. */
  canUndo(withinMs = 60_000): boolean {
    const last = this.undoStack.at(-1);
    return Boolean(last && Date.now() - last.at <= withinMs);
  }

  /** [PCODE-255 | S15 | v0.1.0] Puts the last edit back; answers how many tasks it touched. */
  undo(): number {
    const last = this.undoStack.pop();
    if (!last) return 0;
    for (const [id, fields] of last.before) this.update(id, fields, false);
    return last.before.size;
  }

  /** Changes an item on screen now and sends the change. */
  update(itemId: string, fields: ItemFields, remember = true): void {
    // [PCODE-255 | S15 | v0.1.0] what this edit replaces, for undo
    const now = this.item(itemId);
    if (remember && now)
      this.remember(
        new Map([
          [
            itemId,
            Object.fromEntries(
              Object.keys(fields).map((k) => [
                k,
                (now as unknown as Record<string, unknown>)[k] ?? null,
              ]),
            ),
          ],
        ]),
      );
    const seen = this.base.get(itemId)?.version;
    this.pending.push({
      opId: nextOpId(),
      itemId,
      fields,
      ...(seen !== undefined ? { seen } : {}),
    });
    this.changed();
    void this.flush();
  }

  /** Shows a new item at once (with a placeholder id) and creates it on the server. */
  create(projectId: string, title: string, fields: ItemFields = {}): string {
    const localId = 'local-' + nextOpId();
    this.pending.push({
      opId: nextOpId(),
      itemId: localId,
      fields: { title, ...fields },
      create: { projectId, title },
    });
    this.changed();
    void this.flush();
    return localId;
  }

  /** Network state from the live connection: going online sends what waited. */
  setOnline(online: boolean): void {
    this.online = online;
    if (online) void this.flush();
  }

  /** Sends pending edits one at a time, oldest first; stops at the first network failure. */
  flush(): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = (async () => {
      while (this.online && this.pending.length) {
        const edit = this.pending[0];
        if (!edit) break;
        const r = edit.create
          ? await api<Item>(
              'POST',
              this.path('/projects/' + edit.create.projectId + '/items'),
              edit.fields,
              this.fetchImpl,
            )
          : await api<Item>(
              'PATCH',
              this.path('/items/' + edit.itemId),
              // [PCODE-250 | S15 | v0.1.0] text edits say which version they were made on
              edit.seen !== undefined && TEXT_FIELDS.some((f) => f in edit.fields)
                ? { ...edit.fields, version: edit.seen }
                : edit.fields,
              this.fetchImpl,
            );
        if (!r.ok && r.error.status === 0) {
          // the network is gone: keep the edit, try again when the connection is back
          this.online = false;
          break;
        }
        this.pending.shift();
        if (r.ok) {
          this.base.set(r.data.id, this.newer(r.data));
          if (edit.create) this.renameLocal(edit.itemId, r.data.id);
          // [PCODE-250 | S15 | v0.1.0] my next edits of this item were made on what this one produced
          else
            for (const p of this.pending)
              if (p.itemId === edit.itemId && p.seen === edit.seen) p.seen = r.data.version;
        } else {
          this.opts.onRejected?.(r.error, { itemId: edit.itemId, fields: edit.fields });
          // [PCODE-250 | S15 | v0.1.0] someone else changed it meanwhile: show theirs
          if (r.error.status === 409 && !edit.create) {
            const fresh = await api<Item>(
              'GET',
              this.path('/items/' + edit.itemId),
              undefined,
              this.fetchImpl,
            );
            if (fresh.ok) this.base.set(fresh.data.id, fresh.data);
          }
          // edits of a create that never happened cannot happen either
          if (edit.create) this.pending = this.pending.filter((p) => p.itemId !== edit.itemId);
        }
        this.changed();
      }
    })().finally(() => {
      this.sending = null;
    });
    return this.sending;
  }

  /** Later edits made on a placeholder now belong to the real item. */
  private renameLocal(localId: string, realId: string): void {
    for (const p of this.pending) if (p.itemId === localId) p.itemId = realId;
  }

  /** Of two copies of one item, the one with the higher version. */
  private newer(incoming: Item): Item {
    const have = this.base.get(incoming.id);
    return have && have.version > incoming.version ? have : incoming;
  }

  /** An event from the live connection: bring the server's copy of that item up to date. */
  async applyEvent(event: ActivityEvent): Promise<void> {
    const obj = event.data.object;
    if (obj.type !== 'item' && !(obj.type === 'comment' && event.data.parent?.type === 'item'))
      return;
    const itemId = obj.type === 'item' ? obj.id : (event.data.parent?.id ?? '');
    if (obj.type === 'item' && event.data.verb === 'deleted') {
      if (this.base.delete(itemId)) this.changed();
      return;
    }
    const r = await api<Item>('GET', this.path('/items/' + itemId), undefined, this.fetchImpl);
    if (r.ok) {
      this.base.set(r.data.id, this.newer(r.data));
      this.changed();
    } else if (r.error.status === 404 && this.base.delete(itemId)) this.changed();
  }
}
