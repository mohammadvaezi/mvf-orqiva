// ── [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code ──
// ── [PCODE-239 | S15 | v0.1.0] orq reaches a local server over IPv4 when localhost's IPv6 hangs ──
// ── [PCODE-195 | S15 | v0.1.0] B8.3 CLI parity: inbox, approvals, comments, time, agents and ideas from the terminal, offline queue ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-103 | S15 | v0.1.0] Build the CLI `orq` and the Claude Code hooks against the new server ──
//    Why:  orq's way to the server: the personal token as a Bearer header, a timeout so a hook never hangs a
//          session, and the server's error message passed on as it is. Progress reports that cannot reach
//          the server wait in an offline queue and go out with the next command.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { statePath } from './config.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** status 0: the server could not be reached */
export const offline = (e: unknown): boolean => e instanceof ApiError && e.status === 0;

/**
 * [PCODE-239 | S15 | v0.1.0] A server on this machine, reached over IPv4. "localhost" may resolve to IPv6
 * first, and some port forwarding (Docker on Windows) accepts there and then never answers. A server that
 * listens on every address answers on 127.0.0.1 too. Plain HTTP only: an HTTPS certificate names the host.
 * The address as configured stays the key of the saved token.
 */
export const viaIPv4 = (url: string): string =>
  url.replace(/^(http:\/\/)localhost(?=[:/]|$)/i, (_m, scheme: string) => scheme + '127.0.0.1');

// [PCODE-272 | S15 | v0.1.0] bytes sent as they are (a file upload), not as JSON
export class RawBody {
  constructor(
    readonly data: Uint8Array,
    readonly type: string,
  ) {}
}

export interface Api {
  call<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T>;
}

export function makeApi(server: string, token: string, fetchImpl: typeof fetch = fetch): Api {
  return {
    async call<T>(method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
      let res: Response;
      try {
        res = await fetchImpl(viaIPv4(server.replace(/\/$/, '') + path), {
          method,
          headers: {
            authorization: 'Bearer ' + token,
            ...(body instanceof RawBody
              ? { 'content-type': body.type }
              : body !== undefined
                ? { 'content-type': 'application/json' }
                : {}),
          },
          ...(body instanceof RawBody
            ? { body: new Uint8Array(body.data) }
            : body !== undefined
              ? { body: JSON.stringify(body) }
              : {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new ApiError(
          0,
          'Cannot reach ' +
            server +
            ' (' +
            (err instanceof Error ? err.message : String(err)) +
            ')',
        );
      }
      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        // not JSON: reported below
      }
      if (!res.ok) {
        const e = (
          json as
            | { error?: { message?: string; details?: { path: string; message: string }[] } }
            | undefined
        )?.error;
        const detail = e?.details?.length
          ? ' (' +
            e.details.map((d) => d.path.replace(/^body\./, '') + ' ' + d.message).join('; ') +
            ')'
          : '';
        // [PCODE-195 | S15 | v0.1.0] a route the server lacks: most likely a server older than orq
        const older =
          res.status === 404 && /^No route for /.test(e?.message ?? '')
            ? ' — ' + server + ' may be older than this orq; upgrade it with orq install'
            : '';
        throw new ApiError(
          res.status,
          (e?.message ?? 'The server answered ' + String(res.status)) + detail + older,
        );
      }
      // [PCODE-195 | S15 | v0.1.0] an older server answered a route it lacks with its web page
      if (text && json === undefined)
        throw new ApiError(
          404,
          server +
            ' does not know ' +
            method +
            ' ' +
            path.replace(/\?.*$/, '') +
            ' (it answered with a web page): it may be older than this orq; upgrade it with orq install',
        );
      return json as T;
    },
  };
}

interface Queued {
  method: string;
  path: string;
  body: unknown;
  at: string;
}

const queueFile = (root: string): string => statePath(root, 'queue.jsonl');

export function enqueue(root: string, method: string, path: string, body: unknown): void {
  appendFileSync(
    queueFile(root),
    JSON.stringify({ method, path, body, at: new Date().toISOString() } satisfies Queued) + '\n',
  );
}

export function queueLength(root: string): number {
  if (!existsSync(queueFile(root))) return 0;
  return readFileSync(queueFile(root), 'utf8').split('\n').filter(Boolean).length;
}

/** Sends what waited, oldest first; stops at the first network failure. Returns [sent, left]. */
export async function flushQueue(
  root: string,
  api: Api,
  budgetMs = 15_000,
): Promise<[number, number]> {
  if (!existsSync(queueFile(root))) return [0, 0];
  const entries = readFileSync(queueFile(root), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Queued);
  const until = Date.now() + budgetMs;
  let sent = 0;
  for (const e of entries) {
    if (Date.now() > until) break;
    try {
      await api.call(e.method, e.path, e.body, 5000);
    } catch (err) {
      if (offline(err)) break;
      // refused by the server (task finished meanwhile, …): drop it, it can never succeed
    }
    sent++;
  }
  const left = entries.slice(sent);
  writeFileSync(queueFile(root), left.map((e) => JSON.stringify(e) + '\n').join(''));
  return [sent, left.length];
}

/** Sends now if possible; keeps it for later if the network is gone. */
export async function sendOrQueue(
  root: string,
  api: Api,
  method: string,
  path: string,
  body: unknown,
): Promise<boolean> {
  try {
    await api.call(method, path, body, 5000);
    return true;
  } catch (err) {
    if (offline(err)) {
      enqueue(root, method, path, body);
      return false;
    }
    throw err;
  }
}
