// ── [PCODE-354 | S15 | v0.1.0] T35.4b Offline beyond tasks: comments, messages and time written offline; reads kept for offline ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
//    Why:  the page's side of the installable app: registering the service worker, and turning
//          notifications on and off on this device (ask the person, subscribe with the server's key, tell the
//          server). The two small rules the service worker follows live here too, so they are tested.

/** Server data and anything not ours is never answered from the cache. */
export const passThrough = (url: URL, origin: string): boolean =>
  url.origin !== origin ||
  /^\/(api|auth|live|mcp|health|stripe|openapi)(\/|$|\.)/.test(url.pathname);

/** [PCODE-354 | S15 | v0.1.0] The data kept for reading offline: the pages a person opens to work, not admin or search. */
const UUID = '[0-9a-f-]{36}';
const READABLE = new RegExp(
  '^/api/workspaces/' +
    UUID +
    '/(home|my-work|inbox|shell|projects|channels|time/week|docs|channels/' +
    UUID +
    '/messages|docs/' +
    UUID +
    '|projects/' +
    UUID +
    '(/docs|/items)?|items/' +
    UUID +
    '(/comments)?)$',
);
export const offlineReadable = (url: URL, origin: string): boolean =>
  url.origin === origin && (url.pathname === '/auth/me' || READABLE.test(url.pathname));

/** The cache that keeps that data; signing out empties it. */
export const DATA_CACHE = 'orqiva-data';

/** Where a notification click goes: a page of this app, never somewhere else. */
export function notificationTarget(path: string | undefined, origin: string): string {
  try {
    const u = new URL(path ?? '/', origin);
    if (u.origin === origin) return u.href;
  } catch {
    // not an address
  }
  return origin + '/';
}

/** [PCODE-354 | S15 | v0.1.0] Empties the kept data, so the next person on this browser does not see it. */
export function forgetOfflineData(): void {
  if (typeof caches === 'undefined') return;
  void caches.delete(DATA_CACHE).catch(() => undefined);
}

/** Registers the service worker once the page has loaded; browsers without one simply skip it. */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

export type PushSupport = 'ok' | 'unsupported' | 'denied' | 'needs-install';

/** Whether this browser can get notifications, and what is in the way if not. */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  // iPhone and iPad allow Web Push only to an app added to the home screen
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return /iPhone|iPad/.test(navigator.userAgent) && !standalone ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

const keyBytes = (b64url: string): Uint8Array<ArrayBuffer> => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** This device's subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Asks the person, subscribes with the server's key, and answers what the server must store. */
export async function subscribeDevice(publicKey: string): Promise<{
  endpoint: string;
  keys: { p256dh: string; auth: string };
}> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site');
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  };
}

/** A name the person recognises the device by in the list. */
export function deviceName(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? browser + ' on ' + os : browser;
}
