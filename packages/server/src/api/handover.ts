// ── [PCODE-199 | S15 | v0.1.0] T16.3 Handover pack on the server: checks, team checklist, frozen packs, PDF, client acceptance in the portal ──
//    Why:  a project hands over to its client with a complete pack. The checks say live what is still
//          missing; the team's own checklist covers what only people can confirm. Sending freezes a
//          numbered pack: the checks, the pages at their versions, the release, the tests, the acceptance
//          and the open tasks as they were. The client reads exactly that pack in the portal, downloads it
//          as PDF, and accepts it with a signed name (an approval over the pack's hash) or asks for
//          changes; acceptance finishes the lifecycle's handover stage.
import {
  DEFAULT_HANDOVER_ITEMS,
  handoverChecks,
  handoverReady,
  mayApproveChange,
  packPages,
  type HandoverCheck,
  type HandoverFacts,
  type HandoverPage,
} from '@orqiva/shared';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { A4, pdfDocument, textWidth, type PdfPage, type PdfText } from '../lib/pdf.js';
import { actorOf, asMember, requireProject, type Access, type ProjectRow } from './access.js';
import { driftPages } from './codedocs.js';
import { contactWho, portalScope } from './portal.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const packParams = s.object({ workspaceId: uuid, packId: uuid });
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

/** What a sent pack holds, frozen. */
export interface PackContents {
  project: { key: string; name: string };
  client: string | null;
  checks: HandoverCheck[];
  pages: { id: string; title: string; version: number; generated: boolean }[];
  release: { version: string; notes: string; releasedAt: string | null } | null;
  tests: { name: string; passed: number; failed: number; finishedAt: string | null } | null;
  acceptance: { name: string; accepted: boolean; signedName: string; at: string | null } | null;
  openTasks: { ref: string; title: string; state: string }[];
  note: string;
}

interface Gathered {
  facts: HandoverFacts;
  pages: HandoverPage[];
  release: PackContents['release'];
  tests: PackContents['tests'];
  acceptance: PackContents['acceptance'];
  openTasks: PackContents['openTasks'];
  items: {
    id: string;
    label: string;
    done: boolean;
    doneBy: string | null;
    doneAt: string | null;
    note: string;
  }[];
}

/** Everything the checks look at, read once. */
async function gather(c: PoolClient, projectId: string): Promise<Gathered> {
  const pages = (
    await c.query<HandoverPage>(
      `SELECT id, title, status, version, (agent_written AND approved_at IS NULL) AS "needsApproval",
              coalesce(review_by < (now() AT TIME ZONE 'Europe/Berlin')::date, false) AS stale,
              generated_key IS NOT NULL AS generated, client_visible AS "clientVisible"
         FROM doc_pages WHERE project_id = $1 AND kind = 'page' AND deleted_at IS NULL ORDER BY title`,
      [projectId],
    )
  ).rows;
  const drift = (await driftPages(c, projectId)).length;
  const rel = (
    await c.query<{
      version: string;
      state: string;
      notes_client: string;
      released_at: Date | null;
    }>(
      `SELECT version, state, notes_client, released_at FROM releases WHERE project_id = $1
        ORDER BY coalesce(released_at, created_at) DESC LIMIT 1`,
      [projectId],
    )
  ).rows[0];
  const run = (
    await c.query<{ name: string; passed: string; failed: string; finished_at: Date | null }>(
      `SELECT r.name, r.finished_at,
              (SELECT count(*) FROM test_results x WHERE x.run_id = r.id AND x.status = 'passed') AS passed,
              (SELECT count(*) FROM test_results x WHERE x.run_id = r.id AND x.status = 'failed') AS failed
         FROM test_runs r WHERE r.project_id = $1 AND r.status = 'done' AND NOT r.client_round
        ORDER BY r.finished_at DESC NULLS LAST LIMIT 1`,
      [projectId],
    )
  ).rows[0];
  const round = (
    await c.query<{ name: string; signed_name: string | null; at: Date | null }>(
      `SELECT r.name, x.signed_name, x.created_at AS at FROM test_runs r
         LEFT JOIN LATERAL (SELECT signed_name, created_at FROM approvals
                             WHERE object_type = 'acceptance' AND object_id = r.id::text AND decision = 'approved'
                             ORDER BY created_at DESC LIMIT 1) x ON true
        WHERE r.project_id = $1 AND r.client_round AND r.status <> 'cancelled'
        ORDER BY r.started_at DESC LIMIT 1`,
      [projectId],
    )
  ).rows[0];
  const serious = Number(
    (
      await c.query<{ n: string }>(
        "SELECT count(*) AS n FROM findings WHERE project_id = $1 AND status = 'open' AND severity IN ('critical', 'high')",
        [projectId],
      )
    ).rows[0]?.n ?? 0,
  );
  const open = (
    await c.query<{ ref: string; title: string; state: string }>(
      `SELECT p.key || '-' || i.sequence AS ref, i.title, st.name AS state
         FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
        WHERE i.project_id = $1 AND st.grp IN ('backlog', 'unstarted', 'started') ORDER BY i.sequence`,
      [projectId],
    )
  ).rows;
  const items = (
    await c.query<{
      id: string;
      label: string;
      done: boolean;
      done_by: string | null;
      done_at: Date | null;
      note: string;
    }>(
      `SELECT h.id, h.label, h.done, u.name AS done_by, h.done_at, h.note FROM handover_items h
         LEFT JOIN users u ON u.id = h.done_by WHERE h.project_id = $1 ORDER BY h.rank, h.created_at`,
      [projectId],
    )
  ).rows.map((r) => ({
    id: r.id,
    label: r.label,
    done: r.done,
    doneBy: r.done_by,
    doneAt: r.done_at?.toISOString() ?? null,
    note: r.note,
  }));
  return {
    facts: {
      pages,
      drift,
      release: rel
        ? { version: rel.version, state: rel.state, hasClientNotes: rel.notes_client.trim() !== '' }
        : null,
      tests: run
        ? { name: run.name, passed: Number(run.passed), failed: Number(run.failed) }
        : null,
      acceptance: round ? { name: round.name, accepted: round.signed_name !== null } : null,
      seriousFindings: serious,
      openTasks: open.length,
      items,
    },
    pages,
    release: rel
      ? {
          version: rel.version,
          notes: rel.notes_client,
          releasedAt: rel.released_at?.toISOString() ?? null,
        }
      : null,
    tests: run
      ? {
          name: run.name,
          passed: Number(run.passed),
          failed: Number(run.failed),
          finishedAt: run.finished_at?.toISOString() ?? null,
        }
      : null,
    acceptance: round
      ? {
          name: round.name,
          accepted: round.signed_name !== null,
          signedName: round.signed_name ?? '',
          at: round.at?.toISOString() ?? null,
        }
      : null,
    openTasks: open.slice(0, 200),
    items,
  };
}

interface PackRow {
  id: string;
  project_id: string;
  number: number;
  status: string;
  note: string;
  contents: PackContents;
  hash: string;
  sent_by_name: string | null;
  sent_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
  signed_name: string;
  decision_note: string;
}
const PACK_SELECT = `SELECT k.id, k.project_id, k.number, k.status, k.note, k.contents, k.hash, s.name AS sent_by_name, k.sent_at,
       d.name AS decided_by_name, k.decided_at, k.signed_name, k.decision_note
  FROM handover_packs k LEFT JOIN users s ON s.id = k.sent_by LEFT JOIN users d ON d.id = k.decided_by`;

const packSummary = s.object({
  id: s.string(),
  number: s.number({ integer: true }),
  status: s.string(),
  note: s.string(),
  hash: s.string(),
  sentBy: s.nullable(s.string()),
  sentAt: s.string(),
  decidedBy: s.nullable(s.string()),
  decidedAt: s.nullable(s.string()),
  signedName: s.string(),
  decisionNote: s.string(),
});
const summaryJson = (r: PackRow) => ({
  id: r.id,
  number: r.number,
  status: r.status,
  note: r.note,
  hash: r.hash,
  sentBy: r.sent_by_name,
  sentAt: r.sent_at.toISOString(),
  decidedBy: r.decided_by_name,
  decidedAt: r.decided_at?.toISOString() ?? null,
  signedName: r.signed_name,
  decisionNote: r.decision_note,
});
const checkOut = s.object({
  key: s.string(),
  label: s.string(),
  state: s.string(),
  detail: s.string(),
});
const packOut = s.object({ pack: packSummary, contents: s.anyObject() });

// ── [PCODE-199 | S15 | v0.1.0] the pack as PDF: cover, checks, then every page as sent ──
const plainLine = (line: string): { text: string; bold: boolean; size: number } => {
  const h = /^(#{1,6})\s+(.*)$/.exec(line);
  if (h) return { text: h[2] ?? '', bold: true, size: (h[1]?.length ?? 1) <= 1 ? 14 : 12 };
  const text = line
    .replace(/^\s*[-*]\s+\[( |x)\]\s+/i, (m) => (/x/i.test(m) ? '[x] ' : '[ ] '))
    .replace(/^\s*[-*]\s+/, '• ')
    .replace(/^\|\s*-[-|\s:]*$/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  return { text, bold: false, size: 10 };
};

/** Lines wrapped to a width, at a size. */
function wrap(text: string, size: number, bold: boolean, width: number): string[] {
  if (!text) return [''];
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const next = cur ? cur + ' ' + word : word;
    if (textWidth(next, size, bold) <= width || !cur) cur = next;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function packPdf(
  pack: { number: number; sentAt: string; status: string; signedName: string },
  contents: PackContents,
  bodies: { title: string; version: number; body: string }[],
): Buffer {
  const L = 56;
  const width = A4.width - 2 * L;
  const pages: PdfPage[] = [];
  let texts: PdfText[] = [];
  let y = 780;
  const flush = (): void => {
    pages.push({ texts });
    texts = [];
    y = 780;
  };
  const put = (text: string, size = 10, bold = false, gap = 4): void => {
    for (const l of wrap(text, size, bold, width)) {
      if (y < 70) flush();
      texts.push({ x: L, y, size, text: l, bold });
      y -= size + gap;
    }
  };
  const STATE: Record<string, string> = { ok: 'OK', warn: 'Note', missing: 'Missing' };
  put('Handover pack ' + String(pack.number), 20, true, 10);
  put(
    contents.project.key +
      ' · ' +
      contents.project.name +
      (contents.client ? ' for ' + contents.client : ''),
    12,
  );
  put(
    'Sent ' +
      pack.sentAt.slice(0, 10) +
      (pack.signedName ? ' · accepted by ' + pack.signedName : ''),
    10,
    false,
    14,
  );
  if (contents.note) put(contents.note, 10, false, 14);
  put('Checks', 14, true, 8);
  for (const ch of contents.checks)
    put((STATE[ch.state] ?? ch.state) + ' – ' + ch.label + ': ' + ch.detail);
  y -= 8;
  if (contents.release)
    put(
      'Release ' +
        contents.release.version +
        (contents.release.releasedAt ? ', ' + contents.release.releasedAt.slice(0, 10) : ''),
      12,
      true,
      6,
    );
  if (contents.tests)
    put(
      'Tests: ' +
        contents.tests.name +
        ', ' +
        String(contents.tests.passed) +
        ' passed, ' +
        String(contents.tests.failed) +
        ' failed',
    );
  if (contents.acceptance)
    put(
      'Acceptance: ' +
        contents.acceptance.name +
        (contents.acceptance.accepted
          ? ', accepted by ' + contents.acceptance.signedName
          : ', not accepted'),
    );
  if (contents.openTasks.length) {
    y -= 8;
    put('Open tasks (' + String(contents.openTasks.length) + ')', 12, true, 6);
    for (const t of contents.openTasks) put(t.ref + ' ' + t.title + ' (' + t.state + ')');
  }
  y -= 8;
  put('Documents', 14, true, 8);
  for (const p of contents.pages) put('• ' + p.title + ' (version ' + String(p.version) + ')');
  for (const b of bodies) {
    flush();
    put(b.title, 16, true, 4);
    put('Version ' + String(b.version), 9, false, 12);
    let fence = false;
    for (const raw of b.body.split('\n')) {
      if (raw.startsWith('```')) {
        fence = !fence;
        continue;
      }
      const l = fence ? { text: raw, bold: false, size: 9 } : plainLine(raw);
      if (!l.text.trim()) {
        y -= 6;
        continue;
      }
      put(l.text, l.size, l.bold, l.bold ? 6 : 4);
    }
  }
  if (texts.length) flush();
  return pdfDocument(pages, 'Handover pack ' + String(pack.number) + ' ' + contents.project.key);
}

/** The bodies of a pack's pages, exactly at the versions it was sent with. */
async function packBodies(
  c: PoolClient,
  contents: PackContents,
): Promise<{ id: string; title: string; version: number; body: string }[]> {
  if (!contents.pages.length) return [];
  const rows = (
    await c.query<{ page_id: string; title: string; version: number; body: string }>(
      `SELECT v.page_id, v.title, v.version, v.body FROM doc_versions v
         JOIN unnest($1::uuid[], $2::int[]) AS w(page_id, version) ON w.page_id = v.page_id AND w.version = v.version`,
      [contents.pages.map((p) => p.id), contents.pages.map((p) => p.version)],
    )
  ).rows;
  return contents.pages.flatMap((p) => {
    const r = rows.find((x) => x.page_id === p.id);
    return r ? [{ id: p.id, title: r.title, version: r.version, body: r.body }] : [];
  });
}

async function packEvent(
  c: PoolClient,
  a: Access,
  project: { id: string; key: string },
  pack: { id: string; number: number },
  verb: 'created' | 'completed' | 'updated',
  changes: Record<string, { from: unknown; to: unknown }>,
): Promise<void> {
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb,
      object: { type: 'handover', id: pack.id, label: 'Handover pack ' + String(pack.number) },
      parent: { type: 'project', id: project.id, label: project.key },
      changes,
    },
    { projectId: project.id },
  );
}

const fileOf = (contents: PackContents, number: number): string =>
  'handover-' + contents.project.key.toLowerCase() + '-' + String(number) + '.pdf';

export function handoverRoutes(pool: Pool): Route[] {
  const itemOf = async (
    c: PoolClient,
    a: Access,
    id: string,
  ): Promise<{ id: string; project: ProjectRow }> => {
    const r = (
      await c.query<{ project_id: string }>('SELECT project_id FROM handover_items WHERE id = $1', [
        id,
      ])
    ).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'Checklist item not found');
    return { id, project: await requireProject(c, a, r.project_id) };
  };
  const packOf = async (c: PoolClient, a: Access, id: string): Promise<PackRow> => {
    const r = (await c.query<PackRow>(PACK_SELECT + ' WHERE k.id = $1', [id])).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'Pack not found');
    await requireProject(c, a, r.project_id);
    return r;
  };

  const status = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/handover',
    summary: 'The handover checks as of now, the team checklist and the packs sent',
    tags: ['handover'],
    params: projectParams,
    response: s.object({
      checks: s.array(checkOut),
      ready: s.boolean(),
      items: s.array(
        s.object({
          id: s.string(),
          label: s.string(),
          done: s.boolean(),
          doneBy: s.nullable(s.string()),
          doneAt: s.nullable(s.string()),
          note: s.string(),
        }),
      ),
      suggested: s.array(s.string()),
      client: s.nullable(s.string()),
      pages: s.array(
        s.object({ id: s.string(), title: s.string(), version: s.number({ integer: true }) }),
      ),
      packs: s.array(packSummary),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const g = await gather(c, p.id);
        const checks = handoverChecks(g.facts);
        const client =
          (
            await c.query<{ name: string }>(
              'SELECT cl.name FROM projects p JOIN clients cl ON cl.id = p.client_id WHERE p.id = $1',
              [p.id],
            )
          ).rows[0]?.name ?? null;
        const packs = (
          await c.query<PackRow>(PACK_SELECT + ' WHERE k.project_id = $1 ORDER BY k.number DESC', [
            p.id,
          ])
        ).rows;
        return {
          body: {
            checks,
            ready: handoverReady(checks),
            items: g.items,
            suggested: DEFAULT_HANDOVER_ITEMS.filter((d) => !g.items.some((i) => i.label === d)),
            client,
            pages: packPages(g.pages).map((x) => ({
              id: x.id,
              title: x.title,
              version: x.version,
            })),
            packs: packs.map(summaryJson),
          },
        };
      }),
  });

  const addItem = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/handover/items',
    summary: 'Add to the team checklist: one item, or the suggested ones (member)',
    tags: ['handover'],
    params: projectParams,
    body: s.object({
      label: s.optional(s.string({ min: 1, max: 200 })),
      suggested: s.optional(s.boolean()),
    }),
    response: s.object({ added: s.number({ integer: true }) }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const have = (
          await c.query<{ label: string }>(
            'SELECT label FROM handover_items WHERE project_id = $1',
            [p.id],
          )
        ).rows.map((r) => r.label);
        const labels = body.suggested
          ? DEFAULT_HANDOVER_ITEMS.filter((d) => !have.includes(d))
          : body.label?.trim()
            ? [body.label.trim()]
            : [];
        if (!labels.length && !body.suggested)
          throw new HttpError(400, 'invalid_request', 'Name the item', [
            { path: 'body.label', message: 'is required' },
          ]);
        for (const l of labels)
          await c.query(
            `INSERT INTO handover_items (workspace_id, project_id, label, rank)
             VALUES ($1, $2, $3, (SELECT coalesce(max(rank), 0) + 1 FROM handover_items WHERE project_id = $2))`,
            [a.workspaceId, p.id, l],
          );
        return { status: 201, body: { added: labels.length } };
      }),
  });

  const changeItem = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/handover-items/:itemId',
    summary: 'Tick a checklist item, untick it, rename it or note something on it (member)',
    tags: ['handover'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    body: s.object({
      done: s.optional(s.boolean()),
      label: s.optional(s.string({ min: 1, max: 200 })),
      note: s.optional(s.string({ max: 2000 })),
    }),
    response: s.object({ ok: s.boolean() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = await itemOf(c, a, params.itemId);
        await c.query(
          `UPDATE handover_items SET label = coalesce($2, label), note = coalesce($3, note),
                  done = coalesce($4, done),
                  done_by = CASE WHEN $4 IS NULL THEN done_by WHEN $4 THEN $5::uuid ELSE NULL END,
                  done_at = CASE WHEN $4 IS NULL THEN done_at WHEN $4 THEN now() ELSE NULL END
            WHERE id = $1`,
          [it.id, body.label?.trim() ?? null, body.note ?? null, body.done ?? null, a.user.id],
        );
        return { body: { ok: true } };
      }),
  });

  const removeItem = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/handover-items/:itemId',
    summary: 'Take an item off the team checklist (member)',
    tags: ['handover'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    response: s.object({ ok: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = await itemOf(c, a, params.itemId);
        await c.query('DELETE FROM handover_items WHERE id = $1', [it.id]);
        return { body: { ok: true } };
      }),
  });

  const send = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/handover/packs',
    summary:
      'Send a handover pack: a frozen, numbered snapshot; refused while something required is missing (member)',
    tags: ['handover'],
    params: projectParams,
    body: s.object({ note: s.optional(s.string({ max: 4000 })) }),
    response: packOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        await c.query('SELECT 1 FROM projects WHERE id = $1 FOR UPDATE', [p.id]);
        const g = await gather(c, p.id);
        const checks = handoverChecks(g.facts);
        if (!handoverReady(checks))
          throw new HttpError(
            409,
            'conflict',
            'Not ready to hand over: ' +
              checks
                .filter((x) => x.state === 'missing')
                .map((x) => x.label)
                .join(', '),
          );
        const client =
          (
            await c.query<{ name: string }>(
              'SELECT cl.name FROM projects p JOIN clients cl ON cl.id = p.client_id WHERE p.id = $1',
              [p.id],
            )
          ).rows[0]?.name ?? null;
        const contents: PackContents = {
          project: { key: p.key, name: p.name },
          client,
          checks,
          pages: packPages(g.pages).map((x) => ({
            id: x.id,
            title: x.title,
            version: x.version,
            generated: x.generated,
          })),
          release: g.release,
          tests: g.tests,
          acceptance: g.acceptance,
          openTasks: g.openTasks,
          note: body.note?.trim() ?? '',
        };
        const number =
          ((
            await c.query<{ n: number | null }>(
              'SELECT max(number) AS n FROM handover_packs WHERE project_id = $1',
              [p.id],
            )
          ).rows[0]?.n ?? 0) + 1;
        await c.query(
          "UPDATE handover_packs SET status = 'superseded' WHERE project_id = $1 AND status = 'sent'",
          [p.id],
        );
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO handover_packs (workspace_id, project_id, number, note, contents, hash, sent_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
              a.workspaceId,
              p.id,
              number,
              contents.note,
              JSON.stringify(contents),
              sha256(JSON.stringify(contents)),
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('pack insert returned nothing');
        await packEvent(c, a, p, { id, number }, 'created', { status: { from: null, to: 'sent' } });
        const r = await packOf(c, a, id);
        return {
          status: 201,
          body: {
            pack: summaryJson(r),
            contents: r.contents as unknown as Record<string, unknown>,
          },
        };
      }),
  });

  const getPack = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/handover-packs/:packId',
    summary: 'One pack as it was sent',
    tags: ['handover'],
    params: packParams,
    response: packOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const r = await packOf(c, a, params.packId);
        return {
          body: {
            pack: summaryJson(r),
            contents: r.contents as unknown as Record<string, unknown>,
          },
        };
      }),
  });

  const pageParams = s.object({ workspaceId: uuid, packId: uuid, pageId: uuid });
  const pageOut = s.object({
    id: s.string(),
    title: s.string(),
    version: s.number({ integer: true }),
    body: s.string(),
  });
  const packPage = async (c: PoolClient, contents: PackContents, pageId: string) => {
    const b = (await packBodies(c, contents)).find((x) => x.id === pageId);
    if (!b) throw new HttpError(404, 'not_found', 'The pack has no such page');
    return b;
  };

  const getPackPage = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/handover-packs/:packId/pages/:pageId',
    summary: 'A page of a pack, at the version the pack was sent with',
    tags: ['handover'],
    params: pageParams,
    response: pageOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const r = await packOf(c, a, params.packId);
        return { body: await packPage(c, r.contents, params.pageId) };
      }),
  });

  const pdf = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/handover-packs/:packId/pdf',
    summary: 'A pack as PDF: cover, checks and every page as sent',
    tags: ['handover'],
    params: packParams,
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const r = await packOf(c, a, params.packId);
        return {
          body: {},
          file: {
            data: packPdf(
              {
                number: r.number,
                sentAt: r.sent_at.toISOString(),
                status: r.status,
                signedName: r.signed_name,
              },
              r.contents,
              await packBodies(c, r.contents),
            ),
            contentType: 'application/pdf',
            name: fileOf(r.contents, r.number),
            inline: true,
          },
        };
      }),
  });

  // ── [PCODE-199 | S15 | v0.1.0] the client's side: read, download, accept or ask for changes ──
  const clientQuery = s.object({ clientId: s.optional(uuid) });
  const portalPack = async (c: PoolClient, projectIds: string[], id: string): Promise<PackRow> => {
    const r = (
      await c.query<PackRow>(PACK_SELECT + ' WHERE k.id = $1 AND k.project_id = ANY($2::uuid[])', [
        id,
        projectIds,
      ])
    ).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'Pack not found');
    return r;
  };

  const portalList = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/handover',
    summary: 'The handover packs sent to the client, newest first',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    query: clientQuery,
    response: s.object({
      mayDecide: s.boolean(),
      packs: s.array(
        s.object({
          projectKey: s.string(),
          projectName: s.string(),
          latest: s.boolean(),
          pack: packSummary,
        }),
      ),
    }),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const rows = (
          await c.query<PackRow>(
            PACK_SELECT + ' WHERE k.project_id = ANY($1::uuid[]) ORDER BY k.sent_at DESC',
            [ctx.projectIds],
          )
        ).rows;
        const latest = new Map<string, number>();
        for (const r of rows)
          latest.set(r.project_id, Math.max(latest.get(r.project_id) ?? 0, r.number));
        return {
          body: {
            mayDecide: !ctx.asTeam && mayApproveChange(ctx.roles),
            packs: rows.map((r) => {
              const pr = ctx.projects.find((x) => x.id === r.project_id);
              return {
                projectKey: pr?.key ?? '',
                projectName: pr?.name ?? '',
                latest: latest.get(r.project_id) === r.number,
                pack: summaryJson(r),
              };
            }),
          },
        };
      }),
  });

  const portalGet = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/handover/:packId',
    summary: 'One pack as it was sent, for the client',
    tags: ['portal'],
    params: packParams,
    query: clientQuery,
    response: packOut,
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const r = await portalPack(c, ctx.projectIds, params.packId);
        return {
          body: {
            pack: summaryJson(r),
            contents: r.contents as unknown as Record<string, unknown>,
          },
        };
      }),
  });

  const portalPage = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/handover/:packId/pages/:pageId',
    summary: 'A page of a pack, at the version it was sent with, for the client',
    tags: ['portal'],
    params: pageParams,
    query: clientQuery,
    response: pageOut,
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const r = await portalPack(c, ctx.projectIds, params.packId);
        return { body: await packPage(c, r.contents, params.pageId) };
      }),
  });

  const portalPdf = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/handover/:packId/pdf',
    summary: 'A pack as PDF, for the client',
    tags: ['portal'],
    params: packParams,
    query: clientQuery,
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const r = await portalPack(c, ctx.projectIds, params.packId);
        return {
          body: {},
          file: {
            data: packPdf(
              {
                number: r.number,
                sentAt: r.sent_at.toISOString(),
                status: r.status,
                signedName: r.signed_name,
              },
              r.contents,
              await packBodies(c, r.contents),
            ),
            contentType: 'application/pdf',
            name: fileOf(r.contents, r.number),
            inline: true,
          },
        };
      }),
  });

  const decide = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/portal/handover/:packId/decision',
    summary: 'The client accepts the pack with a signed name, or asks for changes with a note',
    tags: ['portal'],
    params: packParams,
    body: s.object({
      decision: s.enum(['accepted', 'changes_requested']),
      signedName: s.optional(s.string({ max: 200 })),
      note: s.optional(s.string({ max: 4000 })),
    }),
    response: packSummary,
    handler: ({ params, body, req }) =>
      portalScope(pool, req, params.workspaceId, undefined, async (c, ctx) => {
        contactWho(
          ctx,
          mayApproveChange,
          'Only the client’s sponsor, approvers or product owner accept a handover',
        );
        const r = await portalPack(c, ctx.projectIds, params.packId);
        if (r.status !== 'sent')
          throw new HttpError(
            409,
            'conflict',
            'This pack is ' +
              r.status.replace('_', ' ') +
              '; only the latest sent pack is decided on',
          );
        const signed = body.signedName?.trim() ?? '';
        const note = body.note?.trim() ?? '';
        if (body.decision === 'accepted' && signed.length < 3)
          throw new HttpError(400, 'invalid_request', 'Sign with your full name', [
            { path: 'body.signedName', message: 'is required to accept' },
          ]);
        if (body.decision === 'changes_requested' && !note)
          throw new HttpError(400, 'invalid_request', 'Say what should change', [
            { path: 'body.note', message: 'is required to ask for changes' },
          ]);
        await c.query(
          `UPDATE handover_packs SET status = $2, decided_by = $3, decided_at = now(), signed_name = $4, decision_note = $5 WHERE id = $1`,
          [r.id, body.decision, ctx.access.user.id, signed, note],
        );
        await c.query(
          `INSERT INTO approvals (workspace_id, project_id, object_type, object_id, version_hash, approver_id, decision, signed_name, note)
           VALUES ($1, $2, 'handover', $3, $4, $5, $6, $7, $8)`,
          [
            ctx.access.workspaceId,
            r.project_id,
            r.id,
            r.hash,
            ctx.access.user.id,
            body.decision === 'accepted' ? 'approved' : 'declined',
            signed,
            note,
          ],
        );
        if (body.decision === 'accepted')
          await c.query(
            `UPDATE lifecycle_stages SET status = 'done', finished_at = now(), changed_by = $2, note = $3
              WHERE project_id = $1 AND stage_key = 'handover' AND status <> 'done'`,
            [
              r.project_id,
              ctx.access.user.id,
              'Accepted by ' + signed + ' (pack ' + String(r.number) + ')',
            ],
          );
        const pr = ctx.projects.find((x) => x.id === r.project_id);
        await packEvent(
          c,
          ctx.access,
          { id: r.project_id, key: pr?.key ?? '' },
          { id: r.id, number: r.number },
          body.decision === 'accepted' ? 'completed' : 'updated',
          { status: { from: 'sent', to: body.decision } },
        );
        return { body: summaryJson(await portalPack(c, ctx.projectIds, r.id)) };
      }),
  });

  return [
    status,
    addItem,
    changeItem,
    removeItem,
    send,
    getPack,
    getPackPage,
    pdf,
    portalList,
    portalGet,
    portalPage,
    portalPdf,
    decide,
  ];
}
