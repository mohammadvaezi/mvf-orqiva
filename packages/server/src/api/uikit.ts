// ── [PCODE-299 | S15 | v0.1.0] T31.1 GitLab and Azure Repos: webhooks, secrets, setup, read into one shape ──
// ── [PCODE-294 | S15 | v0.1.0] T30.8a Overlay compare of mockup versions, client pins in the portal ──
// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
// ── [PCODE-292 | S15 | v0.1.0] T30.6 Handoff specs per mockup: tokens, components, states, breakpoints, measures, export areas ──
// ── [PCODE-291 | S15 | v0.1.0] T30.5 Live component preview with the project's tokens and themes ──
// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
// ── [PCODE-288 | S15 | v0.1.0] T30.2 Design tokens exported as a pull request (GitHub, Gitea) ──
// ── [PCODE-287 | S15 | v0.1.0] T30.1 Design tokens: themes and modes, aliases, W3C import, iOS and Android export ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
// ── [PCODE-169 | S15 | v0.1.0] B3.2 Documents and UI kit on the server: page tree, versions, comments, backlinks, templates, knowledge, tokens, components, mockups, assets ──
//    Why:  the UI kit on real data. Design tokens with their light and dark values, written out as CSS
//          variables, Tailwind, TypeScript or W3C tokens, and checked for contrast; the component inventory
//          with its status and where it lives in the code; mockups reviewed version by version with pinned
//          comments and an approval bound to the exact image, telling the task's people when the design
//          changed after work started; assets with their rights, licence and expiry.
import {
  aliasOf,
  aliasProblems,
  PREVIEW_POLICY,
  previewDocument,
  contrastGrade,
  contrastRatio,
  tokenResolver,
  tokensToAndroid,
  tokensToCss,
  tokensToSwift,
  tokensToTailwind,
  tokensToTs,
  tokensToW3c,
  w3cToTokens,
  type DesignToken,
  type TokenTheme,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { zip } from '../export/zip.js'; // [PCODE-287 | S15 | v0.1.0]
import { open as openSecret } from '../agents/secrets.js'; // [PCODE-288 | S15 | v0.1.0]
import { apiBase, HostError, openPullRequest, type HostKind } from '../git/hostapi.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import {
  actorOf,
  asMember,
  isUniqueViolation,
  requireProject,
  type Access,
  type ProjectRow,
} from './access.js';
import { visibleFile } from './files.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const TOKEN_NAME = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){0,5}$/;
const TOKEN_TYPES = [
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'duration',
  'shadow',
  'number',
] as const;
// [PCODE-292 | S15 | v0.1.0] fileUrl, the token loaders and the mockup lookup are shared with the handoff routes
export const fileUrl = (ws: string, id: string): string =>
  '/api/workspaces/' + ws + '/files/' + id + '/content';

// ── tokens ──
interface TokenRow {
  id: string;
  name: string;
  type: string;
  value_light: string;
  value_dark: string;
  description: string;
  theme_values: Record<string, string>; // [PCODE-287 | S15 | v0.1.0]
  updated_at: Date;
}
const tokenOut = s.object({
  id: s.string(),
  name: s.string(),
  type: s.string(),
  valueLight: s.string(),
  valueDark: s.string(),
  themeValues: s.anyObject(), // [PCODE-287 | S15 | v0.1.0] { theme: value } where it differs from the base
  description: s.string(),
  updatedAt: s.string(),
});
const tokenJson = (t: TokenRow) => ({
  id: t.id,
  name: t.name,
  type: t.type,
  valueLight: t.value_light,
  valueDark: t.value_dark,
  themeValues: t.theme_values,
  description: t.description,
  updatedAt: t.updated_at.toISOString(),
});
export const asToken = (t: TokenRow): DesignToken => ({
  name: t.name,
  type: t.type,
  valueLight: t.value_light,
  valueDark: t.value_dark,
  description: t.description,
  themes: t.theme_values,
});
export const loadTokens = async (c: PoolClient, projectId: string): Promise<TokenRow[]> =>
  (
    await c.query<TokenRow>('SELECT * FROM design_tokens WHERE project_id = $1 ORDER BY name', [
      projectId,
    ])
  ).rows;

// [PCODE-287 | S15 | v0.1.0] themes
interface ThemeRow {
  id: string;
  name: string;
  base: 'light' | 'dark';
  description: string;
}
const themeOut = s.object({
  id: s.string(),
  name: s.string(),
  base: s.string(),
  description: s.string(),
});
export const loadThemes = async (c: PoolClient, projectId: string): Promise<ThemeRow[]> =>
  (
    await c.query<ThemeRow>(
      'SELECT id, name, base, description FROM token_themes WHERE project_id = $1 ORDER BY created_at, name',
      [projectId],
    )
  ).rows;
export const asTheme = (t: ThemeRow): TokenTheme => ({ name: t.name, base: t.base });

// [PCODE-288 | S15 | v0.1.0] the files of each export format, under a folder of the repository
export const TOKEN_FORMATS = ['css', 'tailwind', 'ts', 'w3c', 'ios', 'android'] as const;
export function tokenFiles(
  list: readonly DesignToken[],
  themes: readonly TokenTheme[],
  formats: readonly string[],
  folder: string,
): { path: string; text: string }[] {
  const dir = folder.replace(/^\/+|\/+$/g, '');
  const at = (p: string): string => (dir ? dir + '/' : '') + p;
  const out: { path: string; text: string }[] = [];
  for (const f of TOKEN_FORMATS) {
    if (!formats.includes(f)) continue;
    if (f === 'css') out.push({ path: at('tokens.css'), text: tokensToCss(list, themes) });
    if (f === 'tailwind')
      out.push({ path: at('tokens.tailwind.js'), text: tokensToTailwind(list) });
    if (f === 'ts') out.push({ path: at('tokens.ts'), text: tokensToTs(list, themes) });
    if (f === 'w3c') out.push({ path: at('tokens.json'), text: tokensToW3c(list, themes) });
    if (f === 'ios') out.push({ path: at('ios/Tokens.swift'), text: tokensToSwift(list, themes) });
    if (f === 'android')
      for (const x of tokensToAndroid(list, themes))
        out.push({ path: at('android/' + x.path), text: x.text });
  }
  return out;
}

const COLOUR =
  /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|var\(--[a-z0-9-]+\))$/i;
/** Why a value cannot be a token's value, or null: an alias, or a colour for colours, and nothing that
 *  breaks out of CSS. */
export function badValue(type: string, value: string): string | null {
  const v = value.trim();
  if (aliasOf(v)) return null;
  if (/[;{}<>]/.test(v))
    return 'Values cannot hold ; { } < > (except an alias like {color.blue.500})';
  if (type === 'color' && v && !COLOUR.test(v))
    return 'A colour is #hex, rgb(), hsl(), oklch(), a var() or an alias like {color.blue.500}';
  return null;
}

/** Text colours against the backgrounds they sit on, in light, dark and each theme (aliases followed). */
export function contrastPairs(
  tokens: readonly DesignToken[],
  themes: readonly TokenTheme[] = [], // [PCODE-287 | S15 | v0.1.0]
): {
  foreground: string;
  background: string;
  mode: string;
  ratio: number;
  grade: string;
}[] {
  // [PCODE-172 | S15 | v0.1.0] text sits on backgrounds; on-X colours sit on X (on-primary on primary)
  const colours = tokens.filter((t) => t.type === 'color');
  const last = (name: string): string => name.split('.').pop() ?? name;
  const onOf = (t: DesignToken): string | null => /^on-(.+)$/.exec(last(t.name))?.[1] ?? null;
  const fg = colours.filter(
    (t) => onOf(t) !== null || /(^|\.)(text|fg|foreground)(\.|$|-)/.test(t.name),
  );
  const backgrounds = colours.filter(
    (t) => /(^|\.)(bg|background|surface|canvas)(\.|$|-)/.test(t.name) && !fg.includes(t),
  );
  const pairsOf = (f: DesignToken): DesignToken[] => {
    const on = onOf(f);
    return on ? colours.filter((b) => last(b.name) === on && b !== f) : backgrounds;
  };
  const out = [];
  const read = tokenResolver(tokens, themes);
  for (const f of fg)
    for (const b of pairsOf(f))
      for (const mode of ['light', 'dark', ...themes.map((t) => t.name)]) {
        const fv = read(f.name, mode) ?? '';
        const bv = read(b.name, mode) ?? '';
        // a mode that changes neither colour says nothing new
        if (mode !== 'light') {
          const base =
            mode === 'dark' ? 'light' : (themes.find((t) => t.name === mode)?.base ?? 'light');
          if (fv === read(f.name, base) && bv === read(b.name, base)) continue;
        }
        const ratio = contrastRatio(fv, bv);
        if (ratio !== null)
          out.push({
            foreground: f.name,
            background: b.name,
            mode,
            ratio,
            grade: contrastGrade(ratio),
          });
      }
  return out.sort((x, y) => x.ratio - y.ratio);
}

// ── mockups ──
interface MockupRow {
  id: string;
  project_id: string;
  title: string;
  item_id: string | null;
  item_ref: string | null;
  item_group: string | null;
  status: string;
  version: number;
  file_id: string | null;
  open_pins: string;
  updated_at: Date;
  latest_at: Date | null;
  client_visible: boolean; // [PCODE-186 | S15 | v0.1.0]
}
const MOCKUP_SELECT = `SELECT m.id, m.project_id, m.title, m.item_id, p.key || '-' || i.sequence AS item_ref, st.grp AS item_group, m.status, m.version, m.client_visible,
       v.file_id, v.created_at AS latest_at,
       (SELECT count(*) FROM mockup_pins x WHERE x.mockup_id = m.id AND NOT x.resolved) AS open_pins, m.updated_at
  FROM mockups m LEFT JOIN mockup_versions v ON v.mockup_id = m.id AND v.version = m.version
  LEFT JOIN items i ON i.id = m.item_id LEFT JOIN projects p ON p.id = i.project_id LEFT JOIN project_states st ON st.id = i.state_id`;
const mockupOut = s.object({
  id: s.string(),
  title: s.string(),
  itemId: s.nullable(s.string()),
  itemRef: s.nullable(s.string()),
  status: s.string(),
  version: s.number({ integer: true }),
  imageUrl: s.nullable(s.string()),
  openPins: s.number({ integer: true }),
  /** a newer version arrived while its task was already in progress */
  changedAfterStart: s.boolean(),
  updatedAt: s.string(),
  clientVisible: s.boolean(), // [PCODE-186 | S15 | v0.1.0] shared with the client for approval
});
const mockupJson = (m: MockupRow, ws: string) => ({
  id: m.id,
  title: m.title,
  itemId: m.item_id,
  itemRef: m.item_ref,
  status: m.status,
  version: m.version,
  imageUrl: m.file_id ? fileUrl(ws, m.file_id) : null,
  clientVisible: m.client_visible, // [PCODE-186 | S15 | v0.1.0]
  openPins: Number(m.open_pins),
  changedAfterStart: m.version > 1 && (m.item_group === 'started' || m.item_group === 'completed'),
  updatedAt: m.updated_at.toISOString(),
});

export async function mockupOf(
  c: PoolClient,
  a: Access,
  id: string,
): Promise<MockupRow & { project: ProjectRow }> {
  const m = (await c.query<MockupRow>(MOCKUP_SELECT + ' WHERE m.id = $1', [id])).rows[0];
  if (!m) throw new HttpError(404, 'not_found', 'Mockup not found');
  try {
    return { ...m, project: await requireProject(c, a, m.project_id) };
  } catch {
    throw new HttpError(404, 'not_found', 'Mockup not found');
  }
}

/** An image of this project for a mockup or an asset. */
async function projectFile(
  c: PoolClient,
  a: Access,
  fileId: string,
  projectId: string,
  field: string,
): Promise<{ id: string; sha256: string; mime: string }> {
  const f = await visibleFile(c, a, fileId);
  if (f.project_id !== projectId)
    throw new HttpError(400, 'invalid_request', 'The file belongs to another project', [
      { path: 'body.' + field, message: 'is not a file of this project' },
    ]);
  return { id: f.id, sha256: f.sha256, mime: f.mime };
}

export function uikitRoutes(pool: Pool): Route[] {
  const tokens = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/tokens',
    summary: 'The project’s design tokens, with the contrast of its text and background colours',
    tags: ['uikit'],
    params: projectParams,
    response: s.object({
      tokens: s.array(tokenOut),
      themes: s.array(themeOut), // [PCODE-287 | S15 | v0.1.0]
      aliasProblems: s.array(
        s.object({ name: s.string(), mode: s.string(), target: s.string(), problem: s.string() }),
      ),
      contrast: s.array(
        s.object({
          foreground: s.string(),
          background: s.string(),
          mode: s.string(),
          ratio: s.number(),
          grade: s.string(),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = await loadTokens(c, params.projectId);
        const themes = await loadThemes(c, params.projectId);
        const list = rows.map(asToken);
        return {
          body: {
            tokens: rows.map(tokenJson),
            themes,
            aliasProblems: aliasProblems(list, themes.map(asTheme)),
            contrast: contrastPairs(list, themes.map(asTheme)),
          },
        };
      }),
  });
  const setToken = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/tokens/:name',
    summary: 'Set a design token (light and, if it differs, dark) (member)',
    tags: ['uikit'],
    params: s.object({ workspaceId: uuid, projectId: uuid, name: s.string({ min: 1, max: 100 }) }),
    body: s.object({
      type: s.enum(TOKEN_TYPES),
      valueLight: s.string({ min: 1, max: 300 }),
      valueDark: s.optional(s.string({ max: 300 })),
      themeValues: s.optional(s.anyObject()), // [PCODE-287 | S15 | v0.1.0]
      description: s.optional(s.string({ max: 1000 })),
    }),
    response: tokenOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        if (!TOKEN_NAME.test(params.name))
          throw new HttpError(
            400,
            'invalid_request',
            'Token names are lower case, dotted: color.primary',
            [{ path: 'params.name', message: 'is not a token name' }],
          );
        // [PCODE-287 | S15 | v0.1.0] an alias like {color.blue.500} is a value of any type
        const themeNames = new Set((await loadThemes(c, p.id)).map((t) => t.name));
        const themeValues: Record<string, string> = {};
        for (const [k, v] of Object.entries(body.themeValues ?? {})) {
          if (typeof v !== 'string' || v.length > 300 || !themeNames.has(k))
            throw new HttpError(
              400,
              'invalid_request',
              'Theme values name a theme of the project',
              [{ path: 'body.themeValues.' + k, message: 'is not a theme of this project' }],
            );
          if (v.trim()) themeValues[k] = v.trim();
        }
        for (const [k, v] of [
          ['valueLight', body.valueLight],
          ['valueDark', body.valueDark ?? ''],
          ...Object.entries(themeValues).map(([n, x]) => ['themeValues.' + n, x] as const),
        ] as const) {
          const bad = badValue(body.type, v);
          if (bad)
            throw new HttpError(400, 'invalid_request', bad, [
              {
                path: 'body.' + k,
                message:
                  body.type === 'color' ? 'is not a colour' : 'has characters that break CSS',
              },
            ]);
          if (aliasOf(v) === params.name)
            throw new HttpError(400, 'invalid_request', 'A token cannot point at itself', [
              { path: 'body.' + k, message: 'points at this token' },
            ]);
        }
        const row = (
          await c.query<TokenRow>(
            `INSERT INTO design_tokens (workspace_id, project_id, name, type, value_light, value_dark, description, updated_by, theme_values) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (project_id, name) DO UPDATE SET type = $4, value_light = $5, value_dark = $6, description = $7, updated_by = $8, theme_values = $9, updated_at = now() RETURNING *`,
            [
              a.workspaceId,
              p.id,
              params.name,
              body.type,
              body.valueLight.trim(),
              body.valueDark?.trim() ?? '',
              body.description?.trim() ?? '',
              a.user.id,
              JSON.stringify(themeValues),
            ],
          )
        ).rows[0];
        if (!row) throw new Error('token vanished');
        return { body: tokenJson(row) };
      }),
  });
  const removeToken = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/projects/:projectId/tokens/:name',
    summary: 'Remove a design token (member)',
    tags: ['uikit'],
    params: s.object({ workspaceId: uuid, projectId: uuid, name: s.string({ min: 1, max: 100 }) }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const r = await c.query('DELETE FROM design_tokens WHERE project_id = $1 AND name = $2', [
          params.projectId,
          params.name,
        ]);
        return { body: { removed: Boolean(r.rowCount) } };
      }),
  });
  const exportTokens = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/tokens/export',
    summary:
      'The tokens as a file: CSS variables, a Tailwind theme, TypeScript, W3C design tokens, Swift for iOS or Android resources (a ZIP)',
    tags: ['uikit'],
    params: projectParams,
    query: s.object({ format: s.enum(['css', 'tailwind', 'ts', 'w3c', 'ios', 'android']) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const list = (await loadTokens(c, p.id)).map(asToken);
        const themes = (await loadThemes(c, p.id)).map(asTheme); // [PCODE-287 | S15 | v0.1.0]
        if (query.format === 'android')
          return {
            body: {},
            file: {
              data: zip(
                tokensToAndroid(list, themes).map((f) => ({
                  name: f.path,
                  data: Buffer.from(f.text, 'utf8'),
                })),
              ),
              contentType: 'application/zip',
              name: p.key.toLowerCase() + '-tokens-android.zip',
            },
          };
        const out = {
          css: { text: tokensToCss(list, themes), type: 'text/css', ext: 'css' },
          tailwind: { text: tokensToTailwind(list), type: 'text/javascript', ext: 'tailwind.js' },
          ts: { text: tokensToTs(list, themes), type: 'text/plain', ext: 'ts' },
          w3c: { text: tokensToW3c(list, themes), type: 'application/json', ext: 'tokens.json' },
          ios: { text: tokensToSwift(list, themes), type: 'text/plain', ext: 'swift' },
        }[query.format];
        return {
          body: {},
          file: {
            data: Buffer.from(out.text, 'utf8'),
            contentType: out.type + '; charset=utf-8',
            name: p.key.toLowerCase() + '-tokens.' + out.ext,
          },
        };
      }),
  });

  // [PCODE-287 | S15 | v0.1.0] themes and the W3C import
  const themes = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/token-themes',
    summary: 'Add a token theme built on light or dark (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({
      name: s.string({ min: 1, max: 40 }),
      base: s.enum(['light', 'dark']),
      description: s.optional(s.string({ max: 1000 })),
    }),
    response: themeOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const name = body.name.trim().toLowerCase();
        if (!/^[a-z][a-z0-9-]{0,39}$/.test(name) || name === 'light' || name === 'dark')
          throw new HttpError(
            400,
            'invalid_request',
            'A theme name is lower case with dashes: high-contrast',
            [{ path: 'body.name', message: 'is not a theme name' }],
          );
        try {
          const row = (
            await c.query<ThemeRow>(
              'INSERT INTO token_themes (workspace_id, project_id, name, base, description) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, base, description',
              [a.workspaceId, p.id, name, body.base, body.description?.trim() ?? ''],
            )
          ).rows[0];
          if (!row) throw new Error('theme vanished');
          return { status: 201, body: row };
        } catch (e) {
          if (isUniqueViolation(e))
            throw new HttpError(409, 'conflict', 'The project has a theme of that name');
          throw e;
        }
      }),
  });
  const removeTheme = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/projects/:projectId/token-themes/:name',
    summary: 'Remove a token theme and its values (member)',
    tags: ['uikit'],
    params: s.object({ workspaceId: uuid, projectId: uuid, name: s.string({ min: 1, max: 40 }) }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const r = await c.query('DELETE FROM token_themes WHERE project_id = $1 AND name = $2', [
          p.id,
          params.name,
        ]);
        await c.query(
          'UPDATE design_tokens SET theme_values = theme_values - $2::text WHERE project_id = $1 AND theme_values ? $2',
          [p.id, params.name],
        );
        return { body: { removed: Boolean(r.rowCount) } };
      }),
  });
  const importTokens = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/tokens/import',
    summary:
      'Import W3C design tokens (and Tokens Studio or Figma exports); with dryRun, only what would change (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({ text: s.string({ min: 2, max: 2_000_000 }), dryRun: s.optional(s.boolean()) }),
    response: s.object({
      added: s.array(s.string()),
      changed: s.array(s.string()),
      unchanged: s.number({ integer: true }),
      themesAdded: s.array(s.string()),
      skipped: s.array(s.object({ name: s.string(), reason: s.string() })),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.text);
        } catch {
          throw new HttpError(400, 'invalid_request', 'The file is not JSON', [
            { path: 'body.text', message: 'is not JSON' },
          ]);
        }
        const r = w3cToTokens(parsed);
        const have = new Map((await loadTokens(c, p.id)).map((t) => [t.name, t]));
        const known = new Set((await loadThemes(c, p.id)).map((t) => t.name));
        const themesAdded = r.themes.filter((t) => !known.has(t.name));
        const added: string[] = [];
        const changed: string[] = [];
        let unchanged = 0;
        const same = (x: TokenRow, t: DesignToken): boolean =>
          x.type === t.type &&
          x.value_light === t.valueLight &&
          x.value_dark === t.valueDark &&
          x.description === t.description &&
          JSON.stringify(x.theme_values) === JSON.stringify(t.themes ?? {});
        const write: DesignToken[] = [];
        for (const t of r.tokens) {
          const x = have.get(t.name);
          if (!x) added.push(t.name);
          else if (same(x, t)) {
            unchanged++;
            continue;
          } else changed.push(t.name);
          write.push(t);
        }
        if (!body.dryRun) {
          for (const th of themesAdded)
            await c.query(
              'INSERT INTO token_themes (workspace_id, project_id, name, base) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
              [a.workspaceId, p.id, th.name, th.base],
            );
          for (const t of write)
            await c.query(
              `INSERT INTO design_tokens (workspace_id, project_id, name, type, value_light, value_dark, description, updated_by, theme_values) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (project_id, name) DO UPDATE SET type = $4, value_light = $5, value_dark = $6, description = $7, updated_by = $8, theme_values = $9, updated_at = now()`,
              [
                a.workspaceId,
                p.id,
                t.name,
                t.type,
                t.valueLight,
                t.valueDark,
                t.description,
                a.user.id,
                JSON.stringify(t.themes ?? {}),
              ],
            );
        }
        return {
          status: body.dryRun ? 200 : 201,
          body: {
            added,
            changed,
            unchanged,
            themesAdded: themesAdded.map((t) => t.name),
            skipped: r.skipped,
          },
        };
      }),
  });

  // [PCODE-288 | S15 | v0.1.0] export as a pull request
  const exportOut = s.object({
    id: s.string(),
    repo: s.string(),
    branch: s.string(),
    pullNumber: s.nullable(s.number({ integer: true })),
    pullUrl: s.string(),
    files: s.array(s.string()),
    by: s.nullable(s.string()),
    createdAt: s.string(),
  });
  interface ExportRow {
    id: string;
    repo: string;
    branch: string;
    pull_number: number | null;
    pull_url: string;
    files: string[];
    by: string | null;
    created_at: Date;
  }
  const exportJson = (r: ExportRow) => ({
    id: r.id,
    repo: r.repo,
    branch: r.branch,
    pullNumber: r.pull_number,
    pullUrl: r.pull_url,
    files: r.files,
    by: r.by,
    createdAt: r.created_at.toISOString(),
  });
  const tokenExports = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/tokens/pull-requests',
    summary: 'The pull requests token exports opened, newest first',
    tags: ['uikit'],
    params: projectParams,
    response: s.array(exportOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<ExportRow>(
            'SELECT e.id, e.repo, e.branch, e.pull_number, e.pull_url, e.files, u.name AS by, e.created_at FROM token_exports e LEFT JOIN users u ON u.id = e.created_by WHERE e.project_id = $1 ORDER BY e.created_at DESC LIMIT 20',
            [p.id],
          )
        ).rows;
        return { body: rows.map(exportJson) };
      }),
  });
  const pullRequest = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/tokens/pull-request',
    summary:
      'Open a pull request with the token files in the chosen formats; only files that changed are written (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({
      connectionId: uuid,
      formats: s.array(s.enum(TOKEN_FORMATS), { min: 1, max: TOKEN_FORMATS.length }),
      folder: s.optional(s.string({ max: 200, pattern: /^[A-Za-z0-9_.\/-]*$/ })),
    }),
    response: s.object({ unchanged: s.boolean(), export: s.nullable(exportOut) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const folder = body.folder?.trim() ?? 'design-tokens';
        if (folder.split('/').some((x) => x === '..' || x === '.'))
          throw new HttpError(
            400,
            'invalid_request',
            'The folder is a path inside the repository',
            [{ path: 'body.folder', message: 'cannot hold . or ..' }],
          );
        const conn = (
          await c.query<{
            id: string;
            provider: HostKind;
            repo: string;
            api_url: string | null;
            api_token: string | null;
          }>(
            'SELECT id, provider, repo, api_url, api_token FROM git_connections WHERE id = $1 AND project_id = $2',
            [body.connectionId, p.id],
          )
        ).rows[0];
        if (!conn) throw new HttpError(404, 'not_found', 'The project has no such repository');
        // [PCODE-299 | S15 | v0.1.0] Orqiva opens pull requests on GitHub and Gitea; GitLab and Azure only report so far
        if ((conn.provider as string) !== 'github' && (conn.provider as string) !== 'gitea')
          throw new HttpError(
            409,
            'conflict',
            'Orqiva opens pull requests on GitHub and Gitea so far; this repository is on another host',
          );
        const base = apiBase(conn.provider, conn.api_url);
        if (!conn.api_token || !base)
          throw new HttpError(
            409,
            'conflict',
            'An admin has to give ' + conn.repo + ' an API token first (Settings → Git)',
          );
        const list = (await loadTokens(c, p.id)).map(asToken);
        if (!list.length) throw new HttpError(409, 'conflict', 'The project has no tokens yet');
        const themes = (await loadThemes(c, p.id)).map(asTheme);
        const files = tokenFiles(list, themes, body.formats, folder);
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
        let result;
        try {
          result = await openPullRequest(
            {
              provider: conn.provider,
              repo: conn.repo,
              apiUrl: base,
              token: openSecret(conn.api_token),
            },
            files,
            {
              branch: 'orqiva/tokens-' + stamp,
              title: 'Design tokens from Orqiva (' + p.key + ')',
              message: 'Update design tokens from Orqiva',
              body:
                'Design tokens of ' +
                p.key +
                ' ' +
                p.name +
                ', exported from Orqiva by ' +
                a.user.name +
                '.\n\n' +
                String(list.length) +
                ' tokens' +
                (themes.length ? ', themes: ' + themes.map((t) => t.name).join(', ') : '') +
                '.\n\nChanged files:\n',
            },
          );
        } catch (e) {
          if (e instanceof HostError) throw new HttpError(502, 'bad_gateway', e.message);
          throw e;
        }
        if (!result) return { body: { unchanged: true, export: null } };
        const row = (
          await c.query<ExportRow>(
            `INSERT INTO token_exports (workspace_id, project_id, connection_id, repo, branch, pull_number, pull_url, files, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, repo, branch, pull_number, pull_url, files, $10::text AS by, created_at`,
            [
              a.workspaceId,
              p.id,
              conn.id,
              conn.repo,
              result.branch,
              result.number,
              result.url,
              result.changed,
              a.user.id,
              a.user.name,
            ],
          )
        ).rows[0];
        if (!row) throw new Error('export vanished');
        return { status: 201, body: { unchanged: false, export: exportJson(row) } };
      }),
  });

  // ── components ──
  interface CompRow {
    id: string;
    project_id: string;
    name: string;
    status: string;
    description: string;
    code_path: string;
    design_url: string;
    props: unknown[];
    usage_count: number;
    usage_files: { path: string; count: number }[]; // [PCODE-290 | S15 | v0.1.0]
    usage_scanned_at: Date | null;
    preview_html: string; // [PCODE-291 | S15 | v0.1.0]
    preview_css: string;
    updated_at: Date;
  }
  const compOut = s.object({
    id: s.string(),
    name: s.string(),
    status: s.string(),
    description: s.string(),
    codePath: s.string(),
    designUrl: s.string(),
    props: s.array(s.anyObject()),
    usageCount: s.number({ integer: true }),
    usageFiles: s.array(s.object({ path: s.string(), count: s.number({ integer: true }) })), // [PCODE-290 | S15 | v0.1.0]
    usageScannedAt: s.nullable(s.string()),
    previewHtml: s.string(), // [PCODE-291 | S15 | v0.1.0]
    previewCss: s.string(),
    updatedAt: s.string(),
  });
  const compJson = (r: CompRow) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    description: r.description,
    codePath: r.code_path,
    designUrl: r.design_url,
    props: r.props as Record<string, unknown>[],
    usageCount: r.usage_count,
    usageFiles: r.usage_files,
    usageScannedAt: r.usage_scanned_at?.toISOString() ?? null,
    previewHtml: r.preview_html,
    previewCss: r.preview_css,
    updatedAt: r.updated_at.toISOString(),
  });
  const compFields = {
    name: s.string({ min: 1, max: 120 }),
    status: s.enum(['design', 'in_code', 'deprecated']),
    description: s.string({ max: 4000 }),
    codePath: s.string({ max: 500 }),
    designUrl: s.string({ max: 2000 }),
    props: s.array(
      s.object({
        name: s.string({ min: 1, max: 60 }),
        type: s.string({ max: 300 }),
        default: s.optional(s.string({ max: 300 })),
        description: s.optional(s.string({ max: 500 })),
      }),
      { max: 60 },
    ),
    usageCount: s.number({ integer: true, min: 0, max: 1_000_000 }),
  };
  const checkUrl = (u: string | undefined): void => {
    if (u && !/^https:\/\/\S+$/i.test(u))
      throw new HttpError(400, 'invalid_request', 'Links are https addresses', [
        { path: 'body.designUrl', message: 'is not an https address' },
      ]);
  };
  const components = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/components',
    summary: 'The component inventory: status, where it is in the code, props, usage',
    tags: ['uikit'],
    params: projectParams,
    response: s.array(compOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return {
          body: (
            await c.query<CompRow>(
              'SELECT * FROM ui_components WHERE project_id = $1 ORDER BY name',
              [params.projectId],
            )
          ).rows.map(compJson),
        };
      }),
  });
  const addComponent = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/components',
    summary: 'Add a component to the inventory (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({
      name: compFields.name,
      status: s.optional(compFields.status),
      description: s.optional(compFields.description),
      codePath: s.optional(compFields.codePath),
      designUrl: s.optional(compFields.designUrl),
      props: s.optional(compFields.props),
      usageCount: s.optional(compFields.usageCount),
    }),
    response: compOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        checkUrl(body.designUrl);
        try {
          const row = (
            await c.query<CompRow>(
              `INSERT INTO ui_components (workspace_id, project_id, name, status, description, code_path, design_url, props, usage_count, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
              [
                a.workspaceId,
                p.id,
                body.name.trim(),
                body.status ?? 'design',
                body.description ?? '',
                body.codePath?.trim() ?? '',
                body.designUrl?.trim() ?? '',
                JSON.stringify(body.props ?? []),
                body.usageCount ?? 0,
                a.user.id,
              ],
            )
          ).rows[0];
          if (!row) throw new Error('component vanished');
          return { status: 201, body: compJson(row) };
        } catch (e) {
          if (isUniqueViolation(e))
            throw new HttpError(409, 'conflict', 'The inventory already has ' + body.name.trim());
          throw e;
        }
      }),
  });
  const compParams = s.object({ workspaceId: uuid, id: uuid });
  const compOf = async (c: PoolClient, a: Access, id: string): Promise<CompRow> => {
    const r = (await c.query<CompRow>('SELECT * FROM ui_components WHERE id = $1', [id])).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'Component not found');
    await requireProject(c, a, r.project_id);
    return r;
  };
  const changeComponent = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/components/:id',
    summary: 'Change a component (member)',
    tags: ['uikit'],
    params: compParams,
    body: s.object({
      name: s.optional(compFields.name),
      status: s.optional(compFields.status),
      description: s.optional(compFields.description),
      codePath: s.optional(compFields.codePath),
      designUrl: s.optional(compFields.designUrl),
      props: s.optional(compFields.props),
      usageCount: s.optional(compFields.usageCount),
    }),
    response: compOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await compOf(c, a, params.id);
        checkUrl(body.designUrl);
        try {
          const row = (
            await c.query<CompRow>(
              `UPDATE ui_components SET name = coalesce($2, name), status = coalesce($3, status), description = coalesce($4, description),
                      code_path = coalesce($5, code_path), design_url = coalesce($6, design_url), props = coalesce($7::jsonb, props),
                      usage_count = coalesce($8, usage_count), updated_by = $9, updated_at = now() WHERE id = $1 RETURNING *`,
              [
                r.id,
                body.name?.trim() ?? null,
                body.status ?? null,
                body.description ?? null,
                body.codePath?.trim() ?? null,
                body.designUrl?.trim() ?? null,
                body.props ? JSON.stringify(body.props) : null,
                body.usageCount ?? null,
                a.user.id,
              ],
            )
          ).rows[0];
          if (!row) throw new Error('component vanished');
          return { body: compJson(row) };
        } catch (e) {
          if (isUniqueViolation(e))
            throw new HttpError(409, 'conflict', 'The inventory already has this name');
          throw e;
        }
      }),
  });
  // [PCODE-291 | S15 | v0.1.0] the component's example, and the page that shows it with the tokens
  const setPreview = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/components/:id/preview',
    summary: 'Set a component’s example markup and CSS for its live preview (member)',
    tags: ['uikit'],
    params: compParams,
    body: s.object({ html: s.string({ max: 20000 }), css: s.string({ max: 20000 }) }),
    response: compOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await compOf(c, a, params.id);
        const row = (
          await c.query<CompRow>(
            'UPDATE ui_components SET preview_html = $2, preview_css = $3, updated_by = $4, updated_at = now() WHERE id = $1 RETURNING *',
            [r.id, body.html, body.css, a.user.id],
          )
        ).rows[0];
        if (!row) throw new Error('component vanished');
        return { body: compJson(row) };
      }),
  });
  const preview = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/components/:id/preview',
    summary:
      'The component’s live preview: a page with the project’s tokens in the chosen theme, where nothing can run',
    tags: ['uikit'],
    params: compParams,
    query: s.object({ theme: s.optional(s.string({ max: 40 })) }),
    response: s.object({}),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const r = await compOf(c, a, params.id);
        const tokens = (await loadTokens(c, r.project_id)).map(asToken);
        const themes = (await loadThemes(c, r.project_id)).map(asTheme);
        const theme = query.theme ?? 'light';
        const html = previewDocument({
          title: r.name,
          tokensCss: tokensToCss(tokens, themes),
          css: r.preview_css,
          html:
            r.preview_html ||
            '<p style="color:GrayText">No example yet: add markup that uses the component’s classes.</p>',
          theme:
            theme === 'light' || theme === 'dark' || themes.some((t) => t.name === theme)
              ? theme
              : 'light',
        });
        return {
          body: {},
          headers: {
            'content-security-policy': PREVIEW_POLICY,
            'x-frame-options': 'SAMEORIGIN',
            'referrer-policy': 'no-referrer',
          },
          file: {
            data: Buffer.from(html, 'utf8'),
            contentType: 'text/html; charset=utf-8',
            name: 'preview.html',
            inline: true,
          },
        };
      }),
  });
  const removeComponent = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/components/:id',
    summary: 'Remove a component from the inventory (member)',
    tags: ['uikit'],
    params: compParams,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await compOf(c, a, params.id);
        await c.query('DELETE FROM ui_components WHERE id = $1', [r.id]);
        return { body: { removed: true } };
      }),
  });

  // ── mockups ──
  const mockups = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/mockups',
    summary: 'The project’s mockups, latest first, with their review state',
    tags: ['uikit'],
    params: projectParams,
    response: s.array(mockupOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return {
          body: (
            await c.query<MockupRow>(
              MOCKUP_SELECT + ' WHERE m.project_id = $1 ORDER BY m.updated_at DESC',
              [params.projectId],
            )
          ).rows.map((m) => mockupJson(m, a.workspaceId)),
        };
      }),
  });
  const addMockup = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/mockups',
    summary:
      'Put a mockup up for review: an uploaded image of the project, optionally for a task (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({
      title: s.string({ min: 1, max: 200 }),
      fileId: uuid,
      itemId: s.optional(s.nullable(uuid)),
      note: s.optional(s.string({ max: 2000 })),
    }),
    response: mockupOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const f = await projectFile(c, a, body.fileId, p.id, 'fileId');
        if (!f.mime.startsWith('image/'))
          throw new HttpError(400, 'invalid_request', 'A mockup is an image', [
            { path: 'body.fileId', message: 'is not an image' },
          ]);
        if (body.itemId) {
          const it = (
            await c.query<{ project_id: string }>('SELECT project_id FROM items WHERE id = $1', [
              body.itemId,
            ])
          ).rows[0];
          if (it?.project_id !== p.id)
            throw new HttpError(400, 'invalid_request', 'The task belongs to another project', [
              { path: 'body.itemId', message: 'is not a task of this project' },
            ]);
        }
        const id = (
          await c.query<{ id: string }>(
            "INSERT INTO mockups (workspace_id, project_id, title, item_id, status, version, created_by) VALUES ($1, $2, $3, $4, 'in_review', 1, $5) RETURNING id",
            [a.workspaceId, p.id, body.title.trim(), body.itemId ?? null, a.user.id],
          )
        ).rows[0]?.id;
        await c.query(
          'INSERT INTO mockup_versions (workspace_id, mockup_id, version, file_id, note, created_by) VALUES ($1, $2, 1, $3, $4, $5)',
          [a.workspaceId, id, f.id, body.note?.trim() ?? '', a.user.id],
        );
        const m = await mockupOf(c, a, id ?? '');
        return { status: 201, body: mockupJson(m, a.workspaceId) };
      }),
  });
  const mockupParams = s.object({ workspaceId: uuid, mockupId: uuid });
  const pinOut = s.object({
    id: s.string(),
    version: s.number({ integer: true }),
    x: s.number(),
    y: s.number(),
    body: s.string(),
    authorName: s.nullable(s.string()),
    resolved: s.boolean(),
    createdAt: s.string(),
    fromClient: s.boolean(), // [PCODE-294 | S15 | v0.1.0] pinned by a client contact in the portal
  });
  interface PinRow {
    id: string;
    mockup_id: string;
    version: number;
    x: number;
    y: number;
    body: string;
    author_name: string | null;
    resolved: boolean;
    created_at: Date;
    from_client: boolean; // [PCODE-294 | S15 | v0.1.0]
  }
  const PIN_SELECT =
    'SELECT x.id, x.mockup_id, x.version, x.x, x.y, x.body, u.name AS author_name, x.resolved, x.created_at, x.from_client FROM mockup_pins x LEFT JOIN users u ON u.id = x.author_id';
  const pinJson = (r: PinRow) => ({
    id: r.id,
    version: r.version,
    x: r.x,
    y: r.y,
    body: r.body,
    authorName: r.author_name,
    resolved: r.resolved,
    createdAt: r.created_at.toISOString(),
    fromClient: r.from_client, // [PCODE-294 | S15 | v0.1.0]
  });
  const mockup = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/mockups/:mockupId',
    summary: 'A mockup with all its versions, their pins and the approvals',
    tags: ['uikit'],
    params: mockupParams,
    response: s.object({
      mockup: mockupOut,
      versions: s.array(
        s.object({
          version: s.number({ integer: true }),
          imageUrl: s.string(),
          note: s.string(),
          author: s.nullable(s.string()),
          createdAt: s.string(),
        }),
      ),
      pins: s.array(pinOut),
      decisions: s.array(
        s.object({
          decision: s.string(),
          approver: s.nullable(s.string()),
          note: s.string(),
          version: s.nullable(s.number({ integer: true })),
          at: s.string(),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const m = await mockupOf(c, a, params.mockupId);
        const versions = (
          await c.query<{
            version: number;
            file_id: string;
            note: string;
            author: string | null;
            created_at: Date;
            sha256: string;
          }>(
            'SELECT v.version, v.file_id, v.note, u.name AS author, v.created_at, f.sha256 FROM mockup_versions v JOIN files f ON f.id = v.file_id LEFT JOIN users u ON u.id = v.created_by WHERE v.mockup_id = $1 ORDER BY v.version DESC',
            [m.id],
          )
        ).rows;
        const pins = (
          await c.query<PinRow>(
            PIN_SELECT + ' WHERE x.mockup_id = $1 ORDER BY x.version DESC, x.created_at',
            [m.id],
          )
        ).rows;
        const decisions = (
          await c.query<{
            decision: string;
            approver: string | null;
            note: string;
            version_hash: string;
            created_at: Date;
          }>(
            "SELECT x.decision, u.name AS approver, x.note, x.version_hash, x.created_at FROM approvals x LEFT JOIN users u ON u.id = x.approver_id WHERE x.object_type = 'design' AND x.object_id = $1 ORDER BY x.created_at DESC",
            [m.id],
          )
        ).rows;
        return {
          body: {
            mockup: mockupJson(m, a.workspaceId),
            versions: versions.map((v) => ({
              version: v.version,
              imageUrl: fileUrl(a.workspaceId, v.file_id),
              note: v.note,
              author: v.author,
              createdAt: v.created_at.toISOString(),
            })),
            pins: pins.map(pinJson),
            decisions: decisions.map((d) => ({
              decision: d.decision,
              approver: d.approver,
              note: d.note,
              version: versions.find((v) => v.sha256 === d.version_hash)?.version ?? null,
              at: d.created_at.toISOString(),
            })),
          },
        };
      }),
  });
  const addVersion = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/mockups/:mockupId/versions',
    summary:
      'A new version of the mockup; review starts again, and a task already in progress is told (member)',
    tags: ['uikit'],
    params: mockupParams,
    body: s.object({ fileId: uuid, note: s.optional(s.string({ max: 2000 })) }),
    response: mockupOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const m = await mockupOf(c, a, params.mockupId);
        const f = await projectFile(c, a, body.fileId, m.project_id, 'fileId');
        if (!f.mime.startsWith('image/'))
          throw new HttpError(400, 'invalid_request', 'A mockup is an image', [
            { path: 'body.fileId', message: 'is not an image' },
          ]);
        await c.query('SELECT 1 FROM mockups WHERE id = $1 FOR UPDATE', [m.id]);
        const v = m.version + 1;
        await c.query(
          'INSERT INTO mockup_versions (workspace_id, mockup_id, version, file_id, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
          [a.workspaceId, m.id, v, f.id, body.note?.trim() ?? '', a.user.id],
        );
        await c.query(
          "UPDATE mockups SET version = $2, status = 'in_review', updated_at = now() WHERE id = $1",
          [m.id, v],
        );
        const after = await mockupOf(c, a, m.id);
        // the people on a task in progress learn that its design changed
        if (after.item_id && (after.item_group === 'started' || after.item_group === 'completed'))
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'updated',
              object: { type: 'item', id: after.item_id, label: after.item_ref ?? '' },
              parent: { type: 'project', id: m.project.id, label: m.project.key },
              changes: {
                design: {
                  from: 'version ' + String(m.version),
                  to: 'version ' + String(v) + ' of ' + m.title,
                },
              },
            },
            { projectId: m.project.id },
          );
        return { status: 201, body: mockupJson(after, a.workspaceId) };
      }),
  });
  const addPin = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/mockups/:mockupId/pins',
    summary: 'Pin a comment to a spot of the current version (member)',
    tags: ['uikit'],
    params: mockupParams,
    body: s.object({
      x: s.number({ min: 0, max: 1 }),
      y: s.number({ min: 0, max: 1 }),
      body: s.string({ min: 1, max: 4000 }),
    }),
    response: pinOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const m = await mockupOf(c, a, params.mockupId);
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO mockup_pins (workspace_id, mockup_id, version, x, y, body, author_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [a.workspaceId, m.id, m.version, body.x, body.y, body.body.trim(), a.user.id],
          )
        ).rows[0]?.id;
        await c.query('UPDATE mockups SET updated_at = now() WHERE id = $1', [m.id]);
        const row = (await c.query<PinRow>(PIN_SELECT + ' WHERE x.id = $1', [id])).rows[0];
        if (!row) throw new Error('pin vanished');
        return { status: 201, body: pinJson(row) };
      }),
  });
  const changePin = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/mockup-pins/:id',
    summary: 'Resolve or reopen a pinned comment (member)',
    tags: ['uikit'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    body: s.object({ resolved: s.boolean() }),
    response: pinOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = (await c.query<PinRow>(PIN_SELECT + ' WHERE x.id = $1', [params.id])).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Pin not found');
        await mockupOf(c, a, r.mockup_id);
        await c.query('UPDATE mockup_pins SET resolved = $2 WHERE id = $1', [r.id, body.resolved]);
        return { body: pinJson({ ...r, resolved: body.resolved }) };
      }),
  });
  const decide = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/mockups/:mockupId/decision',
    summary:
      'Approve the current version, or ask for changes; the approval names the exact image (member)',
    tags: ['uikit'],
    params: mockupParams,
    body: s.object({ approve: s.boolean(), note: s.optional(s.string({ max: 4000 })) }),
    response: mockupOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const m = await mockupOf(c, a, params.mockupId);
        const sha = (
          await c.query<{ sha256: string }>(
            'SELECT f.sha256 FROM mockup_versions v JOIN files f ON f.id = v.file_id WHERE v.mockup_id = $1 AND v.version = $2',
            [m.id, m.version],
          )
        ).rows[0]?.sha256;
        if (!sha) throw new HttpError(409, 'conflict', 'The mockup has no image');
        if (!body.approve && !body.note?.trim())
          throw new HttpError(400, 'invalid_request', 'Say what should change', [
            { path: 'body.note', message: 'is required when asking for changes' },
          ]);
        await c.query(
          "INSERT INTO approvals (workspace_id, project_id, object_type, object_id, version_hash, approver_id, decision, note) VALUES ($1, $2, 'design', $3, $4, $5, $6, $7)",
          [
            a.workspaceId,
            m.project_id,
            m.id,
            sha,
            a.user.id,
            body.approve ? 'approved' : 'declined',
            body.note?.trim() ?? '',
          ],
        );
        await c.query('UPDATE mockups SET status = $2, updated_at = now() WHERE id = $1', [
          m.id,
          body.approve ? 'approved' : 'changes_requested',
        ]);
        return { body: mockupJson(await mockupOf(c, a, m.id), a.workspaceId) };
      }),
  });

  // ── assets ──
  interface AssetRow {
    id: string;
    project_id: string;
    file_id: string;
    name: string;
    kind: string;
    rights: string;
    licence: string;
    expires_on: string | null;
    tags: string[];
    mime: string;
    size_bytes: string;
    expiring: boolean;
    expired: boolean;
    client_visible: boolean; // [PCODE-293 | S15 | v0.1.0]
    sizes: string;
  }
  const ASSET_SELECT = `SELECT x.id, x.project_id, x.file_id, x.name, x.kind, x.rights, x.licence, x.expires_on::text AS expires_on, x.tags,
         f.mime, f.size_bytes, x.client_visible,
         (SELECT count(*) FROM asset_renditions r WHERE r.asset_id = x.id) AS sizes,
         coalesce(x.expires_on < (now() AT TIME ZONE 'Europe/Berlin')::date, false) AS expired,
         coalesce(x.expires_on < (now() AT TIME ZONE 'Europe/Berlin')::date + 30, false) AS expiring
    FROM assets x JOIN files f ON f.id = x.file_id`;
  const assetOut = s.object({
    id: s.string(),
    name: s.string(),
    kind: s.string(),
    rights: s.string(),
    licence: s.string(),
    expiresOn: s.nullable(s.string()),
    expired: s.boolean(),
    expiringSoon: s.boolean(),
    tags: s.array(s.string()),
    mime: s.string(),
    sizeBytes: s.number({ integer: true }),
    url: s.string(),
    clientVisible: s.boolean(), // [PCODE-293 | S15 | v0.1.0] offered in the client portal
    sizes: s.number({ integer: true }),
  });
  const assetJson = (r: AssetRow, ws: string) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    rights: r.rights,
    licence: r.licence,
    expiresOn: r.expires_on,
    expired: r.expired,
    expiringSoon: r.expiring && !r.expired,
    tags: r.tags,
    mime: r.mime,
    sizeBytes: Number(r.size_bytes),
    url: fileUrl(ws, r.file_id),
    clientVisible: r.client_visible, // [PCODE-293 | S15 | v0.1.0]
    sizes: Number(r.sizes),
  });
  const assetFields = {
    name: s.string({ min: 1, max: 200 }),
    kind: s.enum(['logo', 'icon', 'image', 'font', 'video', 'other']),
    rights: s.string({ max: 1000 }),
    licence: s.string({ max: 200 }),
    expiresOn: s.nullable(s.string({ min: 10, max: 10 })),
    tags: s.array(s.string({ min: 1, max: 60 }), { max: 20 }),
  };
  const checkDate = (d: string | null | undefined): void => {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d))
      throw new HttpError(400, 'invalid_request', 'Dates are written YYYY-MM-DD', [
        { path: 'body.expiresOn', message: 'is not a date' },
      ]);
  };
  const assets = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/assets',
    summary: 'The project’s assets with rights, licence and expiry',
    tags: ['uikit'],
    params: projectParams,
    response: s.array(assetOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return {
          body: (
            await c.query<AssetRow>(
              ASSET_SELECT + ' WHERE x.project_id = $1 ORDER BY x.kind, x.name',
              [params.projectId],
            )
          ).rows.map((r) => assetJson(r, a.workspaceId)),
        };
      }),
  });
  const addAsset = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/assets',
    summary: 'Register an uploaded file as an asset with its rights (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({
      fileId: uuid,
      name: s.optional(assetFields.name),
      kind: s.optional(assetFields.kind),
      rights: s.optional(assetFields.rights),
      licence: s.optional(assetFields.licence),
      expiresOn: s.optional(assetFields.expiresOn),
      tags: s.optional(assetFields.tags),
    }),
    response: assetOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const f = await visibleFile(c, a, body.fileId);
        if (f.project_id !== p.id)
          throw new HttpError(400, 'invalid_request', 'The file belongs to another project', [
            { path: 'body.fileId', message: 'is not a file of this project' },
          ]);
        checkDate(body.expiresOn);
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO assets (workspace_id, project_id, file_id, name, kind, rights, licence, expires_on, tags, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
            [
              a.workspaceId,
              p.id,
              f.id,
              body.name?.trim() ?? f.name,
              body.kind ??
                (f.mime.startsWith('font/')
                  ? 'font'
                  : f.mime.startsWith('video/')
                    ? 'video'
                    : 'image'),
              body.rights ?? '',
              body.licence ?? '',
              body.expiresOn ?? null,
              body.tags ?? [],
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        const row = (await c.query<AssetRow>(ASSET_SELECT + ' WHERE x.id = $1', [id])).rows[0];
        if (!row) throw new Error('asset vanished');
        return { status: 201, body: assetJson(row, a.workspaceId) };
      }),
  });
  const assetOf = async (c: PoolClient, a: Access, id: string): Promise<AssetRow> => {
    const r = (await c.query<AssetRow>(ASSET_SELECT + ' WHERE x.id = $1', [id])).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'Asset not found');
    await requireProject(c, a, r.project_id);
    return r;
  };
  const changeAsset = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/assets/:id',
    summary: 'Change an asset’s name, kind, rights, licence, expiry or tags (member)',
    tags: ['uikit'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    body: s.object({
      name: s.optional(assetFields.name),
      kind: s.optional(assetFields.kind),
      rights: s.optional(assetFields.rights),
      licence: s.optional(assetFields.licence),
      expiresOn: s.optional(assetFields.expiresOn),
      tags: s.optional(assetFields.tags),
    }),
    response: assetOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await assetOf(c, a, params.id);
        checkDate(body.expiresOn);
        await c.query(
          `UPDATE assets SET name = coalesce($2, name), kind = coalesce($3, kind), rights = coalesce($4, rights), licence = coalesce($5, licence),
                  expires_on = CASE WHEN $6 THEN $7::date ELSE expires_on END, tags = coalesce($8, tags) WHERE id = $1`,
          [
            r.id,
            body.name?.trim() ?? null,
            body.kind ?? null,
            body.rights ?? null,
            body.licence ?? null,
            body.expiresOn !== undefined,
            body.expiresOn ?? null,
            body.tags ?? null,
          ],
        );
        return { body: assetJson(await assetOf(c, a, r.id), a.workspaceId) };
      }),
  });
  const removeAsset = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/assets/:id',
    summary: 'Remove an asset (the file stays) (member)',
    tags: ['uikit'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await assetOf(c, a, params.id);
        await c.query('DELETE FROM assets WHERE id = $1', [r.id]);
        return { body: { removed: true } };
      }),
  });

  return [
    tokens,
    setToken,
    exportTokens,
    themes, // [PCODE-287 | S15 | v0.1.0]
    removeTheme,
    importTokens,
    tokenExports, // [PCODE-288 | S15 | v0.1.0]
    pullRequest,
    removeToken,
    components,
    addComponent,
    changeComponent,
    removeComponent,
    setPreview, // [PCODE-291 | S15 | v0.1.0]
    preview,
    mockups,
    addMockup,
    mockup,
    addVersion,
    addPin,
    changePin,
    decide,
    assets,
    addAsset,
    changeAsset,
    removeAsset,
  ];
}
