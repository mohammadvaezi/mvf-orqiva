// ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
// ── [PCODE-212 | S15 | v0.1.0] T19.1 SAML 2.0 single sign-on per workspace, own XML signature verification with wrapping defences ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
// ── [PCODE-86 | S15 | v0.1.0] Write the HTTP server on Node built-ins: router, validation, error model, OpenAPI ──
// ── [PCODE-149 | S15 | v0.1.0] Bill through Stripe without its SDK: checkout, webhooks, licences ──
// ── [PCODE-144 | S15 | v0.1.0] Export evidence packs with one click ──
//    Why:  routes are data: method, path with :params, the schemas of what comes in and goes out, and a
//          handler that receives values already checked and typed. The OpenAPI document is generated from
//          the same list, so the documentation cannot drift from the code.
import type { IncomingMessage } from 'node:http';
import type { Infer, Schema } from './schema.js';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestContext<P, Q, B> {
  params: P;
  query: Q;
  body: B;
  requestId: string;
  req: IncomingMessage;
  /** [PCODE-149 | S15 | v0.1.0] the body exactly as it came, for signature checks */
  rawBody?: string;
}

export interface Reply<R> {
  status?: number;
  body: R;
  headers?: Record<string, string>;
  /** [PCODE-144 | S15 | v0.1.0] a file to download instead of JSON (the body is then not sent) */
  // [PCODE-168 | S15 | v0.1.0] inline: shown in the browser (safe images) instead of downloaded
  file?: { data: Buffer; contentType: string; name: string; inline?: boolean };
}

export interface RouteSpec<
  PS extends Schema<unknown> | undefined,
  QS extends Schema<unknown> | undefined,
  BS extends Schema<unknown> | undefined,
  RS extends Schema<unknown>,
> {
  method: Method;
  /** "/projects/:projectId/items/:itemId" */
  path: string;
  summary: string;
  tags?: string[];
  params?: PS;
  query?: QS;
  body?: BS;
  /** [PCODE-212 | S15 | v0.1.0] also take an HTML form body (application/x-www-form-urlencoded): only for
   *  routes another site must post to (SAML); everywhere else JSON-only keeps forms from other sites out */
  form?: boolean;
  /** [PCODE-337 | S15 | v0.1.0] also take JSON sent as text/plain, the one body another site may post
   *  without asking first: only for public routes that use no session (the feedback widget) */
  textJson?: boolean;
  response: RS;
  /** status of a successful reply; default 200 */
  status?: number;
  handler: (
    ctx: RequestContext<
      PS extends Schema<unknown> ? Infer<PS> : Record<string, never>,
      QS extends Schema<unknown> ? Infer<QS> : Record<string, never>,
      BS extends Schema<unknown> ? Infer<BS> : undefined
    >,
  ) => Promise<Reply<Infer<RS>>> | Reply<Infer<RS>>;
}

/** A route with its types erased, as the server and the OpenAPI generator see it. */
export interface Route {
  method: Method;
  path: string;
  summary: string;
  tags?: string[];
  params?: Schema<unknown>;
  query?: Schema<unknown>;
  body?: Schema<unknown>;
  form?: boolean; // [PCODE-212 | S15 | v0.1.0]
  textJson?: boolean; // [PCODE-337 | S15 | v0.1.0]
  response: Schema<unknown>;
  status?: number;
  handler: (
    ctx: RequestContext<unknown, unknown, unknown>,
  ) => Promise<Reply<unknown>> | Reply<unknown>;
}

/** Declares a route with full typing; the result goes into the server's route list. */
export function route<
  PS extends Schema<unknown> | undefined = undefined,
  QS extends Schema<unknown> | undefined = undefined,
  BS extends Schema<unknown> | undefined = undefined,
  RS extends Schema<unknown> = Schema<unknown>,
>(spec: RouteSpec<PS, QS, BS, RS>): Route {
  return spec as unknown as Route;
}

interface Compiled {
  route: Route;
  regex: RegExp;
  names: string[];
}

export interface Match {
  route: Route;
  params: Record<string, string>;
}

export class Router {
  private readonly compiled: Compiled[];

  constructor(readonly routes: readonly Route[]) {
    const seen = new Set<string>();
    this.compiled = routes.map((r) => {
      const key = r.method + ' ' + r.path.replace(/:[^/]+/g, ':');
      if (seen.has(key)) throw new Error('Duplicate route: ' + r.method + ' ' + r.path);
      seen.add(key);
      const names: string[] = [];
      const pattern = r.path
        .split('/')
        .map((seg) => {
          if (seg.startsWith(':')) {
            names.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/');
      return { route: r, regex: new RegExp('^' + pattern + '/?$'), names };
    });
  }

  /** The route for method + path, or the methods the path does allow (for a 405), or nothing (404). */
  match(method: string, pathname: string): { match: Match } | { allowed: Method[] } | null {
    const allowed: Method[] = [];
    for (const c of this.compiled) {
      const m = c.regex.exec(pathname);
      if (!m) continue;
      if (c.route.method !== method) {
        allowed.push(c.route.method);
        continue;
      }
      const params: Record<string, string> = {};
      c.names.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1] ?? '');
      });
      return { match: { route: c.route, params } };
    }
    return allowed.length ? { allowed } : null;
  }
}
