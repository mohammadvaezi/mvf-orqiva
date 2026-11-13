// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
// ── [PCODE-147 | S15 | v0.1.0] Show the traceability graph from idea to deploy ──
//    Why:  every piece of delivered work traced back to the decision that asked for it, and forward to
//          where it runs: idea → signed proposal → tasks → acceptance criteria → tests and their results →
//          commits, pull requests and the files written (fingerprints) → findings → the deploys that
//          shipped it. Gaps are named: a criterion without a test, a task without code or without a test.
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { asMember, requireProject, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });

export const NODE_KINDS = [
  'idea',
  'proposal',
  'item',
  'criterion',
  'test',
  'commit',
  'pr',
  'file',
  'finding',
  'deploy',
  'defect', // [PCODE-315 | S15 | v0.1.0] a bug a test found
] as const;
type Kind = (typeof NODE_KINDS)[number];

const traceOut = s.object({
  nodes: s.array(
    s.object({
      id: s.string(),
      kind: s.string(),
      label: s.string(),
      sub: s.string(),
      status: s.string(),
      href: s.nullable(s.string()),
    }),
  ),
  edges: s.array(s.object({ from: s.string(), to: s.string() })),
  gaps: s.array(s.object({ node: s.string(), text: s.string() })),
});
export type Trace = Infer<typeof traceOut>;

class Graph {
  readonly nodes: Trace['nodes'] = [];
  readonly edges: Trace['edges'] = [];
  readonly gaps: Trace['gaps'] = [];
  private readonly seen = new Set<string>();
  node(
    id: string,
    kind: Kind,
    label: string,
    sub = '',
    status = '',
    href: string | null = null,
  ): string {
    if (!this.seen.has(id)) {
      this.seen.add(id);
      this.nodes.push({
        id,
        kind,
        label: label.slice(0, 120),
        sub: sub.slice(0, 160),
        status,
        href,
      });
    }
    return id;
  }
  edge(from: string, to: string): void {
    if (!this.edges.some((e) => e.from === from && e.to === to)) this.edges.push({ from, to });
  }
  gap(node: string, text: string): void {
    this.gaps.push({ node, text });
  }
}

/** One task's chain onto the graph: criteria, tests, code, findings, deploys. */
async function traceItem(c: PoolClient, g: Graph, itemId: string): Promise<string | null> {
  const it = (
    await c.query<{
      id: string;
      ref: string;
      title: string;
      state: string;
      grp: string;
      project_id: string;
      kind: string;
    }>(
      `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, st.name AS state, st.grp, i.project_id, i.kind
         FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id WHERE i.id = $1`,
      [itemId],
    )
  ).rows[0];
  if (!it) return null;
  const node = g.node('item:' + it.id, 'item', it.ref, it.title, it.state, '/items/' + it.id);

  const criteria = (
    await c.query<{ id: string; text: string; done: boolean }>(
      'SELECT id, text, done FROM item_criteria WHERE item_id = $1 ORDER BY position',
      [it.id],
    )
  ).rows;
  const tests = (
    await c.query<{
      id: string;
      title: string;
      criterion_id: string | null;
      status: string | null;
    }>(
      `SELECT tc.id, tc.title, tc.criterion_id,
              (SELECT r.status FROM test_results r WHERE r.case_id = tc.id ORDER BY r.at DESC LIMIT 1) AS status
         FROM test_cases tc WHERE tc.item_id = $1 ORDER BY tc.created_at`,
      [it.id],
    )
  ).rows;
  // [PCODE-315 | S15 | v0.1.0] the bugs the tests found: filed from a result, or reopened when done
  const defects = (
    await c.query<{ case_id: string; id: string; ref: string; title: string; state: string }>(
      `SELECT DISTINCT x.case_id, d.id, p.key || '-' || d.sequence AS ref, d.title, st.name AS state
         FROM (SELECT r.case_id, r.defect_item_id AS item FROM test_results r
                WHERE r.defect_item_id IS NOT NULL AND r.case_id = ANY($1::uuid[])
               UNION
               SELECT e.key::uuid, (e.value->>'defect')::uuid FROM test_runs t CROSS JOIN LATERAL jsonb_each(t.reopened) e
                WHERE e.key::uuid = ANY($1::uuid[])) x
         JOIN items d ON d.id = x.item JOIN projects p ON p.id = d.project_id JOIN project_states st ON st.id = d.state_id`,
      [tests.map((t) => t.id)],
    )
  ).rows;
  const withDefects = (testNode: string, caseId: string): string => {
    for (const d of defects.filter((x) => x.case_id === caseId))
      g.edge(
        testNode,
        g.node('defect:' + d.id, 'defect', d.ref, d.title, d.state, '/items/' + d.id),
      );
    return testNode;
  };
  for (const k of criteria) {
    const kn = g.node(
      'criterion:' + k.id,
      'criterion',
      k.text,
      '',
      k.done ? 'ticked' : 'open',
      '/items/' + it.id,
    );
    g.edge(node, kn);
    const mine = tests.filter((t) => t.criterion_id === k.id);
    if (!mine.length) g.gap(kn, 'No test checks this criterion');
    for (const t of mine)
      g.edge(
        kn,
        withDefects(g.node('test:' + t.id, 'test', t.title, '', t.status ?? 'not run', null), t.id),
      );
  }
  for (const t of tests.filter((x) => !x.criterion_id))
    g.edge(
      node,
      withDefects(g.node('test:' + t.id, 'test', t.title, '', t.status ?? 'not run', null), t.id),
    );
  // [PCODE-277 | S15 | v0.1.0] an epic is checked through the stories and tasks under it, not on its own
  if (it.kind !== 'epic' && it.kind !== 'initiative') {
    if (!criteria.length) g.gap(node, 'No acceptance criteria');
    if (!tests.length) g.gap(node, 'No test cases');
  }

  const links = (
    await c.query<{ kind: string; ref: string; title: string; url: string; state: string }>(
      'SELECT kind, ref, title, url, state FROM item_git_links WHERE item_id = $1 ORDER BY at',
      [it.id],
    )
  ).rows;
  for (const l of links)
    g.edge(
      node,
      g.node(
        (l.kind === 'commit' ? 'commit:' : 'pr:') + l.ref,
        l.kind === 'commit' ? 'commit' : 'pr',
        l.kind === 'commit' ? l.ref.slice(0, 9) : '#' + l.ref,
        l.title,
        l.state,
        l.url || null,
      ),
    );
  const files = (
    await c.query<{ path: string; lines: string; last: Date }>(
      'SELECT path, count(*) AS lines, max(recorded_at) AS last FROM item_fingerprints WHERE item_id = $1 GROUP BY path ORDER BY path',
      [it.id],
    )
  ).rows;
  for (const f of files)
    g.edge(
      node,
      g.node(
        'file:' + it.project_id + ':' + f.path,
        'file',
        f.path.split('/').pop() ?? f.path,
        f.path,
        f.lines + ' marks',
        null,
      ),
    );
  if (!files.length && !links.length && it.grp === 'completed')
    g.gap(node, 'Finished, but no code or commit is linked');

  const findings = (
    await c.query<{ id: string; title: string; severity: string; status: string }>(
      'SELECT id, title, severity, status FROM findings WHERE item_id = $1',
      [it.id],
    )
  ).rows;
  for (const f of findings)
    g.edge(
      node,
      g.node('finding:' + f.id, 'finding', f.title, f.severity, f.status, '/findings/' + f.id),
    );

  // shipped: the first successful deploy of each environment after the code was last written
  const last = files.reduce<Date | null>((m, f) => (!m || f.last > m ? f.last : m), null);
  if (last) {
    const deploys = (
      await c.query<{ id: string; env: string; finished_at: Date }>(
        `SELECT DISTINCT ON (d.environment_id) d.id, e.name AS env, d.finished_at
           FROM deploy_runs d JOIN environments e ON e.id = d.environment_id
          WHERE d.project_id = $1 AND d.status = 'succeeded' AND d.finished_at > $2
          ORDER BY d.environment_id, d.finished_at`,
        [it.project_id, last],
      )
    ).rows;
    for (const d of deploys) {
      const dn = g.node(
        'deploy:' + d.id,
        'deploy',
        d.env,
        d.finished_at.toISOString().slice(0, 16).replace('T', ' '),
        'deployed',
        '/deploys/' + d.id,
      );
      for (const f of files) g.edge('file:' + it.project_id + ':' + f.path, dn);
    }
  }
  return node;
}

/** An idea's chain: the idea, its signed proposal, and every task it became. */
async function traceIdea(c: PoolClient, g: Graph, ideaId: string): Promise<void> {
  const idea = (
    await c.query<{ id: string; title: string; status: string; ref: string }>(
      `SELECT i.id, i.title, i.status, p.key || '-I' || i.number AS ref FROM ideas i JOIN projects p ON p.id = i.project_id WHERE i.id = $1`,
      [ideaId],
    )
  ).rows[0];
  if (!idea) return;
  const node = g.node(
    'idea:' + idea.id,
    'idea',
    idea.ref,
    idea.title,
    idea.status,
    '/ideas/' + idea.id,
  );
  // [PCODE-277 | S15 | v0.1.0] the owner's latest signature, or the named approvers' signatures on the approved version
  const owner = (
    await c.query<{
      version: number;
      account_name: string;
      signed_at: Date;
    }>(
      `SELECT p.version, s.account_name, s.signed_at FROM proposal_signatures s
         JOIN proposals p ON p.id = s.proposal_id WHERE s.idea_id = $1 AND s.decision = 'approved'
        ORDER BY p.version DESC LIMIT 1`,
      [idea.id],
    )
  ).rows[0];
  const named =
    idea.status === 'approved'
      ? (
          await c.query<{ version: number; account_name: string | null; signed_at: Date | null }>(
            `SELECT (SELECT max(version) FROM proposals WHERE idea_id = $1) AS version,
                    string_agg(DISTINCT a.signed_name, ', ') AS account_name, max(a.created_at) AS signed_at
               FROM approvals a
              WHERE a.object_type = 'prd' AND a.object_id = $1::text AND a.decision = 'approved'
                AND a.version_hash = (SELECT version_hash FROM approvals WHERE object_type = 'prd' AND object_id = $1::text
                                       ORDER BY created_at DESC LIMIT 1)`,
            [idea.id],
          )
        ).rows[0]
      : undefined;
  const signed =
    owner ??
    (named?.account_name && named.signed_at
      ? { version: named.version, account_name: named.account_name, signed_at: named.signed_at }
      : undefined);
  const pn = signed
    ? g.node(
        'proposal:' + idea.id,
        'proposal',
        'Proposal v' + String(signed.version),
        'signed by ' + signed.account_name + ' ' + signed.signed_at.toISOString().slice(0, 10),
        'signed',
        '/ideas/' + idea.id,
      )
    : null;
  if (pn) g.edge(node, pn);
  else g.gap(node, 'No signed proposal');
  const items = (
    await c.query<{ item_id: string }>(
      'SELECT item_id FROM idea_items WHERE idea_id = $1 ORDER BY position',
      [idea.id],
    )
  ).rows;
  for (const r of items) {
    const n = await traceItem(c, g, r.item_id);
    if (n) g.edge(pn ?? node, n);
  }
}

export function traceRoutes(pool: Pool): Route[] {
  const trace = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/trace',
    summary: 'The traceability graph of an idea or a task: from the decision to the deploy',
    tags: ['trace'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ ideaId: s.optional(uuid), itemId: s.optional(uuid) }),
    response: traceOut,
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a: Access) => {
        const g = new Graph();
        if (query.ideaId) {
          const p = (
            await c.query<{ project_id: string }>('SELECT project_id FROM ideas WHERE id = $1', [
              query.ideaId,
            ])
          ).rows[0];
          if (!p) throw new HttpError(404, 'not_found', 'Idea not found');
          await requireProject(c, a, p.project_id);
          await traceIdea(c, g, query.ideaId);
        } else if (query.itemId) {
          const p = (
            await c.query<{ project_id: string }>('SELECT project_id FROM items WHERE id = $1', [
              query.itemId,
            ])
          ).rows[0];
          if (!p) throw new HttpError(404, 'not_found', 'Item not found');
          await requireProject(c, a, p.project_id);
          // a task that came from an idea is traced from that idea
          const idea = (
            await c.query<{ idea_id: string }>(
              'SELECT idea_id FROM idea_items WHERE item_id = $1',
              [query.itemId],
            )
          ).rows[0];
          if (idea) {
            const ideaNode = 'idea:' + idea.idea_id;
            await traceIdea(c, g, idea.idea_id);
            // keep only the asked task's branch
            const keep = new Set<string>([ideaNode, 'proposal:' + idea.idea_id]);
            const walk = (id: string): void => {
              keep.add(id);
              for (const e of g.edges.filter((x) => x.from === id)) walk(e.to);
            };
            walk('item:' + query.itemId);
            return {
              body: {
                nodes: g.nodes.filter((n) => keep.has(n.id)),
                edges: g.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
                gaps: g.gaps.filter((x) => keep.has(x.node)),
              },
            };
          }
          await traceItem(c, g, query.itemId);
        } else
          throw new HttpError(400, 'invalid_request', 'Name an idea or a task', [
            { path: 'query', message: 'needs ideaId or itemId' },
          ]);
        return { body: { nodes: g.nodes, edges: g.edges, gaps: g.gaps } };
      }),
  });
  return [trace];
}
