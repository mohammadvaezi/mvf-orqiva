// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  runs in the page's own world, from the start, so it sees what the page logs and asks for:
//          every console call and every fetch or XMLHttpRequest (method, address, status, time) is
//          passed on to the collector beside it. The page's own behaviour is unchanged.
import { consoleText, type ConsoleEntry, type NetworkEntry } from './lib/collect.js';

const SOURCE = 'orqiva-capture';
/** A request's address in full: the page may ask for /api/cart. */
const absolute = (url: string): string => {
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
};
const post = (kind: 'console' | 'network', entry: ConsoleEntry | NetworkEntry): void => {
  window.postMessage({ source: SOURCE, kind, entry }, '*');
};

const LEVELS = ['error', 'warn', 'info', 'log', 'debug'] as const;
for (const level of LEVELS) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]): void => {
    post('console', { level, text: consoleText(args), at: new Date().toISOString() });
    original(...args);
  };
}
window.addEventListener('error', (e) => {
  post('console', {
    level: 'error',
    text: (e.message || 'Error') + (e.filename ? ' at ' + e.filename + ':' + String(e.lineno) : ''),
    at: new Date().toISOString(),
  });
});
window.addEventListener('unhandledrejection', (e) => {
  post('console', {
    level: 'error',
    text: 'Unhandled rejection: ' + consoleText([e.reason]),
    at: new Date().toISOString(),
  });
});

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const started = performance.now();
  const at = new Date().toISOString();
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const url = absolute(input instanceof Request ? input.url : String(input));
  try {
    const res = await originalFetch(input, init);
    post('network', { method, url, status: res.status, ms: performance.now() - started, at });
    return res;
  } catch (e) {
    post('network', { method, url, status: 0, ms: performance.now() - started, at });
    throw e;
  }
};

// the originals, called with .call on each request
// eslint-disable-next-line @typescript-eslint/unbound-method
const open = XMLHttpRequest.prototype.open;
// eslint-disable-next-line @typescript-eslint/unbound-method
const send = XMLHttpRequest.prototype.send;
const meta = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
XMLHttpRequest.prototype.open = function (
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  ...rest: unknown[]
): void {
  meta.set(this, { method: method.toUpperCase(), url: absolute(String(url)) });
  (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
};
XMLHttpRequest.prototype.send = function (
  this: XMLHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null,
): void {
  const m = meta.get(this);
  const started = performance.now();
  const at = new Date().toISOString();
  if (m)
    this.addEventListener('loadend', () => {
      post('network', { ...m, status: this.status, ms: performance.now() - started, at });
    });
  send.call(this, body);
};
