// ── [PCODE-356 | S15 | v0.1.0] T35.5a Translation layer for a German UI, language choice, text extraction ──
// ── [PCODE-164 | S15 | v0.1.0] B1.3 The v2 shell live in the web app: Home per role, Inbox, Clients, portal mode, settings ──
// ── [PCODE-90 | S15 | v0.1.0] Build the web app shell with login and the ported design system ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
//    Why:  every server call goes through here, so every screen handles the one error shape the server
//          sends ({ error: { code, message, details } }) the same way, and network failures too.

export interface ApiIssue {
  path: string;
  message: string;
}

export interface ApiError {
  status: number;
  code: string;
  message: string;
  details: ApiIssue[];
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  role: string;
  /** [PCODE-164 | S15 | v0.1.0] set when the person sees this workspace as a client's contact */
  client?: { id: string; name: string; portalRoles: string[]; language?: string } | null; // [PCODE-356 | S15 | v0.1.0]
}

export interface Me {
  user: User;
  workspaces: Workspace[];
}

export async function api<T>(
  // [PCODE-96 | S15 | v0.1.0] items are changed and deleted too
  // [PCODE-122 | S15 | v0.1.0] PUT: settings replaced whole (the AI provider)
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return {
      ok: false,
      error: {
        status: 0,
        code: 'network',
        message: 'Cannot reach the server. Check the connection and try again.',
        details: [],
      },
    };
  }
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // not JSON: a proxy page or a crash; reported below as a server error
  }
  if (res.ok) return { ok: true, data: json as T };
  const e = (json as { error?: Partial<ApiError> } | undefined)?.error;
  return {
    ok: false,
    error: {
      status: res.status,
      code: e?.code ?? 'internal',
      message: e?.message ?? 'The server answered ' + String(res.status) + '.',
      details: Array.isArray(e?.details) ? e.details : [],
    },
  };
}

/** Field errors from a 400, keyed by form field ("body.email" -> "email"). */
export function fieldErrors(error: ApiError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of error.details) {
    const field = d.path.replace(/^body\./, '');
    out[field] ??= d.message.charAt(0).toUpperCase() + d.message.slice(1) + '.';
  }
  return out;
}
