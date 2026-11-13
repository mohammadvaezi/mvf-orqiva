// ── [PCODE-230 | S15 | v0.1.0] T22.3 Presence from and on the phone ──
// ── [PCODE-228 | S15 | v0.1.0] T22.1 Live map on the phone: projects, health, heat, sprint progress, cards in progress, alerts ──
//    Why:  a screen's data, read from the server and read again shortly after a live event that touches
//          it (several events in a row cause one read). What was read last stays on screen while the
//          phone is offline, with the time it was read; the map's last read is also kept on the device.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityEvent, Place, PresenceEntry } from '@orqiva/shared';
import { SignedOutError } from './client';
import { touches, type Scope } from './scope';
import { cacheStore } from './storage';

type Listener = (e: ActivityEvent) => void;

/** The app's live events, for screens to listen to. */
export class EventHub {
  private readonly listeners = new Set<Listener>();
  /** set by the app: a screen's read said the phone is no longer signed in */
  signedOut: (() => void) | null = null;
  // [PCODE-230 | S15 | v0.1.0] who is where, and where this phone's person is
  people: PresenceEntry[] = [];
  private readonly peopleListeners = new Set<(p: PresenceEntry[]) => void>();
  /** set by the app: reports the place to the server */
  report: ((place: Place) => void) | null = null;

  setPeople(people: PresenceEntry[]): void {
    this.people = people;
    for (const l of this.peopleListeners) l(people);
  }
  onPeople(l: (p: PresenceEntry[]) => void): () => void {
    this.peopleListeners.add(l);
    return () => {
      this.peopleListeners.delete(l);
    };
  }
  /** Where the person is on the phone: a project, a task, or the workspace as a whole. */
  here(projectId: string | null, itemId: string | null): void {
    this.report?.({ projectId, itemId, state: 'viewing', device: 'phone' });
  }
  emit(e: ActivityEvent): void {
    for (const l of this.listeners) l(e);
  }
  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}

export interface Live<T> {
  data: T | null;
  /** when the data on screen was read */
  readAt: string | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useLive<T>(
  load: () => Promise<T>,
  opts: { hub: EventHub; scope: Scope; key: string; cache?: boolean; delayMs?: number },
): Live<T> {
  const [data, setData] = useState<T | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const cacheKey = 'orqiva.screen.' + opts.key;

  const reload = useCallback(async () => {
    try {
      const d = await loadRef.current();
      const now = new Date().toISOString();
      setData(d);
      setAt(now);
      setError(null);
      if (opts.cache)
        void cacheStore
          .setItem(cacheKey, JSON.stringify({ data: d, at: now }))
          .catch(() => undefined);
    } catch (err) {
      if (err instanceof SignedOutError) opts.hub.signedOut?.();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cacheKey, opts.cache, opts.hub]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (opts.cache)
      void cacheStore
        .getItem(cacheKey)
        .then((text) => {
          if (cancelled || !text) return;
          const saved = JSON.parse(text) as { data: T; at: string };
          setData((d) => d ?? saved.data);
          setAt((a) => a ?? saved.at);
        })
        .catch(() => undefined);
    void reload();
    return () => {
      cancelled = true;
    };
  }, [reload, cacheKey, opts.cache]);

  const scopeRef = useRef(opts.scope);
  scopeRef.current = opts.scope;
  const delay = opts.delayMs ?? 800;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = opts.hub.on((e) => {
      if (!touches(e, scopeRef.current) || timer) return;
      timer = setTimeout(() => {
        timer = null;
        void reload();
      }, delay);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [opts.hub, delay, reload]);

  return { data, readAt: at, error, loading, reload };
}

/** [PCODE-230 | S15 | v0.1.0] Who is where, others only, updated as people move. */
export function usePeople(hub: EventHub, meId: string): PresenceEntry[] {
  const [people, setPeople] = useState<PresenceEntry[]>(hub.people);
  useEffect(() => hub.onPeople(setPeople), [hub]);
  return people.filter((p) => p.userId !== meId);
}
