// ── [PCODE-195 | S15 | v0.1.0] B8.3 CLI parity: inbox, approvals, comments, time, agents and ideas from the terminal, offline queue ──
// ── [PCODE-90 | S15 | v0.1.0] Build the web app shell with login and the ported design system ──
// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
//    Why:  the server delivers the web app itself, so an install is one process and one port. Files come
//          only from inside the web folder (no ../ escapes); a path without a file extension gets
//          index.html, so /login and /signup load the app. Headers forbid framing, sniffing and any script
//          or style from another origin.
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  // [PCODE-151 | S15 | v0.1.0]
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  // [PCODE-150 | S15 | v0.1.0] no other site may open us in a window it controls, or embed our files
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

const REVALIDATE = new Set(['/sw.js', '/manifest.webmanifest']);

/** Returns a handler that serves `dir`, or answers false when the request is not for it. */
export function staticFiles(dir: string): (req: IncomingMessage, res: ServerResponse) => boolean {
  const root = resolve(dir);
  const index = join(root, 'index.html');
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      return false;
    }
    if (pathname.includes('\0')) return false;
    let file = resolve(root, '.' + normalize('/' + pathname));
    if (file !== root && !file.startsWith(root + sep)) return false;
    if (!existsSync(file) || !statSync(file).isFile()) {
      // an app route (/login), not a missing asset (/missing.js)
      if (extname(pathname)) return false;
      // [PCODE-195 | S15 | v0.1.0] nor an API path this server lacks: a client gets a JSON 404, not the app
      if (/^\/(api|internal|auth)(\/|$)/.test(pathname)) return false;
      file = index;
    }
    if (!existsSync(file)) return false;
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    // [PCODE-151 | S15 | v0.1.0] the service worker and the manifest name no version: always revalidate
    const fresh = file === index || REVALIDATE.has(pathname);
    res.writeHead(200, {
      'content-type': type,
      'content-length': statSync(file).size,
      // index.html always revalidates so a new release is picked up at once
      'cache-control': fresh ? 'no-cache' : 'public, max-age=300',
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
    return true;
  };
}
