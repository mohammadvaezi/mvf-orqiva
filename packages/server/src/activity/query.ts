// ── [PCODE-438 | S15 | v0.1.0] T37 medium: Activity text search uses its index under row-level security ──
// ── [PCODE-413 | S15 | v0.1.0] T37 high: Activity facets answer under 1 s ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-183 | S15 | v0.1.0] B6.1 Activity at scale live: search, query language, facets, histogram, saved views, export, archive, hash chain, webhooks ──
//    Why:  the activity query language as SQL: one WHERE clause that the search, the facets, the
//          histogram, exports and webhooks all share, with the caller's visibility (a guest only sees the
//          events of their projects) built in and every value passed as a parameter.
import type { ActivityQuery } from '@orqiva/shared';

const ACTOR_KINDS: Record<string, string> = {
  user: 'user',
  person: 'user',
  people: 'user',
  agent: 'agent',
  agents: 'agent',
  system: 'system',
  integration: 'integration',
};
const TYPE_ALIASES: Record<string, string> = { task: 'item', run: 'agent_run', test: 'test_run' };

export interface Scope {
  workspaceId: string;
  role: string;
  userId: string;
  mode: 'all' | 'mine';
  from?: Date | null;
  to?: Date | null;
}

/** The events of both tiers, or of the hot table only. */
export const EVENTS_FROM = (archive: boolean): string =>
  archive
    ? '(SELECT *, false AS archived FROM activity_events UNION ALL SELECT *, true AS archived FROM activity_archive) e'
    : '(SELECT *, false AS archived FROM activity_events) e';

// [PCODE-413 | S15 | v0.1.0]
/** WHERE clause over the hourly counts (activity_rollup e), or null when the query needs the events
 *  themselves: free text, an actor's name, "mine", or a time window. */
export function rollupWhereOf(
  q: ActivityQuery,
  scope: Scope,
  now: Date = new Date(),
): { sql: string; params: unknown[]; edges: { from: Date; to: Date }[] } | null {
  if (scope.mode === 'mine') return null;
  const params: unknown[] = [];
  const p = (v: unknown): string => {
    params.push(v);
    return '$' + String(params.length);
  };
  const parts: string[] = ['e.workspace_id = ' + p(scope.workspaceId)];
  // a window: its whole hours here, the partial hours at its edges for the events
  const edges: { from: Date; to: Date }[] = [];
  const since = q.sinceHours !== null ? new Date(now.getTime() - q.sinceHours * 3_600_000) : null;
  const lo =
    since && scope.from ? (since > scope.from ? since : scope.from) : (since ?? scope.from);
  const hi = scope.to ?? (lo ? now : undefined);
  if (lo && hi) {
    const hour = 3_600_000;
    const first = new Date(Math.ceil(lo.getTime() / hour) * hour);
    const last = new Date(Math.floor(hi.getTime() / hour) * hour);
    if (first >= last) return null;
    if (lo < first) edges.push({ from: lo, to: first });
    if (last < hi) edges.push({ from: last, to: hi });
    parts.push('e.hour >= ' + p(first), 'e.hour < ' + p(last));
  } else if (scope.to) return null;
  if (!q.archive) parts.push('e.archived = false');
  if (!q.terms.some((t) => t.field === 'verb'))
    parts.push(
      "e.type NOT IN ('orqiva.agent_run.progressed', 'orqiva.deploy.progressed', 'orqiva.test_run.progressed')",
    );
  if (scope.role === 'guest')
    parts.push(
      'e.project_id IN (SELECT pr.id::text FROM projects pr WHERE guest_sees_project(pr.id, ' +
        p(scope.userId) +
        '::uuid))',
    );
  for (const t of q.terms) {
    let c: string;
    if (t.field === 'actor') {
      const kind = ACTOR_KINDS[t.value];
      if (!kind) return null;
      c = 'e.actor_kind = ' + p(kind);
    } else if (t.field === 'project')
      c =
        'e.project_id IN (SELECT pr.id::text FROM projects pr WHERE lower(pr.key) = ' +
        p(t.value) +
        ' OR lower(pr.name) = ' +
        p(t.value) +
        ')';
    else if (t.field === 'type') c = 'e.object_type = ' + p(TYPE_ALIASES[t.value] ?? t.value);
    else if (t.field === 'verb') c = 'e.verb = ' + p(t.value);
    else return null;
    parts.push(t.not ? 'NOT (' + c + ')' : c);
  }
  return { sql: parts.join(' AND '), params, edges };
}

/** WHERE clause and parameters for a query in a scope; `start` is the first parameter number. */
export function whereOf(
  q: ActivityQuery,
  scope: Scope,
  start = 1,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const p = (v: unknown): string => {
    params.push(v);
    return '$' + String(start + params.length - 1);
  };
  const ws = p(scope.workspaceId);
  const parts: string[] = ['e.workspace_id = ' + ws];
  // a run's, a deploy's and a test run's single steps are for their own pages unless asked for
  if (!q.terms.some((t) => t.field === 'verb'))
    parts.push(
      "e.type NOT IN ('orqiva.agent_run.progressed', 'orqiva.deploy.progressed', 'orqiva.test_run.progressed')",
    );
  if (scope.role === 'guest')
    parts.push(
      'e.project_id IN (SELECT pr.id::text FROM projects pr WHERE guest_sees_project(pr.id, ' +
        p(scope.userId) +
        '::uuid))',
    );
  if (scope.mode === 'mine') {
    const me = p(scope.userId);
    parts.push(
      `(e.actor_id = ${me}::text
        OR (e.object_type = 'item' AND e.object_id IN (SELECT i.id::text FROM items i WHERE i.assignee_id = ${me}::uuid OR i.created_by = ${me}::uuid))
        OR (e.parent_type = 'item' AND e.parent_id IN (SELECT i.id::text FROM items i WHERE i.assignee_id = ${me}::uuid OR i.created_by = ${me}::uuid)))`,
    );
  }
  if (q.sinceHours !== null)
    parts.push(
      'e.time > now() - make_interval(secs => ' + p(Math.round(q.sinceHours * 3600)) + ')',
    );
  if (scope.from) parts.push('e.time >= ' + p(scope.from));
  if (scope.to) parts.push('e.time < ' + p(scope.to));
  for (const t of q.terms) {
    let c: string;
    if (t.field === 'actor') {
      const kind = ACTOR_KINDS[t.value];
      c = kind
        ? 'e.actor_kind = ' + p(kind)
        : "lower(e.envelope->'data'->'actor'->>'name') LIKE " + p('%' + t.value + '%');
    } else if (t.field === 'project')
      c =
        'e.project_id IN (SELECT pr.id::text FROM projects pr WHERE lower(pr.key) = ' +
        p(t.value) +
        ' OR lower(pr.name) = ' +
        p(t.value) +
        ')';
    else if (t.field === 'type') c = 'e.object_type = ' + p(TYPE_ALIASES[t.value] ?? t.value);
    else if (t.field === 'verb') c = "e.envelope->'data'->>'verb' = " + p(t.value);
    else {
      const words = t.value
        .split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}_-]/gu, ''))
        .filter(Boolean);
      if (!words.length) continue;
      // [PCODE-438 | S15 | v0.1.0] the matching numbers from the side table, whose index a search can use
      c =
        '(e.workspace_id, e.sequence) IN (SELECT s.workspace_id, s.sequence FROM activity_search s WHERE s.workspace_id = ' +
        ws +
        "::uuid AND s.search @@ to_tsquery('simple', " +
        p(words.map((w) => w + ':*').join(' & ')) +
        '))';
    }
    parts.push(t.not ? 'NOT (' + c + ')' : c);
  }
  return { sql: parts.join(' AND '), params };
}
