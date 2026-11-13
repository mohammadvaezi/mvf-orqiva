// ── [PCODE-333 | S15 | v0.1.0] T33.4b Sandbox per run with repo tools, pull requests by a bot Git identity ──
// ── [PCODE-284 | S15 | v0.1.0] T29.6 Documents: tree drag and drop, files, image annotation, read analytics, per-task knowledge, checked citations ──
// ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
// ── [PCODE-205 | S15 | v0.1.0] T17.3 Release agent with release tools, approved release notes, changelogs per release, project and train ──
// ── [PCODE-198 | S15 | v0.1.0] T16.2 Documenter agent: document tools with knowledge scopes, agent-written drafts, Ask the Documenter ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-120 | S15 | v0.1.0] Build the agent runtime: agents, queued runs, model providers, tools with approvals, budgets, streamed steps ──
//    Why:  what an agent (or an MCP client) may do, in one place, with the same checks as the API: the
//          project must be visible to the role, writes need at least a member, and every change records an
//          event in the actor's name (an agent shows as an agent, never as a person). Moving a task waits
//          for a person's approval; finishing or cancelling work is never a tool's to do.
import { agentScopeAllows, type Actor, type AgentScope } from '@orqiva/shared';
import type { PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { atLeast, requireProject, type Access } from '../api/access.js';
import { citedOn, isPublicUrl, readablePages, recordRead, storeLinks } from '../api/documents.js';
import type { ToolSpec } from './provider.js';
import { openPullRequest, readRepoFile, HostError } from '../git/hostapi.js'; // [PCODE-333 | S15 | v0.1.0]
import { botIdentity, projectHost } from '../git/projecthost.js';

export interface ToolContext {
  c: PoolClient;
  access: Access;
  actor: Actor;
  /** the run's project, used when the input names none */
  projectId?: string;
  /** [PCODE-198 | S15 | v0.1.0] the agent and run behind the call: its knowledge scope and read log */
  agentKey?: string;
  runId?: string;
  /** [PCODE-284 | S15 | v0.1.0] the task the run works on: pages opened to it are readable too */
  itemId?: string | null;
  // [PCODE-247 | S15 | v0.1.0] the agent's scope (files, branches, hosts), and how it reaches the web (tests fake both)
  scope?: AgentScope;
  agentName?: string;
  fetchImpl?: typeof fetch;
  isPublic?: (url: string) => Promise<boolean>;
}

export class ToolError extends Error {}

interface Tool {
  spec: ToolSpec;
  writes: boolean;
  /** waits for a person before it runs */
  needsApproval: boolean;
  run(ctx: ToolContext, input: Record<string, unknown>): Promise<unknown>;
}

const str = (input: Record<string, unknown>, key: string, max = 20_000): string => {
  const v = input[key];
  if (typeof v !== 'string' || !v.trim()) throw new ToolError(key + ' is required');
  if (v.length > max) throw new ToolError(key + ' is longer than ' + String(max) + ' characters');
  return v.trim();
};
const optStr = (input: Record<string, unknown>, key: string): string | undefined =>
  typeof input[key] === 'string' && input[key].trim() ? input[key].trim() : undefined;

async function projectOf(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<{ id: string; key: string }> {
  const key = optStr(input, 'project');
  let id = ctx.projectId;
  if (key) {
    id = (await ctx.c.query<{ id: string }>('SELECT id FROM projects WHERE key = upper($1)', [key]))
      .rows[0]?.id;
    if (!id) throw new ToolError('No project ' + key.toUpperCase());
  }
  if (!id) throw new ToolError('Name the project (its key, e.g. APP)');
  try {
    const p = await requireProject(ctx.c, ctx.access, id);
    return { id: p.id, key: p.key };
  } catch {
    throw new ToolError('No project ' + (key ?? '') + ' that this role can see');
  }
}

interface ItemRow {
  id: string;
  ref: string;
  title: string;
  description: string;
  state: string;
  grp: string;
  project_id: string;
}
const ITEM = `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, i.description, st.name AS state, st.grp, i.project_id
              FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id`;

async function itemOf(ctx: ToolContext, input: Record<string, unknown>): Promise<ItemRow> {
  const ref = str(input, 'ref', 30).toUpperCase();
  const m = /^([A-Z][A-Z0-9]{1,9})-(\d{1,9})$/.exec(ref);
  if (!m) throw new ToolError('ref must look like APP-12');
  const it = (
    await ctx.c.query<ItemRow>(ITEM + ' WHERE p.key = $1 AND i.sequence = $2', [m[1], Number(m[2])])
  ).rows[0];
  if (!it) throw new ToolError('No task ' + ref);
  try {
    await requireProject(ctx.c, ctx.access, it.project_id);
  } catch {
    throw new ToolError('No task ' + ref + ' that this role can see');
  }
  return it;
}

function mayWrite(ctx: ToolContext): void {
  if (!atLeast(ctx.access.role, 'member'))
    throw new ToolError('This role may read but not change anything');
}

async function event(
  ctx: ToolContext,
  it: { id: string; ref: string; title: string; project_id: string },
  verb: 'created' | 'updated' | 'moved' | 'commented',
  changes?: Record<string, { from: unknown; to: unknown }>,
  commentId?: string,
): Promise<void> {
  await recordEvent(
    ctx.c,
    ctx.access.workspaceId,
    {
      actor: ctx.actor,
      verb,
      object: commentId
        ? { type: 'comment', id: commentId }
        : { type: 'item', id: it.id, label: it.ref + ' ' + it.title },
      ...(commentId
        ? { parent: { type: 'item' as const, id: it.id, label: it.ref + ' ' + it.title } }
        : {}),
      ...(changes ? { changes } : {}),
    },
    { projectId: it.project_id },
  );
}

const projectProp = {
  project: {
    type: 'string',
    description: 'Project key, e.g. APP; the current project when left out',
  },
};

export const TOOLS: Record<string, Tool> = {
  list_items: {
    writes: false,
    needsApproval: false,
    spec: {
      name: 'list_items',
      description: 'List the open tasks of a project: reference, title and state.',
      input_schema: {
        type: 'object',
        properties: {
          ...projectProp,
          query: { type: 'string', description: 'Words that must appear in the title' },
        },
      },
    },
    async run(ctx, input) {
      const p = await projectOf(ctx, input);
      const q = optStr(input, 'query');
      const rows = (
        await ctx.c.query<ItemRow>(
          ITEM +
            " WHERE i.project_id = $1 AND st.grp IN ('backlog', 'unstarted', 'started') AND ($2::text IS NULL OR i.title ILIKE '%' || $2 || '%') ORDER BY i.sequence LIMIT 100",
          [p.id, q ?? null],
        )
      ).rows;
      return rows.map((r) => ({ ref: r.ref, title: r.title, state: r.state }));
    },
  },
  get_item: {
    writes: false,
    needsApproval: false,
    spec: {
      name: 'get_item',
      description: 'Read one task: title, state, description and its latest comments.',
      input_schema: {
        type: 'object',
        properties: { ref: { type: 'string', description: 'Task reference, e.g. APP-12' } },
        required: ['ref'],
      },
    },
    async run(ctx, input) {
      const it = await itemOf(ctx, input);
      const comments = (
        await ctx.c.query<{ author: string | null; body: string; created_at: Date }>(
          `SELECT coalesce(u.name, c.author_label) AS author, c.body, c.created_at FROM comments c LEFT JOIN users u ON u.id = c.author_id
           WHERE c.item_id = $1 ORDER BY c.created_at DESC LIMIT 10`,
          [it.id],
        )
      ).rows;
      return {
        ref: it.ref,
        title: it.title,
        state: it.state,
        description: it.description.slice(0, 8000),
        comments: comments.reverse().map((c) => ({
          by: c.author ?? 'someone',
          at: c.created_at.toISOString(),
          text: c.body.slice(0, 2000),
        })),
      };
    },
  },
  add_comment: {
    writes: true,
    needsApproval: false,
    spec: {
      name: 'add_comment',
      description: 'Write a comment on a task.',
      input_schema: {
        type: 'object',
        properties: { ref: { type: 'string' }, body: { type: 'string' } },
        required: ['ref', 'body'],
      },
    },
    async run(ctx, input) {
      mayWrite(ctx);
      const it = await itemOf(ctx, input);
      const body = str(input, 'body', 20_000);
      const id = (
        await ctx.c.query<{ id: string }>(
          'INSERT INTO comments (workspace_id, item_id, author_id, author_label, body) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [
            ctx.access.workspaceId,
            it.id,
            ctx.actor.kind === 'user' ? ctx.actor.id : null,
            ctx.actor.name ?? null,
            body,
          ],
        )
      ).rows[0]?.id;
      await event(ctx, it, 'commented', undefined, id);
      return { ok: true, ref: it.ref };
    },
  },
  create_item: {
    writes: true,
    needsApproval: false,
    spec: {
      name: 'create_item',
      description: 'Create a task in a project, in its first state.',
      input_schema: {
        type: 'object',
        properties: { ...projectProp, title: { type: 'string' }, description: { type: 'string' } },
        required: ['title'],
      },
    },
    async run(ctx, input) {
      mayWrite(ctx);
      const p = await projectOf(ctx, input);
      const title = str(input, 'title', 255);
      const state = (
        await ctx.c.query<{ id: string }>(
          'SELECT id FROM project_states WHERE project_id = $1 ORDER BY position LIMIT 1',
          [p.id],
        )
      ).rows[0]?.id;
      if (!state) throw new ToolError('The project has no states');
      const seq = (
        await ctx.c.query<{ seq: number }>(
          'UPDATE projects SET next_item_seq = next_item_seq + 1 WHERE id = $1 RETURNING next_item_seq - 1 AS seq',
          [p.id],
        )
      ).rows[0]?.seq;
      const id = (
        await ctx.c.query<{ id: string }>(
          // [PCODE-254 | S15 | v0.1.0] a task an agent makes waits in triage until a person takes it
          `INSERT INTO items (workspace_id, project_id, sequence, title, description, state_id, created_by, rank, triage)
           VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT coalesce(max(rank), 0) + 1 FROM items WHERE project_id = $2), $8) RETURNING id`,
          [
            ctx.access.workspaceId,
            p.id,
            seq,
            title,
            optStr(input, 'description') ?? '',
            state,
            ctx.access.user.id,
            ctx.actor.kind === 'agent',
          ],
        )
      ).rows[0]?.id;
      if (!id || seq === undefined) throw new Error('item insert returned nothing');
      const ref = p.key + '-' + String(seq);
      await event(ctx, { id, ref, title, project_id: p.id }, 'created');
      return { ok: true, ref };
    },
  },
  update_item: {
    writes: true,
    needsApproval: false,
    spec: {
      name: 'update_item',
      description: 'Change the title or the description of a task.',
      input_schema: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['ref'],
      },
    },
    async run(ctx, input) {
      mayWrite(ctx);
      const it = await itemOf(ctx, input);
      const title = optStr(input, 'title');
      const description =
        typeof input['description'] === 'string' ? input['description'] : undefined;
      if (!title && description === undefined) throw new ToolError('Give a title or a description');
      await ctx.c.query(
        'UPDATE items SET title = coalesce($2, title), description = coalesce($3, description), version = version + 1, updated_at = now() WHERE id = $1',
        [it.id, title ?? null, description ?? null],
      );
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (title) changes['title'] = { from: it.title, to: title };
      if (description !== undefined) changes['description'] = { from: null, to: '(changed)' };
      await event(ctx, { ...it, title: title ?? it.title }, 'updated', changes);
      return { ok: true, ref: it.ref };
    },
  },
  move_item: {
    writes: true,
    needsApproval: true,
    spec: {
      name: 'move_item',
      description:
        'Move a task to another state (not to done or cancelled: that is for people). A person approves the move first.',
      input_schema: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          state: { type: 'string', description: 'State name, e.g. In Progress' },
        },
        required: ['ref', 'state'],
      },
    },
    async run(ctx, input) {
      mayWrite(ctx);
      const it = await itemOf(ctx, input);
      const name = str(input, 'state', 60);
      const st = (
        await ctx.c.query<{ id: string; name: string; grp: string }>(
          'SELECT id, name, grp FROM project_states WHERE project_id = $1 AND lower(name) = lower($2)',
          [it.project_id, name],
        )
      ).rows[0];
      if (!st) throw new ToolError('The project has no state ' + name);
      if (st.grp === 'completed' || st.grp === 'cancelled')
        throw new ToolError('Finishing or cancelling work is for people, not agents');
      await ctx.c.query(
        'UPDATE items SET state_id = $2, version = version + 1, updated_at = now() WHERE id = $1',
        [it.id, st.id],
      );
      await event(ctx, it, 'moved', { state: { from: it.state, to: st.name } });
      return { ok: true, ref: it.ref, state: st.name };
    },
  },
};

// ── [PCODE-198 | S15 | v0.1.0] documents: an agent reads only what its knowledge scope allows ──
interface DocRow {
  id: string;
  title: string;
  version: number;
  body: string;
  kind: string;
  generated_key: string | null;
  locked_by: string | null;
  agent_written: boolean;
  approved_at: Date | null;
}

/** The pages the caller may read: an agent its knowledge scope, a person the whole project. */
async function docsFor(ctx: ToolContext, projectId: string): Promise<DocRow[]> {
  const all = (
    await ctx.c.query<DocRow>(
      `SELECT id, title, version, body, kind, generated_key, locked_by, agent_written, approved_at FROM doc_pages
        WHERE project_id = $1 AND deleted_at IS NULL AND kind = 'page' ORDER BY title`,
      [projectId],
    )
  ).rows;
  if (!ctx.agentKey) return all;
  const ok = new Set(
    (await readablePages(ctx.c, projectId, ctx.agentKey, ctx.itemId ?? null)).map((p) => p.id),
  );
  return all.filter((p) => ok.has(p.id));
}

const docProp = {
  page: { type: 'string', description: 'The page: its id, or its exact title' },
};

async function docOf(
  ctx: ToolContext,
  projectId: string,
  input: Record<string, unknown>,
): Promise<DocRow> {
  const want = str(input, 'page', 200);
  const pages = await docsFor(ctx, projectId);
  const hit =
    pages.find((d) => d.id === want) ??
    pages.find((d) => d.title.toLowerCase() === want.toLowerCase());
  if (!hit)
    throw new ToolError(
      'No page "' +
        want +
        '" that you may read (your knowledge scope decides; list_docs shows them)',
    );
  return hit;
}

async function docEventAs(
  ctx: ToolContext,
  project: { id: string; key: string },
  verb: 'created' | 'updated',
  title: string,
): Promise<void> {
  await recordEvent(
    ctx.c,
    ctx.access.workspaceId,
    {
      actor: ctx.actor,
      verb,
      object: { type: 'project', id: project.id, label: project.key },
      changes: { page: { from: verb === 'created' ? null : title, to: title } },
    },
    { projectId: project.id },
  );
}

const DOC_TOOLS: Record<string, Tool> = {
  list_docs: {
    writes: false,
    needsApproval: false,
    spec: {
      name: 'list_docs',
      description:
        'List the documentation pages you may read in a project: id, title, version, and whether it is built from the code or waits for approval.',
      input_schema: { type: 'object', properties: { ...projectProp } },
    },
    async run(ctx, input) {
      const p = await projectOf(ctx, input);
      return (await docsFor(ctx, p.id)).map((d) => ({
        id: d.id,
        title: d.title,
        version: d.version,
        builtFromCode: d.generated_key !== null,
        waitsForApproval: d.agent_written && !d.approved_at,
      }));
    },
  },
  read_doc: {
    writes: false,
    needsApproval: false,
    spec: {
      name: 'read_doc',
      description:
        'Read a documentation page (Markdown). Name the passage you rely on in "cite"; the read is logged for the team.',
      input_schema: {
        type: 'object',
        properties: {
          ...projectProp,
          ...docProp,
          cite: { type: 'string', description: 'The passage you use from it, word for word' },
        },
        required: ['page'],
      },
    },
    async run(ctx, input) {
      const p = await projectOf(ctx, input);
      const d = await docOf(ctx, p.id, input);
      // [PCODE-284 | S15 | v0.1.0] a cited passage is checked against the page
      const cite = optStr(input, 'cite') ?? '';
      const citedOk = cite ? citedOn(d.body, cite) : null;
      if (ctx.agentKey)
        await recordRead(ctx.c, ctx.access.workspaceId, {
          projectId: p.id,
          agentKey: ctx.agentKey,
          runId: ctx.runId ?? null,
          pageId: d.id,
          version: d.version,
          passage: cite,
          citedOk,
        });
      return {
        ...(citedOk === false
          ? {
              citeNotFound:
                'The passage you cited is not on this page. Quote it word for word from the text below, or do not rely on it.',
            }
          : {}),
        id: d.id,
        title: d.title,
        version: d.version,
        body: d.body.slice(0, 60_000),
        ...(d.body.length > 60_000 ? { cut: 'The page is longer; the rest is not shown.' } : {}),
      };
    },
  },
  write_doc: {
    writes: true,
    needsApproval: false,
    spec: {
      name: 'write_doc',
      description:
        'Write a documentation page in Markdown: a new page (title, optional parent folder title) or a new version of a page you may read (page). ' +
        'It stays marked as written by an agent until a person approves it. Name the repo files you describe in backticks (`src/x.ts`).',
      input_schema: {
        type: 'object',
        properties: {
          ...projectProp,
          ...docProp,
          title: { type: 'string', description: 'Title of a new page, or a new title' },
          parent: { type: 'string', description: 'Folder or page title to put a new page under' },
          body: { type: 'string', description: 'The whole page in Markdown' },
        },
        required: ['body'],
      },
    },
    async run(ctx, input) {
      mayWrite(ctx);
      const p = await projectOf(ctx, input);
      const body = str(input, 'body', 400_000);
      const byAgent = ctx.actor.kind === 'agent';
      if (optStr(input, 'page')) {
        const d = await docOf(ctx, p.id, input);
        if (d.generated_key)
          throw new ToolError('This page is built from the code; it changes when the code does');
        if (d.locked_by) throw new ToolError('Someone has locked this page');
        const title = (optStr(input, 'title') ?? d.title).slice(0, 200);
        const v = d.version + 1;
        await ctx.c.query(
          `UPDATE doc_pages SET title = $2, body = $3, version = $4, updated_at = now(),
                  agent_written = agent_written OR $5, approved_at = CASE WHEN $5 THEN NULL ELSE approved_at END,
                  approved_by = CASE WHEN $5 THEN NULL ELSE approved_by END
            WHERE id = $1`,
          [d.id, title, body, v, byAgent],
        );
        await ctx.c.query(
          'INSERT INTO doc_versions (workspace_id, page_id, version, title, body, author_id, agent_run_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            ctx.access.workspaceId,
            d.id,
            v,
            title,
            body,
            byAgent ? null : ctx.access.user.id,
            ctx.runId ?? null,
          ],
        );
        await storeLinks(ctx.c, ctx.access, { id: d.id, project_id: p.id }, body);
        await docEventAs(ctx, p, 'updated', title);
        return { ok: true, pageId: d.id, title, version: v };
      }
      const title = str(input, 'title', 200);
      const parentName = optStr(input, 'parent');
      const parent = parentName
        ? (
            await ctx.c.query<{ id: string }>(
              'SELECT id FROM doc_pages WHERE project_id = $1 AND deleted_at IS NULL AND lower(title) = lower($2) ORDER BY kind DESC LIMIT 1',
              [p.id, parentName],
            )
          ).rows[0]?.id
        : null;
      if (parentName && !parent) throw new ToolError('No folder or page "' + parentName + '"');
      const id = (
        await ctx.c.query<{ id: string }>(
          `INSERT INTO doc_pages (workspace_id, project_id, parent_id, kind, title, rank, status, owner_id, agent_written, version, body, created_by)
           VALUES ($1, $2, $3, 'page', $4, (SELECT coalesce(max(rank), 0) + 1 FROM doc_pages WHERE project_id = $2 AND parent_id IS NOT DISTINCT FROM $3),
                   'draft', $5, $6, 1, $7, $5) RETURNING id`,
          [ctx.access.workspaceId, p.id, parent ?? null, title, ctx.access.user.id, byAgent, body],
        )
      ).rows[0]?.id;
      if (!id) throw new Error('page insert returned nothing');
      await ctx.c.query(
        'INSERT INTO doc_versions (workspace_id, page_id, version, title, body, author_id, agent_run_id) VALUES ($1, $2, 1, $3, $4, $5, $6)',
        [
          ctx.access.workspaceId,
          id,
          title,
          body,
          byAgent ? null : ctx.access.user.id,
          ctx.runId ?? null,
        ],
      );
      await storeLinks(ctx.c, ctx.access, { id, project_id: p.id }, body);
      await docEventAs(ctx, p, 'created', title);
      return { ok: true, pageId: id, title, version: 1 };
    },
  },
};
Object.assign(TOOLS, DOC_TOOLS);

// ── [PCODE-205 | S15 | v0.1.0] releases: the Release agent reads what goes out and drafts the notes ──
interface RelRow {
  id: string;
  version: string;
  state: string;
  train: string;
  notes_team: string;
  notes_client: string;
  notes_approved_at: Date | null;
  items: string;
  done: string;
}
const REL = `SELECT r.id, r.version, r.state, r.train, r.notes_team, r.notes_client, r.notes_approved_at,
       (SELECT count(*) FROM release_items x WHERE x.release_id = r.id) AS items,
       (SELECT count(*) FROM release_items x JOIN items i ON i.id = x.item_id JOIN project_states st ON st.id = i.state_id
         WHERE x.release_id = r.id AND st.grp IN ('completed', 'cancelled')) AS done
  FROM releases r`;

async function releaseByVersion(
  ctx: ToolContext,
  projectId: string,
  input: Record<string, unknown>,
): Promise<RelRow> {
  const version = str(input, 'version', 60);
  const r = (
    await ctx.c.query<RelRow>(REL + ' WHERE r.project_id = $1 AND r.version = $2', [
      projectId,
      version,
    ])
  ).rows[0];
  if (!r) throw new ToolError('No release ' + version + ' (list_releases shows them)');
  return r;
}

const RELEASE_TOOLS: Record<string, Tool> = {
  list_releases: {
    writes: false,
    needsApproval: false,
    spec: {
      name: 'list_releases',
      description:
        'List the releases of a project: version, state, train, tasks done of all, and whether the notes are approved.',
      input_schema: { type: 'object', properties: { ...projectProp } },
    },
    async run(ctx, input) {
      const p = await projectOf(ctx, input);
      const rows = (
        await ctx.c.query<RelRow>(
          REL + ' WHERE r.project_id = $1 ORDER BY r.created_at DESC LIMIT 30',
          [p.id],
        )
      ).rows;
      return rows.map((r) => ({
        version: r.version,
        state: r.state,
        train: r.train || null,
        tasks: Number(r.items),
        done: Number(r.done),
        notesApproved: r.notes_approved_at !== null,
      }));
    },
  },
  read_release: {
    writes: false,
    needsApproval: false,
    spec: {
      name: 'read_release',
      description:
        'Read one release: its tasks (reference, title, kind, state, breaking), open serious findings and its current notes.',
      input_schema: {
        type: 'object',
        properties: { ...projectProp, version: { type: 'string', description: 'e.g. 1.4.0' } },
        required: ['version'],
      },
    },
    async run(ctx, input) {
      const p = await projectOf(ctx, input);
      const r = await releaseByVersion(ctx, p.id, input);
      const tasks = (
        await ctx.c.query<{
          ref: string;
          title: string;
          kind: string;
          state: string;
          breaking: boolean;
        }>(
          `SELECT pr.key || '-' || i.sequence AS ref, i.title, i.kind, st.name AS state, x.breaking FROM release_items x
             JOIN items i ON i.id = x.item_id JOIN projects pr ON pr.id = i.project_id JOIN project_states st ON st.id = i.state_id
            WHERE x.release_id = $1 ORDER BY i.sequence`,
          [r.id],
        )
      ).rows;
      const serious = (
        await ctx.c.query<{ n: string }>(
          "SELECT count(*) AS n FROM findings WHERE project_id = $1 AND status = 'open' AND severity IN ('critical', 'high')",
          [p.id],
        )
      ).rows[0]?.n;
      return {
        version: r.version,
        state: r.state,
        train: r.train || null,
        tasks,
        openSeriousFindings: Number(serious ?? 0),
        notesTeam: r.notes_team.slice(0, 20_000),
        notesClient: r.notes_client.slice(0, 20_000),
        notesApproved: r.notes_approved_at !== null,
      };
    },
  },
  write_release_notes: {
    writes: true,
    needsApproval: false,
    spec: {
      name: 'write_release_notes',
      description:
        'Write the release notes of a release in Markdown: "team" (with task references) or "client" (plain words, no references). ' +
        'They wait for the approval of a person before they go out.',
      input_schema: {
        type: 'object',
        properties: {
          ...projectProp,
          version: { type: 'string' },
          audience: { type: 'string', enum: ['team', 'client'] },
          body: { type: 'string', description: 'The whole notes in Markdown' },
        },
        required: ['version', 'audience', 'body'],
      },
    },
    async run(ctx, input) {
      mayWrite(ctx);
      const p = await projectOf(ctx, input);
      const r = await releaseByVersion(ctx, p.id, input);
      if (r.state === 'rolled_back')
        throw new ToolError(r.version + ' was rolled back; its notes stay');
      const audience =
        input['audience'] === 'client' ? 'client' : input['audience'] === 'team' ? 'team' : null;
      if (!audience) throw new ToolError('audience is team or client');
      const body = str(input, 'body', 100_000);
      await ctx.c.query(
        'UPDATE releases SET ' +
          (audience === 'team' ? 'notes_team' : 'notes_client') +
          ' = $2, notes_approved_by = NULL, notes_approved_at = NULL, notes_by_agent = $3 WHERE id = $1',
        [r.id, body, ctx.actor.kind === 'agent'],
      );
      await recordEvent(
        ctx.c,
        ctx.access.workspaceId,
        {
          actor: ctx.actor,
          verb: 'updated',
          object: { type: 'project', id: p.id, label: p.key },
          changes: { release: { from: null, to: r.version + ' ' + audience + ' notes written' } },
        },
        { projectId: p.id },
      );
      return { ok: true, version: r.version, audience, waitsForApproval: true };
    },
  },
};
Object.assign(TOOLS, RELEASE_TOOLS);

// ── [PCODE-247 | S15 | v0.1.0] the web, inside the network scope ──

const FETCH_MAX_BYTES = 1_000_000;
const FETCH_TEXT = 20_000;

/** The body up to `max` bytes; more is cut, and says so. */
async function readLimited(res: Response, max: number): Promise<{ data: Buffer; cut: boolean }> {
  if (!res.body) return { data: Buffer.alloc(0), cut: false };
  const parts: Buffer[] = [];
  let size = 0;
  for await (const value of res.body as unknown as AsyncIterable<Uint8Array>) {
    parts.push(Buffer.from(value));
    size += value.length;
    if (size > max) {
      await res.body.cancel().catch(() => undefined);
      return { data: Buffer.concat(parts).subarray(0, max), cut: true };
    }
  }
  return { data: Buffer.concat(parts), cut: false };
}

/** A page's readable text: no scripts, styles or tags, entities decoded, spaces collapsed. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

const NET_TOOLS: Record<string, Tool> = {
  fetch_url: {
    writes: false,
    needsApproval: false,
    spec: {
      name: 'fetch_url',
      description:
        "Read a web page or an API answer (GET, https only) on a host in the agent's network scope. Returns the text, at most 20 000 characters.",
      input_schema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The https address' } },
        required: ['url'],
      },
    },
    async run(ctx, input) {
      let url: URL;
      try {
        url = new URL(str(input, 'url', 2000));
      } catch (e) {
        if (e instanceof ToolError) throw e;
        throw new ToolError('That is not a web address');
      }
      for (let hop = 0; hop <= 3; hop++) {
        if (url.protocol !== 'https:') throw new ToolError('Only https addresses are read');
        const ok = agentScopeAllows(ctx.scope ?? {}, 'network', url.hostname, ctx.agentName);
        if (!ok.allowed) throw new ToolError('Refused: ' + ok.reason);
        if (!(await (ctx.isPublic ?? isPublicUrl)(url.href)))
          throw new ToolError('Refused: ' + url.hostname + ' is not a public address');
        let res: Response;
        try {
          res = await (ctx.fetchImpl ?? fetch)(url.href, {
            redirect: 'manual',
            signal: AbortSignal.timeout(10_000),
            headers: { 'user-agent': 'Orqiva agent', accept: 'text/*, application/json' },
          });
        } catch (e) {
          throw new ToolError(
            'Could not reach ' + url.hostname + ': ' + (e instanceof Error ? e.message : String(e)),
          );
        }
        const next = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && next) {
          // every hop is checked against the scope again
          url = new URL(next, url);
          continue;
        }
        const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
        if (type && !/^(text\/|application\/(json|xml|[\w.+-]*\+(json|xml)))/.test(type))
          throw new ToolError(url.hostname + ' answered with ' + type + ', not text');
        const { data, cut } = await readLimited(res, FETCH_MAX_BYTES);
        let text = data.toString('utf8');
        if (type === 'text/html') text = htmlText(text);
        return {
          url: url.href,
          status: res.status,
          contentType: type,
          text: text.slice(0, FETCH_TEXT),
          truncated: cut || text.length > FETCH_TEXT,
        };
      }
      throw new ToolError('Too many redirects');
    },
  },
};
Object.assign(TOOLS, NET_TOOLS);

// [PCODE-333 | S15 | v0.1.0] the run's sandbox: read the repository, write only into the sandbox, open a pull request from it
const SANDBOX_FILES = 50;
const SANDBOX_TEXT = 500_000;

/** A path inside the repository: relative, no "..", nothing under .git. */
export function sandboxPath(input: Record<string, unknown>): string {
  const p = str(input, 'path', 300).replace(/\\/g, '/').replace(/^\.\//, '');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p))
    throw new ToolError('Give the path inside the repository, e.g. src/app.ts');
  if (p.split('/').some((x) => x === '..' || x === '') || p === '.git' || p.startsWith('.git/'))
    throw new ToolError('That path is not inside the repository');
  return p;
}

const host = async (ctx: ToolContext) => {
  const p = await projectOf(ctx, {});
  const h = await projectHost(ctx.c, p.id);
  if (typeof h === 'string') throw new ToolError(h);
  return { project: p, host: h };
};
const hostFailed = (e: unknown): never => {
  if (e instanceof HostError) throw new ToolError(e.message);
  throw e;
};

const SANDBOX_TOOLS: Record<string, Tool> = {
  read_repo_file: {
    writes: false,
    needsApproval: false,
    spec: {
      name: 'read_repo_file',
      description:
        "Read a file of the project's repository (its default branch), or this run's own version once it wrote the file. Returns at most 100 000 characters.",
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'The path in the repository' } },
        required: ['path'],
      },
    },
    async run(ctx, input) {
      const path = sandboxPath(input);
      if (ctx.runId) {
        const own = (
          await ctx.c.query<{ text: string }>(
            'SELECT text FROM agent_run_files WHERE run_id = $1 AND path = $2',
            [ctx.runId, path],
          )
        ).rows[0];
        if (own)
          return {
            path,
            from: 'sandbox',
            text: own.text.slice(0, 100_000),
            truncated: own.text.length > 100_000,
          };
      }
      const { host: h } = await host(ctx);
      const f = await readRepoFile(h, path, ctx.fetchImpl).catch(hostFailed);
      if (!f) throw new ToolError('The repository has no ' + path);
      return {
        path,
        from: 'repository',
        text: f.text.slice(0, 100_000),
        truncated: f.text.length > 100_000,
      };
    },
  },
  write_file: {
    writes: true,
    needsApproval: false,
    spec: {
      name: 'write_file',
      description:
        "Write a whole file into this run's sandbox. Nothing reaches the repository until open_pull_request. Within the agent's file scope.",
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The path in the repository' },
          text: { type: 'string', description: 'The whole new text of the file' },
        },
        required: ['path', 'text'],
      },
    },
    async run(ctx, input) {
      if (!ctx.runId) throw new ToolError('Files are written within a run');
      const path = sandboxPath(input);
      const text = typeof input['text'] === 'string' ? input['text'] : '';
      if (text.length > SANDBOX_TEXT)
        throw new ToolError('The file is longer than 500 000 characters');
      const ok = agentScopeAllows(ctx.scope ?? {}, 'files', path, ctx.agentName);
      if (!ok.allowed) throw new ToolError('Refused: ' + ok.reason);
      const had = (
        await ctx.c.query<{ n: string; has: boolean }>(
          'SELECT count(*) AS n, bool_or(path = $2) AS has FROM agent_run_files WHERE run_id = $1',
          [ctx.runId, path],
        )
      ).rows[0];
      if (!had?.has && Number(had?.n ?? 0) >= SANDBOX_FILES)
        throw new ToolError('The sandbox holds at most 50 files');
      // the repository's text, kept the first time, so the pull request knows what changed
      let base: string | null = null;
      if (!had?.has) {
        const p = await projectOf(ctx, {});
        const h = await projectHost(ctx.c, p.id);
        if (typeof h !== 'string')
          base = (await readRepoFile(h, path, ctx.fetchImpl).catch(() => null))?.text ?? null;
      }
      await ctx.c.query(
        `INSERT INTO agent_run_files (workspace_id, run_id, path, text, base_text)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (run_id, path) DO UPDATE SET text = EXCLUDED.text, updated_at = now()`,
        [ctx.access.workspaceId, ctx.runId, path, text, base],
      );
      return {
        path,
        written: text.length,
        from: had?.has ? 'sandbox' : base === null ? 'new' : 'repository',
      };
    },
  },
  open_pull_request: {
    writes: true,
    needsApproval: true,
    spec: {
      name: 'open_pull_request',
      description:
        "Open a pull request with the files this run changed in its sandbox, on a new branch, committed by the agent's bot identity.",
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The pull request’s title' },
          body: { type: 'string', description: 'What changed and why' },
        },
        required: ['title'],
      },
    },
    async run(ctx, input) {
      if (!ctx.runId) throw new ToolError('A pull request is opened from a run');
      const title = str(input, 'title', 200);
      const files = (
        await ctx.c.query<{ path: string; text: string; base_text: string | null }>(
          'SELECT path, text, base_text FROM agent_run_files WHERE run_id = $1 ORDER BY path',
          [ctx.runId],
        )
      ).rows.filter((f) => f.text !== f.base_text);
      if (!files.length) throw new ToolError('The sandbox has no changed files');
      const { project, host: h } = await host(ctx);
      const key = (ctx.agentKey ?? 'agent').toLowerCase();
      const branch = 'agent/' + key + '-' + ctx.runId.slice(0, 8);
      const ok = agentScopeAllows(ctx.scope ?? {}, 'branches', branch, ctx.agentName);
      if (!ok.allowed) throw new ToolError('Refused: ' + ok.reason);
      const identity = await botIdentity(
        ctx.c,
        { key, name: ctx.agentName ?? 'Agent' },
        project.id,
      );
      const pull = await openPullRequest(
        h,
        files.map((f) => ({ path: f.path, text: f.text })),
        {
          branch,
          title,
          message: title + '\n\nOrqiva-Run: ' + ctx.runId,
          body:
            (optStr(input, 'body') ?? '').slice(0, 10_000) +
            '\n\nOpened by ' +
            (ctx.agentName ?? 'an agent') +
            ' from Orqiva run ' +
            ctx.runId +
            '. Written by an AI agent: review it like any other change.\n\n',
          identity,
        },
        ctx.fetchImpl,
      ).catch(hostFailed);
      if (!pull) throw new ToolError('Nothing differs from the repository');
      await ctx.c.query(
        'UPDATE agent_runs SET sandbox_pr_url = $2, sandbox_branch = $3 WHERE id = $1',
        [ctx.runId, pull.url, pull.branch],
      );
      return {
        url: pull.url,
        number: pull.number,
        branch: pull.branch,
        files: pull.changed,
        author: identity,
      };
    },
  },
};
Object.assign(TOOLS, SANDBOX_TOOLS);

export function toolSpecs(names: readonly string[]): ToolSpec[] {
  return names.flatMap((n) => (TOOLS[n] ? [TOOLS[n].spec] : []));
}

export const needsApproval = (name: string): boolean => TOOLS[name]?.needsApproval ?? false;

/** Runs a tool; a refusal comes back as an error result, never as an exception. */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ ok: boolean; content: string }> {
  const tool = TOOLS[name];
  if (!tool) return { ok: false, content: 'There is no tool ' + name };
  try {
    const out = await tool.run(ctx, input);
    return { ok: true, content: JSON.stringify(out) };
  } catch (e) {
    if (e instanceof ToolError || e instanceof HttpError) return { ok: false, content: e.message };
    throw e;
  }
}
