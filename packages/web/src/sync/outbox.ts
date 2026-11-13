// ── [PCODE-354 | S15 | v0.1.0] T35.4b Offline beyond tasks: comments, messages and time written offline; reads kept for offline ──
//    Why:  tasks already work offline; comments, messages and hours do now too. A write that cannot reach
//          the server waits here, in this browser, in order, and goes out when the connection is back; one
//          the server refuses is dropped and named, so nothing is lost without a word.
import { api, type ApiResult } from '../core/api.js';

export interface Queued {
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown;
  /** what it is, for the person: "Comment on APP-12" */
  label: string;
  at: string;
}

type Send = (q: Queued) => Promise<ApiResult<unknown>>;

export class Outbox {
  private items: Queued[] = [];
  private listeners = new Set<() => void>();
  private flushing = false;
  /** what the server refused, for the person to see */
  dropped: { label: string; message: string }[] = [];

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null,
    private readonly key: string,
  ) {
    try {
      const raw = storage?.getItem(key);
      this.items = raw ? (JSON.parse(raw) as Queued[]) : [];
    } catch {
      this.items = [];
    }
  }

  get count(): number {
    return this.items.length;
  }

  list(): readonly Queued[] {
    return this.items;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private save(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.items));
    } catch {
      // storage full or blocked: the queue still lives in this page
    }
    for (const fn of this.listeners) fn();
  }

  add(q: Omit<Queued, 'id' | 'at'>, now = new Date()): Queued {
    const item: Queued = {
      ...q,
      id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 8),
      at: now.toISOString(),
    };
    this.items.push(item);
    this.save();
    return item;
  }

  /** Sends what waits, oldest first; stops at the first one that still cannot reach the server. */
  async flush(send: Send = (q) => api(q.method, q.path, q.body)): Promise<number> {
    if (this.flushing || !this.items.length) return 0;
    this.flushing = true;
    let sent = 0;
    try {
      while (this.items.length) {
        const q = this.items[0] as Queued;
        const r = await send(q);
        if (
          !r.ok &&
          (r.error.status === 0 ||
            r.error.status === 408 ||
            r.error.status === 429 ||
            r.error.status >= 500)
        )
          break;
        this.items.shift();
        if (r.ok) sent++;
        else this.dropped.push({ label: q.label, message: r.error.message });
        this.save();
      }
    } finally {
      this.flushing = false;
    }
    return sent;
  }
}

const boxes = new Map<string, Outbox>();

/** The outbox of a workspace in this browser. */
export function outboxFor(workspaceId: string): Outbox {
  let box = boxes.get(workspaceId);
  if (!box) {
    const storage =
      typeof window === 'undefined'
        ? null
        : (() => {
            try {
              return window.localStorage;
            } catch {
              return null;
            }
          })();
    box = new Outbox(storage, 'orqiva.outbox.' + workspaceId);
    boxes.set(workspaceId, box);
  }
  return box;
}

/** Sends a write now, or keeps it for later when the server cannot be reached. */
export async function sendOrQueue<T>(
  box: Outbox,
  method: Queued['method'],
  path: string,
  body: unknown,
  label: string,
  send: (m: Queued['method'], p: string, b: unknown) => Promise<ApiResult<T>> = (m, p, b) =>
    api<T>(m, p, b),
): Promise<{ sent: true; data: T } | { queued: true } | { error: string }> {
  const r = await send(method, path, body);
  if (r.ok) return { sent: true, data: r.data };
  if (r.error.status === 0) {
    box.add({ method, path, body, label });
    return { queued: true };
  }
  return { error: r.error.message };
}
