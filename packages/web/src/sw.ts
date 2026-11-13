// ── [PCODE-354 | S15 | v0.1.0] T35.4b Offline beyond tasks: comments, messages and time written offline; reads kept for offline ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
//    Why:  the service worker. It keeps the app shell (page, script, styles, icons) of this release so the
//          installed app opens without a network and shows its own offline state instead of the browser's;
//          data (/api, /auth, /live) always goes to the server and is never cached. It shows the push
//          messages the server sends and opens the page a notification points to, in a window of the app
//          that is already open when there is one. The build writes the release's file list into SHELL.

import { DATA_CACHE, notificationTarget, offlineReadable, passThrough } from './pwa.js';

declare const SHELL: string[];
declare const RELEASE: string;

interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(r: Response | Promise<Response>): void;
}
interface PushEvent extends ExtendableEvent {
  data: { json(): unknown } | null;
}
interface WindowClient {
  url: string;
  focus(): Promise<WindowClient>;
  navigate(url: string): Promise<WindowClient | null>;
}
interface NotificationEvent extends ExtendableEvent {
  notification: { data: unknown; close(): void };
}
interface Worker {
  location: Location;
  registration: {
    showNotification(
      title: string,
      options: { body?: string; tag?: string; data?: unknown; icon?: string; badge?: string },
    ): Promise<void>;
  };
  clients: {
    matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<WindowClient[]>;
    openWindow(url: string): Promise<WindowClient | null>;
    claim(): Promise<void>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
  addEventListener(type: 'push', fn: (e: PushEvent) => void): void;
  addEventListener(type: 'notificationclick', fn: (e: NotificationEvent) => void): void;
}

const sw = self as unknown as Worker;
const CACHE = 'orqiva-shell-' + RELEASE;

sw.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => sw.skipWaiting()),
  );
});

// an upgrade drops the shells of older releases
sw.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                (k.startsWith('orqiva-shell-') || k.startsWith('prodengine-shell-')) && k !== CACHE,
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // [PCODE-354 | S15 | v0.1.0] the pages' data: the newest from the server, the kept copy when offline
  if (offlineReadable(url, sw.location.origin)) {
    e.respondWith(
      fetch(req)
        .then(async (res) => {
          if (res.ok) await caches.open(DATA_CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() =>
          caches.match(req, { cacheName: DATA_CACHE }).then((hit) => hit ?? Response.error()),
        ),
    );
    return;
  }
  if (passThrough(url, sw.location.origin)) return;
  if (req.mode === 'navigate') {
    // pages: the newest from the server, the kept shell when offline
    e.respondWith(
      fetch(req).catch(() =>
        caches.match('/').then((r) => r ?? new Response('Offline', { status: 503 })),
      ),
    );
    return;
  }
  // files of this release never change under their name
  e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
});

interface Message {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

sw.addEventListener('push', (e) => {
  let m: Message = {};
  try {
    m = e.data?.json() ?? {};
  } catch {
    m = {};
  }
  e.waitUntil(
    sw.registration.showNotification(m.title ?? 'Orqiva', {
      body: m.body ?? '',
      ...(m.tag ? { tag: m.tag } : {}),
      data: { url: m.url ?? '/' },
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    }),
  );
});

sw.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = notificationTarget(
    (e.notification.data as { url?: string } | null)?.url,
    sw.location.origin,
  );
  e.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (open) => {
      const win = open.find((w) => new URL(w.url).origin === sw.location.origin);
      if (win) {
        await win.focus();
        await win.navigate(target);
        return;
      }
      await sw.clients.openWindow(target);
    }),
  );
});
