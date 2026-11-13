// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
//    Why:  everything the app says to the server, without React Native in it, so it is tested in Node:
//          redeeming a pairing code, the newest page of events, signing out, and the live socket's
//          address. The device token goes in the Authorization header, on the socket too. A 401 means
//          the token was revoked or ran out: the app is signed out.
import { LIVE_PATH, type ActivityEvent } from '@orqiva/shared';

export interface Session {
  server: string;
  token: string;
  tokenId: string;
  expiresAt: string | null;
  workspace: { id: string; name: string };
  user: { id: string; name: string; email: string };
}

/** The server said this phone is no longer signed in. */
export class SignedOutError extends Error {
  constructor() {
    super('This phone is no longer signed in');
    this.name = 'SignedOutError';
  }
}

type Fetch = typeof fetch;

const str = (v: unknown): v is string => typeof v === 'string';

/** A stored session, if it is complete; anything else counts as signed out. */
export function readSession(text: string | null): Session | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const ws = s['workspace'] as Record<string, unknown> | undefined;
  const user = s['user'] as Record<string, unknown> | undefined;
  if (
    !str(s['server']) ||
    !str(s['token']) ||
    !str(s['tokenId']) ||
    !ws ||
    !str(ws['id']) ||
    !str(ws['name']) ||
    !user ||
    !str(user['id']) ||
    !str(user['name']) ||
    !str(user['email'])
  )
    return null;
  return {
    server: s['server'],
    token: s['token'],
    tokenId: s['tokenId'],
    expiresAt: str(s['expiresAt']) ? s['expiresAt'] : null,
    workspace: { id: ws['id'], name: ws['name'] },
    user: { id: user['id'], name: user['name'], email: user['email'] },
  };
}

/** The message of an error answer, or a sentence for the status. */
async function problem(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // not JSON: fall through
  }
  return 'The server answered ' + String(res.status);
}

/** Redeems a pairing code for this phone's session. */
export async function pair(
  server: string,
  code: string,
  device: string,
  fetchImpl: Fetch = fetch,
): Promise<Session> {
  let res: Response;
  try {
    res = await fetchImpl(server + '/auth/devices/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, device }),
    });
  } catch {
    throw new Error('Cannot reach ' + server + '. Check the address and the network.');
  }
  if (!res.ok) throw new Error(await problem(res));
  const body = (await res.json()) as Omit<Session, 'server'>;
  const session = readSession(JSON.stringify({ ...body, server }));
  if (!session) throw new Error('The server’s answer was not understood');
  return session;
}

const authed = (s: Session): Record<string, string> => ({ authorization: 'Bearer ' + s.token });

/** The newest events, oldest first, and the sequence to follow on from. */
export async function fetchPage(
  s: Session,
  limit = 100,
  fetchImpl: Fetch = fetch,
): Promise<{ sequence: number; events: ActivityEvent[] }> {
  const res = await fetchImpl(
    s.server + '/api/workspaces/' + s.workspace.id + '/activity?limit=' + String(limit),
    { headers: authed(s) },
  );
  if (res.status === 401) throw new SignedOutError();
  if (!res.ok) throw new Error(await problem(res));
  return (await res.json()) as { sequence: number; events: ActivityEvent[] };
}

/** Revokes this phone's token. Best effort: signing out on the phone never waits for the network. */
export async function revoke(s: Session, fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(
      s.server + '/api/workspaces/' + s.workspace.id + '/access-tokens/' + s.tokenId + '/revoke',
      { method: 'POST', headers: authed(s) },
    );
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}

// [PCODE-228 | S15 | v0.1.0] every other call the app makes: JSON in and out, the device token, 401 is signed out
/** A failed call, with the server's message and status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function call<T>(
  s: Session,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  fetchImpl: Fetch = fetch,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(s.server + path, {
      method,
      headers: {
        ...authed(s),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('No network', 0);
  }
  if (res.status === 401) throw new SignedOutError();
  if (!res.ok) throw new ApiError(await problem(res), res.status);
  return (await res.json()) as T;
}

/** A socket address on the server: ws:// or wss:// on its host and path; the live endpoint by default. */
export const socketUrl = (server: string, path: string = LIVE_PATH): string =>
  server.replace(/^http(s?):\/\//i, (_m, tls: string) => 'ws' + tls + '://') + path;

/** Plain HTTP is only for a server on the local network; elsewhere the token would travel readable. */
export function insecureServer(server: string): boolean {
  let u: URL;
  try {
    u = new URL(server);
  } catch {
    return true;
  }
  if (u.protocol === 'https:') return false;
  const h = u.hostname;
  return !(
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.endsWith('.local') ||
    h === 'localhost'
  );
}
