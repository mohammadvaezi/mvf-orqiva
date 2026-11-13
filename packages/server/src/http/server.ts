// ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
// ── [PCODE-213 | S15 | v0.1.0] T19.2 SCIM 2.0 provisioning (users, role groups, suspend on deactivate) and identity settings (SAML, SCIM tokens) ──
// ── [PCODE-212 | S15 | v0.1.0] T19.1 SAML 2.0 single sign-on per workspace, own XML signature verification with wrapping defences ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
// ── [PCODE-86 | S15 | v0.1.0] Write the HTTP server on Node built-ins: router, validation, error model, OpenAPI ──
// ── [PCODE-90 | S15 | v0.1.0] Build the web app shell with login and the ported design system ──
// ── [PCODE-95 | S15 | v0.1.0] Build our own WebSocket gateway (RFC 6455) with typed protocol and SSE fallback ──
// ── [PCODE-144 | S15 | v0.1.0] Export evidence packs with one click ──
// ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
// ── [PCODE-149 | S15 | v0.1.0] Bill through Stripe without its SDK: checkout, webhooks, licences ──
//    Why:  the request pipeline on node:http alone: request id, routing (404/405), JSON body with a size
//          limit, schema checks for params, query and body, the handler, a checked response, and one error
//          shape for every failure. Shutdown lets running requests finish before the process exits.
import { RateLimiter } from '../auth/ratelimit.js';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { HttpError, errorBody, invalid } from './errors.js';
import { Router, type Route } from './router.js';
import { validate, type Issue } from './schema.js';

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export const silentLogger: Logger = { info: () => undefined, error: () => undefined };

export const consoleLogger: Logger = {
  info: (msg, fields) => {
    console.log(JSON.stringify({ level: 'info', msg, ...fields }));
  },
  error: (msg, fields) => {
    console.error(JSON.stringify({ level: 'error', msg, ...fields }));
  },
};

export interface HttpServerOptions {
  routes: readonly Route[];
  logger?: Logger;
  /** request bodies larger than this are refused with 413; default 1 MiB */
  maxBodyBytes?: number;
  /** check every reply against its response schema; on in development and tests, off in production */
  checkResponses?: boolean;
  /** serves what no route matches (the web app); answers false to fall through to 404 */
  fallback?: (req: IncomingMessage, res: ServerResponse) => boolean;
  /** [PCODE-95 | S15 | v0.1.0] streaming endpoints (SSE) that answer before routing; false to pass */
  raw?: (req: IncomingMessage, res: ServerResponse) => boolean;
  /** [PCODE-95 | S15 | v0.1.0] runs first on close: long-lived connections are ended so close can finish */
  beforeClose?: () => void;
  /** [PCODE-150 | S15 | v0.1.0] requests per minute and per client, all and writes; none when left out */
  rateLimit?: { requestsPerMinute: number; writesPerMinute: number; trustProxy?: boolean };
  /** [PCODE-150 | S15 | v0.1.0] tell browsers to use HTTPS only (when the public address is https) */
  hsts?: boolean;
}

export interface HttpServer {
  server: Server;
  /** stop accepting, let running requests finish, force-close what is left after `graceMs` */
  close(graceMs?: number): Promise<void>;
}

const JSON_TYPE = 'application/json; charset=utf-8';

// [PCODE-149 | S15 | v0.1.0] each request's body as text, for the routes that check a signature over it
const RAW_BODIES = new WeakMap<IncomingMessage, string>();

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (res.headersSent) return;
  const text = status === 204 ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': JSON_TYPE,
    'content-length': Buffer.byteLength(text),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    // [PCODE-150 | S15 | v0.1.0] an API answer is never framed, never sent on as a referrer, never read by another site
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    ...headers,
  });
  res.end(text);
}

async function readJson(
  req: IncomingMessage,
  limit: number,
  form = false,
  textJson = false, // [PCODE-337 | S15 | v0.1.0]
): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit)
    throw new HttpError(
      413,
      'payload_too_large',
      'The body is larger than ' + String(limit) + ' bytes',
    );
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit)
      throw new HttpError(
        413,
        'payload_too_large',
        'The body is larger than ' + String(limit) + ' bytes',
      );
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  // [PCODE-212 | S15 | v0.1.0] a form body, only where the route asks for it
  if (form && type === 'application/x-www-form-urlencoded')
    return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
  // [PCODE-213 | S15 | v0.1.0] SCIM clients send JSON as application/scim+json
  if (
    type !== 'application/json' &&
    type !== 'application/scim+json' &&
    !(textJson && type === 'text/plain')
  ) {
    throw new HttpError(415, 'unsupported_media_type', 'Send the body as application/json');
  }
  const text = Buffer.concat(chunks).toString('utf8');
  // [PCODE-149 | S15 | v0.1.0] kept as received: signatures (Stripe's) are computed over these exact bytes
  RAW_BODIES.set(req, text);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'invalid_json', 'The body is not valid JSON');
  }
}

export function createHttpServer(opts: HttpServerOptions): HttpServer {
  const router = new Router(opts.routes);
  const log = opts.logger ?? silentLogger;
  const limit = opts.maxBodyBytes ?? 1024 * 1024;
  const checkResponses = opts.checkResponses ?? process.env['NODE_ENV'] !== 'production';
  let closing = false;
  // [PCODE-150 | S15 | v0.1.0]
  const limits = opts.rateLimit
    ? {
        all: new RateLimiter(opts.rateLimit.requestsPerMinute, 60_000),
        writes: new RateLimiter(opts.rateLimit.writesPerMinute, 60_000),
      }
    : null;

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    // [PCODE-150 | S15 | v0.1.0] every client within its share: all requests, and writes more tightly
    if (limits && pathname !== '/health') {
      const forwarded = String(req.headers['x-forwarded-for'] ?? '')
        .split(',')[0]
        ?.trim();
      const ip = (opts.rateLimit?.trustProxy && forwarded) || req.socket.remoteAddress || 'unknown';
      const write = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
      const over = !limits.all.allowed(ip) || (write && !limits.writes.allowed(ip));
      if (over)
        throw new HttpError(
          429,
          'too_many_requests',
          'Too many requests; slow down and try again in a minute',
          undefined,
          {
            'retry-after': '60',
          },
        );
      limits.all.fail(ip);
      if (write) limits.writes.fail(ip);
    }
    try {
      decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, 'invalid_request', 'The path is not valid');
    }
    if (opts.raw?.(req, res)) return;
    const found = router.match(req.method ?? 'GET', pathname);
    // [PCODE-90 | S15 | v0.1.0] no API route: the web app's files, if the server delivers them
    if (!found && opts.fallback?.(req, res)) return;
    if (!found)
      throw new HttpError(404, 'not_found', 'No route for ' + (req.method ?? '') + ' ' + pathname);
    if ('allowed' in found) {
      throw new HttpError(
        405,
        'method_not_allowed',
        'Use ' + found.allowed.join(' or '),
        undefined,
        {
          allow: found.allowed.join(', '),
        },
      );
    }
    const { route, params } = found.match;

    const issues: Issue[] = [];
    let p: unknown = params;
    if (route.params) {
      const r = validate(route.params, params, 'params');
      if (r.ok) p = r.value;
      else issues.push(...r.issues);
    }
    const queryObj = Object.fromEntries(url.searchParams);
    let q: unknown = queryObj;
    if (route.query) {
      const r = validate(route.query, queryObj, 'query');
      if (r.ok) q = r.value;
      else issues.push(...r.issues);
    }
    const raw = await readJson(req, limit, route.form === true, route.textJson === true);
    let b: unknown = raw;
    if (route.body) {
      const r = validate(route.body, raw, 'body');
      if (r.ok) b = r.value;
      else issues.push(...r.issues);
    } else if (raw !== undefined) {
      issues.push({ path: 'body', message: 'this route takes no body' });
    }
    if (issues.length) throw invalid(issues);

    const reply = await route.handler({
      params: p,
      query: q,
      body: b,
      requestId,
      req,
      rawBody: RAW_BODIES.get(req) ?? '',
    });
    // [PCODE-144 | S15 | v0.1.0] a download: the bytes as they are, named for the browser
    if (reply.file) {
      if (res.headersSent) return;
      res.writeHead(reply.status ?? route.status ?? 200, {
        'content-type': reply.file.contentType,
        'content-length': reply.file.data.length,
        // [PCODE-168 | S15 | v0.1.0]
        'content-disposition':
          (reply.file.inline ? 'inline' : 'attachment') +
          '; filename="' +
          reply.file.name.replace(/[^\w.-]/g, '_') +
          '"',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'x-request-id': requestId,
        ...reply.headers,
      });
      res.end(reply.file.data);
      return;
    }
    if (checkResponses) {
      const r = validate(route.response, reply.body, 'response');
      if (!r.ok) {
        log.error('response does not match its schema', {
          route: route.method + ' ' + route.path,
          issues: r.issues,
          requestId,
        });
        throw new HttpError(500, 'internal', 'Something went wrong on our side');
      }
    }
    send(res, reply.status ?? route.status ?? 200, reply.body, {
      'x-request-id': requestId,
      ...reply.headers,
    });
  }

  const server = createServer((req, res) => {
    const requestId = randomUUID();
    const started = performance.now();
    if (closing) res.setHeader('connection', 'close');
    // [PCODE-150 | S15 | v0.1.0] browsers keep to HTTPS for a year once they saw it here
    if (opts.hsts)
      res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
    handle(req, res, requestId)
      .catch((err: unknown) => {
        if (err instanceof HttpError) {
          send(res, err.status, errorBody(err, requestId), {
            'x-request-id': requestId,
            ...err.headers,
          });
          return;
        }
        log.error('unhandled error', {
          requestId,
          error: err instanceof Error ? err.stack : String(err),
        });
        send(
          res,
          500,
          errorBody(new HttpError(500, 'internal', 'Something went wrong on our side'), requestId),
          {
            'x-request-id': requestId,
          },
        );
      })
      .finally(() => {
        // [PCODE-88 | S15 | v0.1.0] the path only: query strings carry OIDC codes and states
        log.info('request', {
          method: req.method,
          path: (req.url ?? '').split('?')[0],
          status: res.statusCode,
          ms: Math.round(performance.now() - started),
          requestId,
        });
      });
  });

  async function close(graceMs = 10_000): Promise<void> {
    closing = true;
    opts.beforeClose?.();
    const done = new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    server.closeIdleConnections();
    const timer = setTimeout(() => {
      server.closeAllConnections();
    }, graceMs);
    await done;
    clearTimeout(timer);
  }

  return { server, close };
}
