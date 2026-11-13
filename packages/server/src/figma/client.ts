// ── [PCODE-297 | S15 | v0.1.0] T30.10 Figma two-way sync: variables and components, tested against recorded Figma answers ──
//    Why:  the three calls of Figma's REST API the sync needs: the file's local variables, its published
//          components, and writing variables. The address can point elsewhere (a recorded Figma in tests,
//          a proxy), never at plain http beyond this machine; the token goes only in Figma's header.
import type { FigmaComponent, FigmaPostBody, FigmaVariablesAnswer } from '@orqiva/shared';

export const FIGMA_API = 'https://api.figma.com';

export class FigmaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface FigmaConn {
  fileKey: string;
  token: string;
  apiUrl: string | null;
}

/** What Figma's refusals mean for the person connecting. */
export function figmaProblem(status: number, said: string): string {
  if (status === 401) return 'Figma does not accept the access token';
  if (status === 403)
    return (
      'Figma refused (' +
      (said || 'forbidden') +
      '). Variables need a Figma Enterprise plan and a token with file_variables:read (and :write to send)'
    );
  if (status === 404) return 'Figma does not know this file, or the token cannot open it';
  if (status === 429) return 'Figma asks to slow down; try again in a minute';
  return 'Figma answered ' + String(status) + (said ? ': ' + said : '');
}

async function call<T>(
  conn: FigmaConn,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const base = (conn.apiUrl ?? FIGMA_API).replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetchImpl(base + path, {
      method,
      headers: {
        'X-Figma-Token': conn.token,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
  } catch {
    throw new FigmaError('Figma cannot be reached', 502);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const said =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : data && typeof data === 'object' && 'err' in data && typeof data.err === 'string'
          ? data.err
          : '';
    throw new FigmaError(figmaProblem(res.status, said.slice(0, 200)), res.status);
  }
  return data as T;
}

const file = (conn: FigmaConn): string => '/v1/files/' + encodeURIComponent(conn.fileKey);

export const figmaVariables = (conn: FigmaConn, f?: typeof fetch): Promise<FigmaVariablesAnswer> =>
  call<FigmaVariablesAnswer>(conn, 'GET', file(conn) + '/variables/local', undefined, f);

export async function figmaComponents(
  conn: FigmaConn,
  f?: typeof fetch,
): Promise<FigmaComponent[]> {
  const r = await call<{ meta?: { components?: FigmaComponent[] } }>(
    conn,
    'GET',
    file(conn) + '/components',
    undefined,
    f,
  );
  return r.meta?.components ?? [];
}

export const figmaWriteVariables = (
  conn: FigmaConn,
  body: FigmaPostBody,
  f?: typeof fetch,
): Promise<{ meta?: { tempIdToRealId?: Record<string, string> } }> =>
  call(conn, 'POST', file(conn) + '/variables', body, f);
