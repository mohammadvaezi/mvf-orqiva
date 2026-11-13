// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-12 | S02 | v0.1.0] Add a read-only Plane REST client with SecretStorage key and 20 req/min throttle ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the extension only READS Plane (criticals #2); every write goes through the engine. GET-only by
//          construction: there is no method that sends another verb. Pagination follows next_cursor like
//          plane_common.get_all. `fetch` is injected for tests.
import { OrqivaError } from '../util/errors';
import { redact } from '../util/redact';
import { Throttle } from './throttle';
import type { Comment, Cycle, CycleIssue, Issue, Label, Project, State } from './types';

export interface FetchResponse {
  status: number;
  headers: Record<string, string | undefined>;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<FetchResponse>;

export interface ClientOptions {
  baseUrl: string;
  workspace: string;
  apiKey: () => Promise<string | undefined>;
  fetch?: FetchLike;
  throttle?: Throttle;
  log?: (line: string) => void;
}

interface Page<T> {
  results?: T[];
  next_cursor?: string | null;
  next_page_results?: boolean;
}

// ── [PCODE-12 | S02 | v0.1.0] PlaneClient: GET-only; one private request path, typed public readers ──
export class PlaneClient {
  private readonly fetchImpl: FetchLike;
  private readonly throttle: Throttle;
  private readonly log: (line: string) => void;

  constructor(private readonly opts: ClientOptions) {
    this.fetchImpl = opts.fetch ?? defaultFetch;
    this.throttle = opts.throttle ?? new Throttle();
    this.log = opts.log ?? (() => undefined);
  }

  get base(): string {
    return `${this.opts.baseUrl.replace(/\/+$/, '')}/api/v1/workspaces/${this.opts.workspace}`;
  }

  webUrl(projectId: string, issueId?: string): string {
    const u = `${this.opts.baseUrl.replace(/\/+$/, '')}/${this.opts.workspace}/projects/${projectId}/issues/`;
    return issueId ? `${u}${issueId}/` : u;
  }

  // ── [PCODE-12 | S02 | v0.1.0] get: throttled GET with 429 back-off; the only network call in the class ──
  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const key = await this.opts.apiKey();
    // [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names
    if (!key)
      throw new OrqivaError('The legacy tracker is not connected: no API key stored.', 'config');
    const qs = new URLSearchParams(params).toString();
    const url = `${this.base}${path}${qs ? `?${qs}` : ''}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.throttle.acquire();
      let res: FetchResponse;
      try {
        res = await this.fetchImpl(url, {
          headers: { 'X-API-Key': key, Accept: 'application/json' },
        });
      } catch (e) {
        throw new OrqivaError(`Legacy tracker unreachable: ${redact(String(e))}`, 'network');
      }
      if (res.status === 429) {
        const ms = this.throttle.backOff(res.headers);
        this.log(`Legacy tracker rate limited; waiting ${Math.round(ms / 1000)} s`);
        continue;
      }
      const text = await res.text();
      if (res.status >= 400) {
        throw new OrqivaError(
          `Legacy tracker GET ${path} failed (${res.status}).`,
          res.status === 401 || res.status === 403 ? 'config' : 'network',
          redact(text.slice(0, 300)),
        );
      }
      return (text ? JSON.parse(text) : null) as T;
    }
    throw new OrqivaError('Legacy tracker rate limit did not clear.', 'network');
  }

  // ── [PCODE-12 | S02 | v0.1.0] getAll: follow next_cursor pages (per_page=100) in order ──
  private async getAll<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.get<Page<T> | T[]>(path, {
        ...params,
        per_page: '100',
        ...(cursor ? { cursor } : {}),
      });
      if (Array.isArray(page)) return page;
      out.push(...(page.results ?? []));
      if (!page.next_page_results || !page.next_cursor) return out;
      cursor = page.next_cursor;
    }
  }

  getProjects(): Promise<Project[]> {
    return this.getAll<Project>('/projects/');
  }
  getStates(projectId: string): Promise<State[]> {
    return this.getAll<State>(`/projects/${projectId}/states/`);
  }
  getLabels(projectId: string): Promise<Label[]> {
    return this.getAll<Label>(`/projects/${projectId}/labels/`);
  }
  getCycles(projectId: string): Promise<Cycle[]> {
    return this.getAll<Cycle>(`/projects/${projectId}/cycles/`);
  }
  async getCycleIssueIds(projectId: string, cycleId: string): Promise<string[]> {
    const rows = await this.getAll<CycleIssue>(
      `/projects/${projectId}/cycles/${cycleId}/cycle-issues/`,
    );
    return rows.map((r) => r.issue ?? r.issue_detail?.id ?? r.id);
  }
  getIssues(projectId: string): Promise<Issue[]> {
    return this.getAll<Issue>(`/projects/${projectId}/issues/`);
  }
  /** By id (UUID) within the project, or by readable ref (e.g. PCODE-12) workspace-wide. */
  getIssue(projectId: string, idOrRef: string): Promise<Issue> {
    return /^[A-Z]{2,5}-\d+$/.test(idOrRef)
      ? this.get<Issue>(`/issues/${idOrRef}/`)
      : this.get<Issue>(`/projects/${projectId}/issues/${idOrRef}/`);
  }
  getComments(projectId: string, issueId: string): Promise<Comment[]> {
    return this.getAll<Comment>(`/projects/${projectId}/issues/${issueId}/comments/`);
  }
}

// ── [PCODE-12 | S02 | v0.1.0] defaultFetch: Node's global fetch adapted to the small FetchLike surface ──
const defaultFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, { method: 'GET', headers: init.headers });
  const headers: Record<string, string | undefined> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return { status: res.status, headers, text: () => res.text() };
};
