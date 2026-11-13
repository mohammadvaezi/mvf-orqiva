// ── [PCODE-292 | S15 | v0.1.0] T30.6 Handoff specs per mockup: tokens, components, states, breakpoints, measures, export areas ──
//    Why:  the spec a mockup version is built from lives with that version. Reading a version without a
//          spec of its own gives the last earlier one, marked as carried over, so a new version starts from
//          what was already agreed. The spec goes out as Markdown or JSON for developers and agents.
import {
  EXPORT_FORMATS,
  emptyHandoff,
  handoffMarkdown,
  handoffProblems,
  type HandoffSpec,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';
import { asTheme, asToken, fileUrl, loadThemes, loadTokens, mockupOf } from './uikit.js';

const uuid = s.string({ format: 'uuid' });
const params = s.object({ workspaceId: uuid, mockupId: uuid });
const share = s.number({ min: 0, max: 1 });
const text = (max: number) => s.string({ max });

const specIn = s.object({
  imageWidth: s.number({ integer: true, min: 0, max: 100000 }),
  imageHeight: s.number({ integer: true, min: 0, max: 100000 }),
  tokens: s.array(s.string({ min: 1, max: 100 }), { max: 300 }),
  components: s.array(uuid, { max: 200 }),
  states: s.array(s.object({ name: s.string({ min: 1, max: 80 }), note: text(1000) }), {
    max: 50,
  }),
  breakpoints: s.array(
    s.object({
      name: s.string({ min: 1, max: 40 }),
      width: s.number({ integer: true, min: 0, max: 10000 }),
      note: text(1000),
    }),
    { max: 20 },
  ),
  measures: s.array(s.object({ x1: share, y1: share, x2: share, y2: share, label: text(120) }), {
    max: 200,
  }),
  exports: s.array(
    s.object({
      name: s.string({ min: 1, max: 80 }),
      x: share,
      y: share,
      w: share,
      h: share,
      formats: s.array(s.enum(EXPORT_FORMATS), { min: 1, max: 4 }),
      scales: s.array(s.number({ min: 0.5, max: 4 }), { min: 1, max: 4 }),
    }),
    { max: 100 },
  ),
  notes: text(10000),
});

const handoffOut = s.object({
  version: s.number({ integer: true }),
  /** the version whose spec this is; null when there is none yet */
  specVersion: s.nullable(s.number({ integer: true })),
  carried: s.boolean(),
  spec: s.anyObject(),
  problems: s.array(s.string()),
  components: s.array(
    s.object({ id: s.string(), name: s.string(), codePath: s.string(), status: s.string() }),
  ),
  updatedBy: s.nullable(s.string()),
  updatedAt: s.nullable(s.string()),
});

interface Loaded {
  version: number;
  specVersion: number | null;
  spec: HandoffSpec;
  updatedBy: string | null;
  updatedAt: Date | null;
}

async function loadSpec(c: PoolClient, mockupId: string, version: number): Promise<Loaded> {
  const r = (
    await c.query<{
      version: number;
      spec: HandoffSpec;
      updated_by: string | null;
      updated_at: Date;
    }>(
      'SELECT h.version, h.spec, u.name AS updated_by, h.updated_at FROM mockup_handoff h LEFT JOIN users u ON u.id = h.updated_by WHERE h.mockup_id = $1 AND h.version <= $2 ORDER BY h.version DESC LIMIT 1',
      [mockupId, version],
    )
  ).rows[0];
  return r
    ? {
        version,
        specVersion: r.version,
        spec: { ...emptyHandoff(), ...r.spec },
        updatedBy: r.updated_by,
        updatedAt: r.updated_at,
      }
    : { version, specVersion: null, spec: emptyHandoff(), updatedBy: null, updatedAt: null };
}

const componentsOf = async (c: PoolClient, projectId: string) =>
  (
    await c.query<{ id: string; name: string; code_path: string; status: string }>(
      'SELECT id, name, code_path, status FROM ui_components WHERE project_id = $1 ORDER BY name',
      [projectId],
    )
  ).rows.map((x) => ({ id: x.id, name: x.name, codePath: x.code_path, status: x.status }));

async function versionOf(
  c: PoolClient,
  mockupId: string,
  asked: number | undefined,
  current: number,
) {
  const v = asked ?? current;
  const ok = (
    await c.query('SELECT 1 FROM mockup_versions WHERE mockup_id = $1 AND version = $2', [
      mockupId,
      v,
    ])
  ).rowCount;
  if (!ok) throw new HttpError(404, 'not_found', 'The mockup has no version ' + String(v));
  return v;
}

export function handoffRoutes(pool: Pool): Route[] {
  const versionQuery = s.object({ version: s.optional(s.string({ max: 6 })) });
  const num = (v: string | undefined): number | undefined => {
    if (v === undefined) return undefined;
    if (!/^\d{1,6}$/.test(v))
      throw new HttpError(400, 'invalid_request', 'The version is a number', [
        { path: 'query.version', message: 'must be a whole number' },
      ]);
    return Number(v);
  };

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/mockups/:mockupId/handoff',
    summary:
      'The handoff spec of a mockup version (the current one by default); without its own, the last earlier one',
    tags: ['uikit'],
    params,
    query: versionQuery,
    response: handoffOut,
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const m = await mockupOf(c, a, params.mockupId);
        const v = await versionOf(c, m.id, num(query.version), m.version);
        const h = await loadSpec(c, m.id, v);
        const tokens = (await loadTokens(c, m.project_id)).map(asToken);
        const components = await componentsOf(c, m.project_id);
        return {
          body: {
            version: v,
            specVersion: h.specVersion,
            carried: h.specVersion !== null && h.specVersion !== v,
            spec: { ...h.spec },
            problems: handoffProblems(h.spec, tokens, components),
            components,
            updatedBy: h.updatedBy,
            updatedAt: h.updatedAt?.toISOString() ?? null,
          },
        };
      }),
  });

  const put = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/mockups/:mockupId/handoff',
    summary: 'Write the handoff spec of a mockup version (member)',
    tags: ['uikit'],
    params,
    body: s.object({ version: s.number({ integer: true, min: 1 }), spec: specIn }),
    response: handoffOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const m = await mockupOf(c, a, params.mockupId);
        const v = await versionOf(c, m.id, body.version, m.version);
        const components = await componentsOf(c, m.project_id);
        const ids = new Set(components.map((x) => x.id));
        const stranger = body.spec.components.findIndex((id) => !ids.has(id));
        if (stranger >= 0)
          throw new HttpError(400, 'invalid_request', 'A component of another project', [
            { path: 'body.spec.components.' + String(stranger), message: 'is not in this project' },
          ]);
        const spec: HandoffSpec = {
          ...body.spec,
          tokens: [...new Set(body.spec.tokens.map((t) => t.trim()))],
          components: [...new Set(body.spec.components)],
          states: body.spec.states.map((x) => ({ name: x.name.trim(), note: x.note.trim() })),
          breakpoints: body.spec.breakpoints.map((x) => ({
            ...x,
            name: x.name.trim(),
            note: x.note.trim(),
          })),
          measures: body.spec.measures.map((x) => ({ ...x, label: x.label.trim() })),
          exports: body.spec.exports.map((x) => ({
            ...x,
            name: x.name.trim(),
            formats: [...new Set(x.formats)],
            scales: [...new Set(x.scales)].sort((p, q) => p - q),
          })),
          notes: body.spec.notes.trim(),
        };
        await c.query(
          `INSERT INTO mockup_handoff (workspace_id, mockup_id, version, spec, updated_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (mockup_id, version) DO UPDATE SET spec = EXCLUDED.spec, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [a.workspaceId, m.id, v, JSON.stringify(spec), a.user.id],
        );
        const h = await loadSpec(c, m.id, v);
        const tokens = (await loadTokens(c, m.project_id)).map(asToken);
        return {
          body: {
            version: v,
            specVersion: v,
            carried: false,
            spec: { ...h.spec },
            problems: handoffProblems(h.spec, tokens, components),
            components,
            updatedBy: h.updatedBy,
            updatedAt: h.updatedAt?.toISOString() ?? null,
          },
        };
      }),
  });

  const download = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/mockups/:mockupId/handoff/export',
    summary:
      'The handoff spec of a mockup version as Markdown or JSON, to hand to a developer or an agent',
    tags: ['uikit'],
    params,
    query: s.object({
      version: s.optional(s.string({ max: 6 })),
      format: s.optional(s.enum(['md', 'json'])),
    }),
    response: s.object({}),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const m = await mockupOf(c, a, params.mockupId);
        const v = await versionOf(c, m.id, num(query.version), m.version);
        const h = await loadSpec(c, m.id, v);
        const tokens = (await loadTokens(c, m.project_id)).map(asToken);
        const themes = (await loadThemes(c, m.project_id)).map(asTheme);
        const components = await componentsOf(c, m.project_id);
        const fileId = (
          await c.query<{ file_id: string }>(
            'SELECT file_id FROM mockup_versions WHERE mockup_id = $1 AND version = $2',
            [m.id, v],
          )
        ).rows[0]?.file_id;
        const imageUrl = fileId ? fileUrl(a.workspaceId, fileId) : '';
        const slug =
          m.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'mockup';
        const name = 'handoff-' + slug + '-v' + String(v);
        if (query.format === 'json') {
          const used = new Set(h.spec.tokens);
          const json = {
            mockup: { id: m.id, title: m.title, status: m.status, version: v, imageUrl },
            specVersion: h.specVersion,
            spec: { ...h.spec },
            tokens: tokens.filter((t) => used.has(t.name)),
            themes,
            components: components.filter((x) => h.spec.components.includes(x.id)),
            problems: handoffProblems(h.spec, tokens, components),
          };
          return {
            body: {},
            file: {
              data: Buffer.from(JSON.stringify(json, null, 2), 'utf8'),
              contentType: 'application/json; charset=utf-8',
              name: name + '.json',
            },
          };
        }
        const md = handoffMarkdown({
          title: m.title,
          version: v,
          status: m.status,
          imageUrl,
          spec: h.spec,
          tokens,
          themes,
          components,
        });
        return {
          body: {},
          file: {
            data: Buffer.from(md, 'utf8'),
            contentType: 'text/markdown; charset=utf-8',
            name: name + '.md',
          },
        };
      }),
  });

  return [get, put, download];
}
