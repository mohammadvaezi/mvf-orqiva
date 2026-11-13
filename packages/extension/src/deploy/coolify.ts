// ── [PCODE-56 | S11 | v0.1.0] Implement the Coolify adapter: trigger a deploy and poll the deployment status ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  Coolify's API v1 answers a deploy request with a uuid and nothing else; whether the deployment
//          worked is only visible by asking for that uuid again. So: one POST, then a poll every five
//          seconds, and every HTTP failure turned into a sentence that says what to change.
import type { DeployTarget } from './targets';

export const POLL_INTERVAL_MS = 5000;
export const DEPLOY_LIMIT_MS = 15 * 60 * 1000;
/** the Coolify API this adapter speaks (documented in architecture.md, "External systems") */
export const API = 'v1';

export interface HttpResponse {
  status: number;
  text: string;
}

export type HttpLike = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<HttpResponse>;

export type DeployStatus =
  'queued' | 'in_progress' | 'finished' | 'failed' | 'cancelled' | 'unknown';

export interface DeployHandle {
  uuid: string;
  /** what Coolify said when it accepted the request */
  message: string;
}

export interface CoolifyDeps {
  target: DeployTarget;
  token: string;
  http: HttpLike;
  onLine?: (line: string) => void;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  intervalMs?: number;
  limitMs?: number;
  stop?: () => boolean;
}

export function baseUrl(target: DeployTarget): string {
  return (target.url ?? '').replace(/\/+$/, '');
}

// ── [PCODE-56 | S11 | v0.1.0] explain: an HTTP answer becomes the sentence that names the fix ──
export function explain(status: number, body: string): string {
  const detail = body.trim().slice(0, 200);
  switch (status) {
    case 401:
    case 403:
      return '401: token rejected — check the Coolify API token of this target.';
    case 404:
      return '404: application uuid not found — check the uuid in the target.';
    case 422:
      return `422: Coolify refused the request${detail ? ` — ${detail}` : ''}.`;
    case 429:
      return '429: Coolify is rate limiting — try again in a minute.';
    default:
      return `${String(status)}: Coolify answered unexpectedly${detail ? ` — ${detail}` : ''}.`;
  }
}

function parse(body: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(body);
    if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? {};
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pick(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function statusOf(row: Record<string, unknown>): DeployStatus {
  const raw = pick(row, 'status', 'state').toLowerCase();
  if (!raw) return 'unknown';
  if (/finish|success|done/.test(raw)) return 'finished';
  if (/fail|error/.test(raw)) return 'failed';
  if (/cancel/.test(raw)) return 'cancelled';
  if (/progress|running|deploy/.test(raw)) return 'in_progress';
  if (/queue|pending/.test(raw)) return 'queued';
  return 'unknown';
}

const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
});

// ── [PCODE-56 | S11 | v0.1.0] trigger: POST /api/v1/deploy?uuid=…&force=false -> the deployment uuid ──
export async function trigger(deps: CoolifyDeps): Promise<DeployHandle> {
  const appUuid = typeof deps.target.appUuid === 'string' ? deps.target.appUuid : '';
  const url = `${baseUrl(deps.target)}/api/${API}/deploy?uuid=${encodeURIComponent(appUuid)}&force=false`;
  // the token never reaches a log: the line shows the address only
  deps.onLine?.(`> POST ${url}`);
  const res = await deps.http(url, { method: 'POST', headers: authHeaders(deps.token) });
  if (res.status < 200 || res.status >= 300) throw new Error(explain(res.status, res.text));
  const row = parse(res.text);
  const deployments = row['deployments'];
  const first =
    Array.isArray(deployments) && deployments.length
      ? ((deployments[0] as Record<string, unknown> | undefined) ?? {})
      : row;
  const uuid = pick(first, 'deployment_uuid', 'uuid', 'id');
  if (!uuid)
    throw new Error(
      'Coolify accepted the deploy but named no deployment — check the app in Coolify.',
    );
  const message = pick(first, 'message') || 'deployment queued';
  deps.onLine?.(`Coolify: ${message} (${uuid})`);
  return { uuid, message };
}

export interface DeployOutcome {
  uuid: string;
  status: DeployStatus;
  ms: number;
  /** the last line Coolify gave for the deployment */
  detail: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── [PCODE-56 | S11 | v0.1.0] poll: GET /api/v1/deployments/<uuid> until it finishes, fails or times out ──
export async function poll(handle: DeployHandle, deps: CoolifyDeps): Promise<DeployOutcome> {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? sleep;
  const interval = deps.intervalMs ?? POLL_INTERVAL_MS;
  const limit = deps.limitMs ?? DEPLOY_LIMIT_MS;
  const started = now();
  const url = `${baseUrl(deps.target)}/api/${API}/deployments/${encodeURIComponent(handle.uuid)}`;
  let status: DeployStatus = 'queued';
  let detail = handle.message;
  let last = '';
  for (;;) {
    const res = await deps.http(url, { method: 'GET', headers: authHeaders(deps.token) });
    if (res.status < 200 || res.status >= 300) throw new Error(explain(res.status, res.text));
    const row = parse(res.text);
    status = statusOf(row);
    detail = pick(row, 'status', 'state') || detail;
    const line = `Coolify: ${detail}`;
    if (line !== last) {
      deps.onLine?.(line);
      last = line;
    }
    if (status === 'finished' || status === 'failed' || status === 'cancelled') break;
    if (deps.stop?.()) {
      status = 'cancelled';
      detail = 'stopped watching';
      break;
    }
    if (now() - started >= limit) {
      throw new Error(
        `Coolify did not finish within ${String(Math.round(limit / 60000))} minutes — look at the deployment in Coolify.`,
      );
    }
    await wait(interval);
  }
  return { uuid: handle.uuid, status, ms: now() - started, detail };
}

// ── [PCODE-56 | S11 | v0.1.0] deployToCoolify: trigger, then watch, as one call for the panel ──
export async function deployToCoolify(deps: CoolifyDeps): Promise<DeployOutcome> {
  const handle = await trigger(deps);
  const outcome = await poll(handle, deps);
  if (outcome.status === 'failed')
    throw Object.assign(new Error(`Coolify reported the deployment as failed (${outcome.uuid}).`), {
      outcome,
    });
  return outcome;
}
