// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-107 | S15 | v0.1.0] Build the Plane importer: projects, items, states, comments, cycles, history ──
// ── [PCODE-129 | S15 | v0.1.0] Import from Jira and Linear CSV exports ──
// ── [PCODE-109 | S15 | v0.1.0] Move PCODE into Orqiva and retire Plane for this project ──
//    Why:  the receiving end of an import. A client (orq import plane) reads the other tool and sends what it
//          found in chunks; every chunk is upserted through import_links, so sending the same thing twice
//          changes nothing and an interrupted import simply runs again. Items keep their numbers (PCODE-12
//          stays PCODE-12), so fingerprints in the code still point at the right task. One project event per
//          chunk tells open boards to reload, instead of thousands of item events flooding every feed.
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { actorOf, asMember, type Access } from './access.js';
import { DEFAULT_STATES } from './projects.js';

const uuid = s.string({ format: 'uuid' });
const ext = s.string({ min: 1, max: 200 });
const time = s.string({ max: 40 });
const GROUPS = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'] as const;

const body = s.object({
  project: s.object({
    externalId: ext,
    key: s.string({ pattern: /^[A-Z][A-Z0-9]{1,9}$/ }),
    name: s.string({ min: 1, max: 120 }),
    description: s.optional(s.string({ max: 20_000 })),
  }),
  /** an existing project to import into; without it a project with the same key is refused */
  intoProjectId: s.optional(uuid),
  states: s.optional(
    s.array(
      s.object({
        externalId: ext,
        name: s.string({ min: 1, max: 60 }),
        group: s.enum([...GROUPS]),
        color: s.optional(s.string({ max: 20 })),
      }),
      { max: 200 },
    ),
  ),
  labels: s.optional(
    s.array(
      s.object({
        externalId: ext,
        name: s.string({ min: 1, max: 60 }),
        color: s.optional(s.string({ max: 20 })),
      }),
      {
        max: 1000,
      },
    ),
  ),
  sprints: s.optional(
    s.array(
      s.object({
        externalId: ext,
        name: s.string({ min: 1, max: 120 }),
        goal: s.optional(s.string({ max: 5000 })),
        startDate: s.nullable(s.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ })),
        endDate: s.nullable(s.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ })),
      }),
      { max: 1000 },
    ),
  ),
  items: s.optional(
    s.array(
      s.object({
        externalId: ext,
        sequence: s.number({ integer: true, min: 1 }),
        title: s.string({ min: 1, max: 255 }),
        description: s.string({ max: 100_000 }),
        stateExternalId: ext,
        labelExternalIds: s.array(ext, { max: 50 }),
        sprintExternalId: s.nullable(ext),
        parentExternalId: s.nullable(ext),
        priority: s.optional(s.string({ max: 20 })),
        // [PCODE-129 | S15 | v0.1.0] story points, from tools that keep them (Jira, Linear)
        estimate: s.optional(s.nullable(s.number({ integer: true, min: 0, max: 1000 }))),
        assigneeEmails: s.array(s.string({ max: 254 }), { max: 20 }),
        createdAt: time,
        updatedAt: time,
      }),
      { max: 500 },
    ),
  ),
  comments: s.optional(
    s.array(
      s.object({
        externalId: ext,
        itemExternalId: ext,
        body: s.string({ max: 100_000 }),
        author: s.string({ max: 200 }),
        authorEmail: s.optional(s.string({ max: 254 })),
        createdAt: time,
        editedAt: s.optional(s.nullable(time)),
      }),
      { max: 2000 },
    ),
  ),
  history: s.optional(
    s.array(
      s.object({
        externalId: ext,
        itemExternalId: ext,
        at: time,
        actor: s.string({ max: 200 }),
        verb: s.string({ min: 1, max: 60 }),
        field: s.optional(s.nullable(s.string({ max: 100 }))),
        oldValue: s.optional(s.nullable(s.string({ max: 5000 }))),
        newValue: s.optional(s.nullable(s.string({ max: 5000 }))),
        note: s.optional(s.nullable(s.string({ max: 5000 }))),
      }),
      { max: 5000 },
    ),
  ),
});
type Body = Infer<typeof body>;

const counts = s.object({
  states: s.number({ integer: true }),
  labels: s.number({ integer: true }),
  sprints: s.number({ integer: true }),
  items: s.number({ integer: true }),
  comments: s.number({ integer: true }),
  history: s.number({ integer: true }),
});
type Counts = Infer<typeof counts>;

class Links {
  constructor(
    private readonly c: PoolClient,
    private readonly ws: string,
    private readonly source: string,
  ) {}

  async get(kind: string, externalId: string): Promise<string | undefined> {
    return (
      await this.c.query<{ local_id: string }>(
        'SELECT local_id FROM import_links WHERE workspace_id = $1 AND source = $2 AND kind = $3 AND external_id = $4',
        [this.ws, this.source, kind, externalId],
      )
    ).rows[0]?.local_id;
  }

  async set(kind: string, externalId: string, localId: string): Promise<void> {
    await this.c.query(
      `INSERT INTO import_links (workspace_id, source, kind, external_id, local_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, source, kind, external_id) DO UPDATE SET local_id = EXCLUDED.local_id, imported_at = now()`,
      [this.ws, this.source, kind, externalId, localId],
    );
  }

  async need(kind: string, externalId: string, what: string): Promise<string> {
    const id = await this.get(kind, externalId);
    if (!id)
      throw new HttpError(
        409,
        'conflict',
        what + ' ' + externalId + ' has not been imported yet; send it first',
      );
    return id;
  }
}

async function project(c: PoolClient, a: Access, links: Links, b: Body): Promise<string> {
  const mapped = await links.get('project', b.project.externalId);
  if (mapped) return mapped;
  if (b.intoProjectId) {
    const p = (
      await c.query<{ id: string }>('SELECT id FROM projects WHERE id = $1', [b.intoProjectId])
    ).rows[0];
    if (!p) throw new HttpError(404, 'not_found', 'Project not found');
    await links.set('project', b.project.externalId, p.id);
    return p.id;
  }
  const taken = (
    await c.query<{ id: string }>('SELECT id FROM projects WHERE key = $1', [b.project.key])
  ).rows[0];
  if (taken)
    throw new HttpError(
      409,
      'conflict',
      'A project ' +
        b.project.key +
        ' already exists. Import into it on purpose (intoProjectId), or under another key.',
    );
  const id = (
    await c.query<{ id: string }>(
      'INSERT INTO projects (workspace_id, key, name, description) VALUES ($1, $2, $3, $4) RETURNING id',
      [a.workspaceId, b.project.key, b.project.name, b.project.description ?? ''],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('project insert returned nothing');
  for (const [i, st] of DEFAULT_STATES.entries())
    await c.query(
      'INSERT INTO project_states (workspace_id, project_id, name, grp, color, position) VALUES ($1, $2, $3, $4, $5, $6)',
      [a.workspaceId, id, st.name, st.grp, st.color, i],
    );
  await links.set('project', b.project.externalId, id);
  return id;
}

/** Colours are kept as #rrggbb; anything else (a name, #rgb, upper case) becomes a valid one. */
export function colour(c: string | undefined): string {
  const v = (c ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return v.replace(/[0-9a-f]/g, '$&$&');
  return '#8b8d98';
}

/** A label by name in the project, made if missing. */
async function labelNamed(
  c: PoolClient,
  a: Access,
  projectId: string,
  name: string,
  color = '#8b8d98',
): Promise<string> {
  const found = (
    await c.query<{ id: string }>(
      'SELECT id FROM labels WHERE project_id = $1 AND lower(name) = lower($2)',
      [projectId, name],
    )
  ).rows[0]?.id;
  if (found) return found;
  const id = (
    await c.query<{ id: string }>(
      'INSERT INTO labels (workspace_id, project_id, name, color) VALUES ($1, $2, $3, $4) RETURNING id',
      [a.workspaceId, projectId, name.slice(0, 60), colour(color)],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('label insert returned nothing');
  return id;
}

const sprintStatus = (
  start: string | null,
  end: string | null,
  today: string,
): 'planned' | 'active' | 'completed' =>
  end && end < today
    ? 'completed'
    : start && start <= today && (!end || end >= today)
      ? 'active'
      : 'planned';

export async function runImport(
  c: PoolClient,
  a: Access,
  source: string,
  b: Body,
  today: string,
): Promise<{ projectId: string; counts: Counts }> {
  const links = new Links(c, a.workspaceId, source);
  const projectId = await project(c, a, links, b);
  const n: Counts = { states: 0, labels: 0, sprints: 0, items: 0, comments: 0, history: 0 };

  for (const st of b.states ?? []) {
    let id = await links.get('state', st.externalId);
    id ??= (
      await c.query<{ id: string }>(
        'SELECT id FROM project_states WHERE project_id = $1 AND lower(name) = lower($2)',
        [projectId, st.name],
      )
    ).rows[0]?.id;
    if (!id) {
      id = (
        await c.query<{ id: string }>(
          `INSERT INTO project_states (workspace_id, project_id, name, grp, color, position)
           VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(position), -1) + 1 FROM project_states WHERE project_id = $2)) RETURNING id`,
          [a.workspaceId, projectId, st.name, st.group, colour(st.color)],
        )
      ).rows[0]?.id;
      if (!id) throw new Error('state insert returned nothing');
    }
    await links.set('state', st.externalId, id);
    n.states++;
  }

  for (const l of b.labels ?? []) {
    const id =
      (await links.get('label', l.externalId)) ??
      (await labelNamed(c, a, projectId, l.name, l.color));
    await links.set('label', l.externalId, id);
    n.labels++;
  }

  // [PCODE-109 | S15 | v0.1.0] sprint numbers make the S code of fingerprints (S15), so they follow the
  // other tool's numbering ("Sprint 15 - …") where it has one, else the order of the start dates; a run
  // after a wrong numbering puts it right (numbers are freed first, so two sprints can swap)
  const sprints = [...(b.sprints ?? [])].sort((x, y) =>
    (x.startDate ?? '9999').localeCompare(y.startDate ?? '9999'),
  );
  const wanted = (name: string): number | null => {
    const m = /^sprint\s+(\d{1,4})(?!\d)/i.exec(name.trim());
    return m ? Number(m[1]) : null;
  };
  for (const sp of sprints) {
    const mapped = await links.get('sprint', sp.externalId);
    const want = wanted(sp.name);
    if (mapped && want !== null)
      await c.query('UPDATE sprints SET number = -abs(number) WHERE id = $1 AND number <> $2', [
        mapped,
        want,
      ]);
  }
  const numberFor = async (self: string | undefined, want: number | null): Promise<number> => {
    const free = async (n: number): Promise<boolean> =>
      !(
        await c.query<{ id: string }>(
          'SELECT id FROM sprints WHERE project_id = $1 AND number = $2 AND id <> $3',
          [projectId, n, self ?? '00000000-0000-0000-0000-000000000000'],
        )
      ).rows[0];
    if (want !== null && want > 0 && (await free(want))) return want;
    const own = self
      ? (
          await c.query<{ number: number }>(
            'SELECT abs(number) AS number FROM sprints WHERE id = $1',
            [self],
          )
        ).rows[0]?.number
      : undefined;
    if (own !== undefined && (await free(own))) return own;
    return (
      (
        await c.query<{ n: number }>(
          'SELECT coalesce(max(number), 0) + 1 AS n FROM sprints WHERE project_id = $1',
          [projectId],
        )
      ).rows[0]?.n ?? 1
    );
  };
  for (const sp of sprints) {
    let status = sprintStatus(sp.startDate, sp.endDate, today);
    const mapped = await links.get('sprint', sp.externalId);
    if (status === 'active') {
      const other = (
        await c.query<{ id: string }>(
          "SELECT id FROM sprints WHERE project_id = $1 AND status = 'active' AND id <> $2",
          [projectId, mapped ?? '00000000-0000-0000-0000-000000000000'],
        )
      ).rows[0];
      if (other) status = 'planned'; // one active sprint per project: the running one keeps it
    }
    const number = await numberFor(mapped, wanted(sp.name));
    if (mapped) {
      await c.query(
        'UPDATE sprints SET name = $2, goal = $3, start_date = $4, end_date = $5, status = $6, number = $7 WHERE id = $1',
        [mapped, sp.name, sp.goal ?? '', sp.startDate, sp.endDate, status, number],
      );
    } else {
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO sprints (workspace_id, project_id, name, goal, start_date, end_date, status, number)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            a.workspaceId,
            projectId,
            sp.name,
            sp.goal ?? '',
            sp.startDate,
            sp.endDate,
            status,
            number,
          ],
        )
      ).rows[0]?.id;
      if (!id) throw new Error('sprint insert returned nothing');
      await links.set('sprint', sp.externalId, id);
    }
    n.sprints++;
  }

  const parents: { id: string; parent: string }[] = [];
  for (const it of b.items ?? []) {
    const stateId = await links.need('state', it.stateExternalId, 'State');
    const sprintId = it.sprintExternalId
      ? ((await links.get('sprint', it.sprintExternalId)) ?? null)
      : null;
    const assignee =
      (
        await c.query<{ id: string }>(
          `SELECT u.id FROM users u JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = $1
           WHERE lower(u.email) = ANY($2::text[]) LIMIT 1`,
          [a.workspaceId, it.assigneeEmails.map((e) => e.toLowerCase())],
        )
      ).rows[0]?.id ?? null;
    let id = await links.get('item', it.externalId);
    if (id) {
      await c.query(
        `UPDATE items SET title = $2, description = $3, state_id = $4, sprint_id = $5, assignee_id = coalesce($6, assignee_id),
                created_at = $7, updated_at = $8, estimate = coalesce($9, estimate), version = version + 1 WHERE id = $1`,
        [
          id,
          it.title,
          it.description,
          stateId,
          sprintId,
          assignee,
          it.createdAt,
          it.updatedAt,
          it.estimate ?? null,
        ],
      );
    } else {
      const taken = (
        await c.query<{ id: string }>(
          'SELECT id FROM items WHERE project_id = $1 AND sequence = $2',
          [projectId, it.sequence],
        )
      ).rows[0];
      if (taken)
        throw new HttpError(
          409,
          'conflict',
          b.project.key +
            '-' +
            String(it.sequence) +
            ' already exists here and was not imported; import into an empty project',
        );
      id = (
        await c.query<{ id: string }>(
          `INSERT INTO items (workspace_id, project_id, sequence, title, description, state_id, sprint_id, assignee_id, rank, created_by, created_at, updated_at, estimate)
           VALUES ($1, $2, $3::int, $4, $5, $6, $7, $8, $3::int::double precision, $9, $10, $11, $12) RETURNING id`,
          [
            a.workspaceId,
            projectId,
            it.sequence,
            it.title,
            it.description,
            stateId,
            sprintId,
            assignee,
            a.user.id,
            it.createdAt,
            it.updatedAt,
            it.estimate ?? null,
          ],
        )
      ).rows[0]?.id;
      if (!id) throw new Error('item insert returned nothing');
      await links.set('item', it.externalId, id);
    }
    const labelIds = new Set<string>();
    for (const l of it.labelExternalIds) {
      const lid = await links.get('label', l);
      if (lid) labelIds.add(lid);
    }
    // no priority field yet: the priority travels as a label, so it is not lost
    if (it.priority && it.priority !== 'none')
      labelIds.add(await labelNamed(c, a, projectId, 'priority: ' + it.priority));
    await c.query('DELETE FROM item_labels WHERE item_id = $1', [id]);
    for (const lid of labelIds)
      await c.query(
        'INSERT INTO item_labels (workspace_id, item_id, label_id) VALUES ($1, $2, $3)',
        [a.workspaceId, id, lid],
      );
    if (it.parentExternalId) parents.push({ id, parent: it.parentExternalId });
    n.items++;
  }
  // parents last: a parent may come later in the same chunk (one in a later chunk is linked when resent)
  for (const p of parents) {
    const parentId = await links.get('item', p.parent);
    if (parentId && parentId !== p.id)
      await c.query('UPDATE items SET parent_id = $2 WHERE id = $1', [p.id, parentId]);
  }
  if (b.items?.length)
    await c.query(
      'UPDATE projects SET next_item_seq = greatest(next_item_seq, (SELECT coalesce(max(sequence), 0) + 1 FROM items WHERE project_id = $1)) WHERE id = $1',
      [projectId],
    );

  for (const cm of b.comments ?? []) {
    const itemId = await links.need('item', cm.itemExternalId, 'Item');
    const author = cm.authorEmail
      ? ((
          await c.query<{ id: string }>(
            'SELECT u.id FROM users u JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = $1 WHERE lower(u.email) = lower($2)',
            [a.workspaceId, cm.authorEmail],
          )
        ).rows[0]?.id ?? null)
      : null;
    const text = (cm.body.trim() || '(empty comment)').slice(0, 20_000);
    const id = await links.get('comment', cm.externalId);
    if (id) {
      await c.query(
        'UPDATE comments SET body = $2, author_id = $3, author_label = $4, created_at = $5, edited_at = $6 WHERE id = $1',
        [id, text, author, cm.author, cm.createdAt, cm.editedAt ?? null],
      );
    } else {
      const nid = (
        await c.query<{ id: string }>(
          'INSERT INTO comments (workspace_id, item_id, author_id, author_label, body, created_at, edited_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [a.workspaceId, itemId, author, cm.author, text, cm.createdAt, cm.editedAt ?? null],
        )
      ).rows[0]?.id;
      if (!nid) throw new Error('comment insert returned nothing');
      await links.set('comment', cm.externalId, nid);
    }
    n.comments++;
  }

  for (const h of b.history ?? []) {
    if (await links.get('history', h.externalId)) continue; // history does not change
    const itemId = await links.need('item', h.itemExternalId, 'Item');
    const id = (
      await c.query<{ id: string }>(
        'INSERT INTO item_history (workspace_id, item_id, source, at, actor, verb, field, old_value, new_value, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
        [
          a.workspaceId,
          itemId,
          source,
          h.at,
          h.actor,
          h.verb,
          h.field ?? null,
          h.oldValue ?? null,
          h.newValue ?? null,
          h.note ?? null,
        ],
      )
    ).rows[0]?.id;
    if (!id) throw new Error('history insert returned nothing');
    await links.set('history', h.externalId, id);
    n.history++;
  }

  const p = (
    await c.query<{ key: string; name: string }>('SELECT key, name FROM projects WHERE id = $1', [
      projectId,
    ])
  ).rows[0];
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb: 'updated',
      object: { type: 'project', id: projectId, label: (p?.key ?? '') + ' ' + (p?.name ?? '') },
      parent: { type: 'workspace', id: a.workspaceId },
      changes: { imported: { from: source, to: n } },
    },
    { projectId },
  );
  return { projectId, counts: n };
}

export function importRoutes(pool: Pool): Route[] {
  const plane = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/import/plane',
    summary:
      'Import (or import again) a chunk of a Plane project: states, labels, cycles, issues, comments, activity (admin)',
    tags: ['import'],
    params: s.object({ workspaceId: uuid }),
    body,
    response: s.object({ projectId: s.string(), counts }),
    handler: ({ params, body: b, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => ({
        body: await runImport(c, a, 'plane', b, new Date().toISOString().slice(0, 10)),
      })),
  });
  return [plane];
}
