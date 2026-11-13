// ── [PCODE-230 | S15 | v0.1.0] T22.3 Presence from and on the phone ──
// ── [PCODE-228 | S15 | v0.1.0] T22.1 Live map on the phone: projects, health, heat, sprint progress, cards in progress, alerts ──
// ── [PCODE-225 | S15 | v0.1.0] T21.2 Live feed core and offline cache for the phone, in shared ──
//    Why:  the phone's live feed, kept out of the app so it can be tested without a phone. It opens from
//          the device's cache at once, with or without network, then follows the live connection from the
//          cache's cursor, so the server replays exactly what was missed. Events are kept newest first,
//          without duplicates (the first page and the live stream may overlap), capped, and saved back to
//          the cache shortly after each change. A gap too large to replay reloads the newest page.
import type { ActivityEvent } from './events.js';
import type { PresenceEntry } from './live.js';
import { LiveClient, type Place, type SocketLike } from './liveclient.js';

/** The part of a key-value store the feed uses (AsyncStorage-like; tests pass a Map). */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const FEED_CACHE_VERSION = 1;
/** Events a phone keeps: enough for a day's look back, small enough to load at once. */
export const FEED_LIMIT = 200;

export interface FeedCache {
  v: typeof FEED_CACHE_VERSION;
  server: string;
  workspaceId: string;
  /** the last sequence the feed holds: the live connection resumes after it */
  sequence: number | null;
  /** newest first */
  events: ActivityEvent[];
  savedAt: string;
}

export const feedCacheKey = (server: string, workspaceId: string): string =>
  'orqiva.feed.v' + String(FEED_CACHE_VERSION) + '.' + server + '.' + workspaceId;

const isEvent = (e: unknown): e is ActivityEvent => {
  if (typeof e !== 'object' || e === null) return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x['id'] === 'string' &&
    typeof x['type'] === 'string' &&
    typeof x['time'] === 'string' &&
    typeof x['sequence'] === 'number' &&
    typeof x['data'] === 'object' &&
    x['data'] !== null
  );
};

/** A saved cache, if it is ours, for this server and workspace, and readable; otherwise null. */
export function readFeedCache(
  text: string | null,
  server: string,
  workspaceId: string,
): FeedCache | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Partial<FeedCache>;
  if (c.v !== FEED_CACHE_VERSION || c.server !== server || c.workspaceId !== workspaceId)
    return null;
  const events = Array.isArray(c.events) ? c.events.filter(isEvent) : [];
  return {
    v: FEED_CACHE_VERSION,
    server,
    workspaceId,
    sequence: typeof c.sequence === 'number' ? c.sequence : null,
    events: mergeEvents([], events),
    savedAt: typeof c.savedAt === 'string' ? c.savedAt : '',
  };
}

/** `incoming` added to `list`: newest first, one per sequence, at most `limit`. */
export function mergeEvents(
  list: readonly ActivityEvent[],
  incoming: readonly ActivityEvent[],
  limit = FEED_LIMIT,
): ActivityEvent[] {
  const bySeq = new Map<number, ActivityEvent>();
  for (const e of list) bySeq.set(e.sequence, e);
  for (const e of incoming) bySeq.set(e.sequence, e);
  return [...bySeq.values()].sort((a, b) => b.sequence - a.sequence).slice(0, limit);
}

/** connecting: no answer yet; live: following the stream; offline: waiting for the network. */
export type FeedStatus = 'connecting' | 'live' | 'offline';

export interface FeedState {
  /** newest first */
  events: ActivityEvent[];
  status: FeedStatus;
  /** when the cache shown was saved, while nothing newer has arrived; null once live data is in */
  cachedAt: string | null;
  /** the last error from loading a page, for a quiet note */
  error: string | null;
}

export interface FeedOptions {
  server: string;
  workspaceId: string;
  store: KeyValueStore;
  /** opens the live socket (the app adds the device token) */
  open: (path: string) => SocketLike;
  /** the newest page of events, oldest first, and the sequence to follow on from (GET …/activity) */
  fetchPage: () => Promise<{ sequence: number; events: ActivityEvent[] }>;
  onChange: (state: FeedState) => void;
  /** [PCODE-228 | S15 | v0.1.0] each event as it arrives live, for screens that reload when it touches them */
  onEvent?: (event: ActivityEvent) => void;
  /** [PCODE-230 | S15 | v0.1.0] who is where in the workspace, on every change */
  onPresence?: (people: PresenceEntry[]) => void;
  limit?: number;
  /** ms to wait before saving after a change; 0 saves at once */
  saveDelayMs?: number;
  now?: () => Date;
}

export class Feed {
  private events: ActivityEvent[] = [];
  private sequence: number | null = null;
  private status: FeedStatus = 'connecting';
  private cachedAt: string | null = null;
  private error: string | null = null;
  private live: LiveClient | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private needsPage = false;
  private place: Place | null = null;
  private closed = false;

  constructor(private readonly opts: FeedOptions) {}

  get state(): FeedState {
    return {
      events: this.events,
      status: this.status,
      cachedAt: this.cachedAt,
      error: this.error,
    };
  }

  private get key(): string {
    return feedCacheKey(this.opts.server, this.opts.workspaceId);
  }

  private emit(): void {
    if (!this.closed) this.opts.onChange(this.state);
  }

  /** Shows the cache, then follows the live stream from where the cache ends. */
  async open(): Promise<void> {
    const cache = readFeedCache(
      await this.opts.store.getItem(this.key).catch(() => null),
      this.opts.server,
      this.opts.workspaceId,
    );
    if (cache) {
      this.events = cache.events;
      this.sequence = cache.sequence;
      this.cachedAt = cache.savedAt || null;
      this.emit();
    } else {
      // nothing saved yet: the newest page first, so the stream knows where to start
      await this.loadPage();
    }
    if (this.closed) return;
    // without a cache or a page, the stream starts at the head; the page follows once online
    this.needsPage = this.sequence === null;
    this.live = new LiveClient({
      workspaceId: this.opts.workspaceId,
      open: this.opts.open,
      ...(this.sequence !== null ? { after: this.sequence } : {}),
      onEvent: (e) => {
        this.add([e]);
        this.opts.onEvent?.(e);
      },
      onResync: () => {
        void this.loadPage(true);
      },
      onPresence: (people) => {
        if (!this.closed) this.opts.onPresence?.(people);
      },
      onStatus: (online) => {
        this.status = online ? 'live' : 'offline';
        if (online && this.needsPage) {
          this.needsPage = false;
          void this.loadPage();
        }
        this.emit();
      },
    });
    this.live.start();
    if (this.place) this.live.setPresence(this.place);
  }

  /** Pull to refresh: the newest page again, and the connection now rather than at its next try. */
  async refresh(): Promise<void> {
    this.wake();
    await this.loadPage();
  }

  /** [PCODE-230 | S15 | v0.1.0] Where this person is now; repeated as a heartbeat while connected. */
  setPresence(place: Place): void {
    this.place = place;
    this.live?.setPresence(place);
  }

  /** The app came to the front or the network came back: connect now. */
  wake(): void {
    this.live?.reconnectNow();
  }

  /** Stops following and saves what is there. */
  async close(): Promise<void> {
    this.closed = true;
    this.live?.stop();
    this.live = null;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.save();
    }
    await this.saving;
  }

  /** Signing out: stops and forgets the cache. */
  async forget(): Promise<void> {
    await this.close();
    await this.opts.store.removeItem(this.key).catch(() => undefined);
  }

  private async loadPage(replace = false): Promise<void> {
    try {
      const page = await this.opts.fetchPage();
      this.error = null;
      if (replace) this.events = [];
      this.sequence = Math.max(this.sequence ?? 0, page.sequence);
      this.add(page.events);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.emit();
    }
  }

  private add(incoming: readonly ActivityEvent[]): void {
    if (this.closed) return;
    this.events = mergeEvents(this.events, incoming, this.opts.limit ?? FEED_LIMIT);
    const newest = this.events[0]?.sequence;
    if (newest !== undefined) this.sequence = Math.max(this.sequence ?? 0, newest);
    this.cachedAt = null;
    this.emit();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    const delay = this.opts.saveDelayMs ?? 1000;
    if (delay <= 0) {
      void this.save();
      return;
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, delay);
  }

  private save(): Promise<void> {
    const cache: FeedCache = {
      v: FEED_CACHE_VERSION,
      server: this.opts.server,
      workspaceId: this.opts.workspaceId,
      sequence: this.sequence,
      events: this.events,
      savedAt: (this.opts.now?.() ?? new Date()).toISOString(),
    };
    const text = JSON.stringify(cache);
    // one write after the other, so an older state never lands last
    this.saving = this.saving.then(() =>
      this.opts.store.setItem(this.key, text).catch(() => undefined),
    );
    return this.saving;
  }
}
