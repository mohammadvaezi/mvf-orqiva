// ── [PCODE-65 | S13 | v0.1.0] Build the multi-project dashboard panel across the Plane workspace ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  a dashboard over a workspace is the one place in this extension that can hammer Plane: three
//          reads per project, and the workspace decides how many projects there are. So the rows are
//          cached for five minutes, the projects are read one after another (never Promise.all, which
//          would queue the whole workspace into the throttle at once), and a project that fails becomes
//          a row carrying its error instead of losing the nine that worked.
import type { PlaneClient } from '../plane/client';
import type { Project } from '../plane/types';
import { buildRow, EMPTY_COUNTS, type ProjectRow } from './aggregate';

export const CACHE_TTL_MS = 5 * 60_000;

interface Entry {
  row: ProjectRow;
  at: number;
}

export interface DashboardDeps {
  client: Pick<PlaneClient, 'getProjects' | 'getIssues' | 'getStates' | 'getCycles' | 'webUrl'>;
  /** identifier -> local folder, from globalState */
  folders?: Record<string, string>;
  now?: () => number;
  ttlMs?: number;
  /** called after each row so the panel can fill in as the rows arrive */
  onRow?: (row: ProjectRow) => void;
  log?: (line: string) => void;
}

// ── [PCODE-65 | S13 | v0.1.0] Dashboard: holds the cache across refreshes of the panel ──
export class Dashboard {
  private readonly cache = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly ttl: number;

  constructor(private readonly deps: DashboardDeps) {
    this.now = deps.now ?? Date.now;
    this.ttl = deps.ttlMs ?? CACHE_TTL_MS;
  }

  /** number of projects currently held, for the tests and the panel's "cached" note */
  get cachedCount(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  // ── [PCODE-65 | S13 | v0.1.0] rows: projects once, then each project in turn, cache first ──
  async rows(force = false): Promise<ProjectRow[]> {
    const projects = await this.deps.client.getProjects();
    const out: ProjectRow[] = [];
    for (const project of projects) {
      const row = await this.row(project, force);
      out.push(row);
      this.deps.onRow?.(row);
    }
    return out;
  }

  private async row(project: Project, force: boolean): Promise<ProjectRow> {
    const hit = this.cache.get(project.id);
    if (!force && hit && this.now() - hit.at < this.ttl) return hit.row;
    const folder = this.deps.folders?.[project.identifier];
    let row: ProjectRow;
    try {
      const [issues, states, cycles] = [
        await this.deps.client.getIssues(project.id),
        await this.deps.client.getStates(project.id),
        await this.deps.client.getCycles(project.id),
      ];
      row = buildRow({
        project,
        issues,
        states,
        cycles,
        boardUrl: this.deps.client.webUrl(project.id),
        now: new Date(this.now()),
        ...(folder ? { folder } : {}),
      });
    } catch (e) {
      // [PCODE-65 | S13 | v0.1.0] one unreadable project must not empty the dashboard
      this.deps.log?.(`dashboard: ${project.identifier} failed: ${String(e)}`);
      row = {
        id: project.id,
        identifier: project.identifier,
        name: project.name,
        counts: { ...EMPTY_COUNTS },
        sprint: null,
        lastActivity: null,
        boardUrl: this.deps.client.webUrl(project.id),
        ...(folder ? { folder } : {}),
        error: e instanceof Error ? e.message : String(e),
      };
    }
    this.cache.set(project.id, { row, at: this.now() });
    return row;
  }
}
