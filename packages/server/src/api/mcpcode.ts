// ── [PCODE-310 | S15 | v0.1.0] T31.9a MCP tools for the code map and pull requests ──
//    Why:  an outside agent asks about the code and the reviews the way a person reads the code map and the
//          review queue: which folders are big, busy or written by one person, what a file depends on and
//          what depends on it, which pull requests wait and what they change. It may also leave a draft
//          comment on a changed line; the draft is its person's, posted only when they submit a review,
//          so nothing reaches the host without a person. Members and up, as the review screens.
import { numberedPatch, onDiff, parsePatch } from '@orqiva/shared';
import type { PoolClient } from 'pg';
import { atLeast, requireProject, type Access } from './access.js';
import { folderOf } from './codemap.js';
import { PULL_SELECT, current, type FileRow, type PullRow } from './prreview.js';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const project = { type: 'string', description: 'The project key, e.g. APP' };
const number = { type: 'integer', minimum: 1, description: 'The pull request number on the host' };
const repo = {
  type: 'string',
  description: 'The repository (owner/name), when two connected repositories share the number',
};

export const CODE_TOOLS: readonly McpTool[] = [
  {
    name: 'code_map',
    description:
      'The scanned code of a project by folder: files, lines, complexity, commits in the last 90 days ' +
      '(churn), the people who wrote most of it and the share AI agents wrote. Give a folder to look inside it.',
    inputSchema: {
      type: 'object',
      properties: {
        project,
        folder: { type: 'string', description: 'A folder to look inside, e.g. src/api' },
        depth: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: 'How many folder levels deep to group (default: one below the folder)',
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'code_dependencies',
    description:
      'What a file or folder imports from the same repository and which files import it, from the last ' +
      'code scan. Use it before changing a file to see what may break.',
    inputSchema: {
      type: 'object',
      properties: {
        project,
        path: { type: 'string', description: 'A file or folder path, e.g. src/api/orders.ts' },
      },
      required: ['project', 'path'],
    },
  },
  {
    name: 'list_pull_requests',
    description:
      'A project’s pull requests, newest change first: number, title, author, branches, size, review ' +
      'and checks state, conflicts and the linked task.',
    inputSchema: {
      type: 'object',
      properties: {
        project,
        state: { type: 'string', enum: ['open', 'merged', 'closed', 'all'], default: 'open' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      },
      required: ['project'],
    },
  },
  {
    name: 'get_pull_request',
    description:
      'One pull request: its changed files with their counts, the line comments you may see and the ' +
      'reviews. Give a path to get that file’s patch, with the changed file’s line numbers to comment on.',
    inputSchema: {
      type: 'object',
      properties: {
        project,
        number,
        repo,
        path: { type: 'string', description: 'A changed file whose patch to return' },
      },
      required: ['project', 'number'],
    },
  },
  {
    name: 'comment_on_pull_request',
    description:
      'Write a draft comment on a changed line of a pull request, as yourself. It is not posted: you ' +
      'post it to the host with your next review in Orqiva.',
    inputSchema: {
      type: 'object',
      properties: {
        project,
        number,
        repo,
        path: { type: 'string', description: 'The changed file' },
        line: { type: 'integer', minimum: 1, description: 'A line the patch shows' },
        side: {
          type: 'string',
          enum: ['new', 'old'],
          default: 'new',
          description: 'new: a line of the changed file; old: a removed line',
        },
        body: { type: 'string', description: 'The comment' },
      },
      required: ['project', 'number', 'path', 'line', 'body'],
    },
  },
];

export const isCodeTool = (name: string): boolean => CODE_TOOLS.some((t) => t.name === name);

class CodeToolError extends Error {}

const str = (input: Record<string, unknown>, key: string, max = 1000): string => {
  const v = input[key];
  if (typeof v !== 'string' || !v.trim()) throw new CodeToolError(key + ' is required');
  if (v.length > max)
    throw new CodeToolError(key + ' is longer than ' + String(max) + ' characters');
  return v.trim();
};
const optStr = (input: Record<string, unknown>, key: string): string | undefined => {
  const v = input[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};
const int = (input: Record<string, unknown>, key: string, min: number, max: number): number => {
  const v = input[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    throw new CodeToolError(
      key + ' must be a whole number from ' + String(min) + ' to ' + String(max),
    );
  return v;
};
const optInt = (
  input: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | undefined => (input[key] === undefined ? undefined : int(input, key, min, max));
/** a path as the scan keeps it: forward slashes, no leading ./ or /, no trailing / */
const cleanPath = (p: string): string =>
  p
    .replace(/\\/g, '/')
    .replace(/^(\.\/|\/)+/, '')
    .replace(/\/+$/, '');

async function projectOf(
  c: PoolClient,
  a: Access,
  input: Record<string, unknown>,
): Promise<{ id: string; key: string }> {
  const key = str(input, 'project', 20);
  const id = (await c.query<{ id: string }>('SELECT id FROM projects WHERE key = upper($1)', [key]))
    .rows[0]?.id;
  try {
    if (!id) throw new Error();
    const p = await requireProject(c, a, id);
    return { id: p.id, key: p.key };
  } catch {
    throw new CodeToolError('No project ' + key.toUpperCase() + ' that you can see');
  }
}

/** The pull request a tool names: by number, and by repository when the number is not unique. */
export async function pullOf(
  c: PoolClient,
  a: Access,
  input: Record<string, unknown>,
): Promise<PullRow> {
  const p = await projectOf(c, a, input);
  const n = int(input, 'number', 1, 2_000_000_000);
  const r = optStr(input, 'repo');
  const rows = (
    await c.query<PullRow>(
      PULL_SELECT +
        ' WHERE x.project_id = $1 AND x.number = $2 AND ($3::text IS NULL OR lower(g.repo) = lower($3))',
      [p.id, n, r ?? null],
    )
  ).rows;
  const one = rows[0];
  if (!one)
    throw new CodeToolError('No pull request #' + String(n) + ' in ' + p.key + (r ? ' ' + r : ''));
  if (rows.length > 1)
    throw new CodeToolError(
      '#' +
        String(n) +
        ' is in more than one repository: name one with repo (' +
        rows.map((x) => x.repo).join(', ') +
        ')',
    );
  return one;
}

interface CodeRow {
  path: string;
  lines: number;
  complexity: number;
  churn: number;
  authors: Record<string, number>;
  agent_share: number;
  last_commit_at: Date | null;
  imports: string[] | null;
  scanned_at: Date;
}

async function codeMap(c: PoolClient, a: Access, input: Record<string, unknown>) {
  const p = await projectOf(c, a, input);
  const folder = cleanPath(optStr(input, 'folder') ?? '');
  const rows = (
    await c.query<CodeRow>(
      `SELECT path, lines, complexity, churn, authors, agent_share, last_commit_at, scanned_at FROM code_files
        WHERE project_id = $1 AND ($2 = '' OR path LIKE $2 || '/%') LIMIT 50000`,
      [p.id, folder.replace(/[\\%_]/g, '\\$&')],
    )
  ).rows;
  if (!rows.length)
    return folder
      ? { project: p.key, folder, note: 'No scanned files in this folder' }
      : { project: p.key, note: 'No code scan yet: run orq docs scan in the repository' };
  const depth = optInt(input, 'depth', 1, 8) ?? (folder ? folder.split('/').length + 1 : 1);
  const groups = new Map<string, CodeRow[]>();
  for (const r of rows) {
    const f = folderOf(r.path, depth);
    // a file directly in the folder looked at is listed under the folder itself
    const key = f === '(root)' || f.length < folder.length ? folder || '(root)' : f;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const sum = (xs: CodeRow[], f: (r: CodeRow) => number): number =>
    xs.reduce((n, r) => n + f(r), 0);
  const folders = [...groups.entries()]
    .map(([name, xs]) => {
      const lines = sum(xs, (r) => r.lines);
      const by = new Map<string, number>();
      for (const r of xs)
        for (const [who, n] of Object.entries(r.authors)) by.set(who, (by.get(who) ?? 0) + n);
      const written = [...by.values()].reduce((n, v) => n + v, 0);
      const last = xs.reduce<Date | null>(
        (m, r) => (r.last_commit_at && (!m || r.last_commit_at > m) ? r.last_commit_at : m),
        null,
      );
      return {
        folder: name,
        files: xs.length,
        lines,
        complexity: sum(xs, (r) => r.complexity),
        churn: sum(xs, (r) => r.churn),
        agentShare: lines
          ? Math.round((sum(xs, (r) => r.agent_share * r.lines) / lines) * 100) / 100
          : 0,
        owners: [...by.entries()]
          .sort((x, y) => y[1] - x[1])
          .slice(0, 3)
          .map(([name, n]) => ({
            name,
            share: written ? Math.round((n / written) * 100) / 100 : 0,
          })),
        lastCommitAt: last?.toISOString() ?? null,
      };
    })
    .sort((x, y) => y.lines - x.lines);
  return {
    project: p.key,
    ...(folder ? { folder } : {}),
    depth,
    files: rows.length,
    lines: sum(rows, (r) => r.lines),
    scannedAt: rows
      .reduce((m, r) => (r.scanned_at > m ? r.scanned_at : m), new Date(0))
      .toISOString(),
    folders: folders.slice(0, 100),
    ...(folders.length > 100 ? { more: folders.length - 100 } : {}),
  };
}

async function codeDependencies(c: PoolClient, a: Access, input: Record<string, unknown>) {
  const p = await projectOf(c, a, input);
  const path = cleanPath(str(input, 'path', 500));
  const rows = (
    await c.query<{ path: string; imports: string[] | null }>(
      'SELECT path, imports FROM code_files WHERE project_id = $1 LIMIT 50000',
      [p.id],
    )
  ).rows;
  if (!rows.length)
    return { project: p.key, note: 'No code scan yet: run orq docs scan in the repository' };
  if (rows.every((r) => r.imports === null))
    return {
      project: p.key,
      note: 'The last scan did not send imports: run orq docs scan again with the current orq',
    };
  const inside = (x: string): boolean => x === path || x.startsWith(path + '/');
  const own = rows.filter((r) => inside(r.path));
  if (!own.length) throw new CodeToolError('No scanned file or folder ' + path + ' in ' + p.key);
  const count = (pairs: [string, string][]) => {
    const m = new Map<string, Set<string>>();
    for (const [k, v] of pairs) m.set(k, (m.get(k) ?? new Set()).add(v));
    return [...m.entries()]
      .map(([k, vs]) => ({ path: k, via: [...vs].sort().slice(0, 5), count: vs.size }))
      .sort((x, y) => y.count - x.count || x.path.localeCompare(y.path));
  };
  const imports = count(
    own.flatMap((r) =>
      (r.imports ?? []).filter((t) => !inside(t)).map((t): [string, string] => [t, r.path]),
    ),
  );
  const importedBy = count(
    rows
      .filter((r) => !inside(r.path))
      .flatMap((r) => (r.imports ?? []).filter(inside).map((t): [string, string] => [r.path, t])),
  );
  return {
    project: p.key,
    path,
    files: own.length,
    // for each file outside: the files inside that import it (imports) or that it imports (importedBy)
    imports: imports.slice(0, 200),
    importedBy: importedBy.slice(0, 200),
    ...(imports.length > 200 || importedBy.length > 200 ? { truncated: true } : {}),
  };
}

async function listPullRequests(c: PoolClient, a: Access, input: Record<string, unknown>) {
  const p = await projectOf(c, a, input);
  const state = optStr(input, 'state') ?? 'open';
  if (!['open', 'merged', 'closed', 'all'].includes(state))
    throw new CodeToolError('state is open, merged, closed or all');
  const limit = optInt(input, 'limit', 1, 100) ?? 30;
  const rows = (
    await c.query<PullRow>(
      PULL_SELECT +
        ' WHERE x.project_id = $1 AND ($2 = $$all$$ OR x.state = $2) ORDER BY x.updated_at DESC LIMIT $3',
      [p.id, state, limit],
    )
  ).rows;
  return {
    project: p.key,
    pullRequests: rows.map((x) => ({
      number: x.number,
      repo: x.repo,
      title: x.title,
      author: x.author,
      branch: x.branch,
      base: x.base,
      state: x.state,
      draft: x.draft,
      additions: x.additions,
      deletions: x.deletions,
      changedFiles: x.changed_files,
      reviewState: x.review_state,
      checksState: x.checks_state,
      conflicts: x.mergeable === 'conflicts',
      task: x.item_ref,
      url: x.url,
      updatedAt: x.updated_at.toISOString(),
    })),
  };
}

const PATCH_CHARS = 40_000;

async function getPullRequest(c: PoolClient, a: Access, input: Record<string, unknown>) {
  const x = await pullOf(c, a, input);
  const files = (
    await c.query<FileRow>(
      'SELECT * FROM pull_request_files WHERE pull_request_id = $1 ORDER BY position',
      [x.id],
    )
  ).rows;
  const fresh = current(x);
  const comments = (
    await c.query<{
      path: string;
      line: number;
      side: string;
      body: string;
      source: string;
      state: string;
      severity: string | null;
      author: string | null;
      outdated: boolean;
    }>(
      `SELECT m.path, m.line, m.side, m.body, m.source, m.state, m.severity, u.name AS author,
              f.patch_hash IS DISTINCT FROM m.patch_hash AS outdated
         FROM pull_request_comments m LEFT JOIN users u ON u.id = m.author_id
         LEFT JOIN pull_request_files f ON f.pull_request_id = m.pull_request_id AND f.path = m.path
        WHERE m.pull_request_id = $1 AND m.state <> 'dismissed' AND (m.state <> 'draft' OR m.author_id = $2)
        ORDER BY m.path, m.line, m.created_at LIMIT 500`,
      [x.id, a.user.id],
    )
  ).rows;
  const reviews = (
    await c.query<{ decision: string; body: string; author: string | null; created_at: Date }>(
      `SELECT r.decision, r.body, u.name AS author, r.created_at FROM pull_request_reviews r
         LEFT JOIN users u ON u.id = r.user_id WHERE r.pull_request_id = $1 ORDER BY r.created_at`,
      [x.id],
    )
  ).rows;
  const want = optStr(input, 'path');
  let patch: Record<string, unknown> = {};
  if (want) {
    const f = files.find((y) => y.path === cleanPath(want));
    if (!f)
      throw new CodeToolError(
        want + ' is not among the changed files read for #' + String(x.number),
      );
    patch = {
      patch: {
        path: f.path,
        status: f.status,
        ...(f.is_binary
          ? { note: 'A binary file' }
          : f.too_big || !f.patch
            ? { note: 'The host gave no patch for this file (too big or a pure rename)' }
            : {
                text: numberedPatch(f.path, parsePatch(f.patch)).slice(0, PATCH_CHARS),
                ...(f.patch.length > PATCH_CHARS ? { truncated: true } : {}),
              }),
      },
    };
  }
  return {
    number: x.number,
    repo: x.repo,
    title: x.title,
    author: x.author,
    url: x.url,
    branch: x.branch,
    base: x.base,
    state: x.state,
    draft: x.draft,
    reviewState: x.review_state,
    checksState: x.checks_state,
    conflicts: x.mergeable === 'conflicts',
    task: x.item_ref,
    additions: x.additions,
    deletions: x.deletions,
    files: files.map((f) => ({
      path: f.path,
      ...(f.old_path ? { oldPath: f.old_path } : {}),
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
    ...(fresh
      ? {}
      : {
          note: files.length
            ? 'The files are from an earlier commit of the branch'
            : 'The changed files have not been read from the host yet',
        }),
    comments,
    reviews: reviews.map((r) => ({
      decision: r.decision,
      body: r.body,
      author: r.author,
      at: r.created_at.toISOString(),
    })),
    ...patch,
  };
}

async function commentOn(c: PoolClient, a: Access, input: Record<string, unknown>) {
  const x = await pullOf(c, a, input);
  if (x.state !== 'open') throw new CodeToolError('#' + String(x.number) + ' is ' + x.state);
  const path = cleanPath(str(input, 'path'));
  const line = int(input, 'line', 1, 10_000_000);
  const side = optStr(input, 'side') ?? 'new';
  if (side !== 'new' && side !== 'old') throw new CodeToolError('side is new or old');
  const body = str(input, 'body', 20000);
  const f = (
    await c.query<FileRow>(
      'SELECT * FROM pull_request_files WHERE pull_request_id = $1 AND path = $2',
      [x.id, path],
    )
  ).rows[0];
  if (!f) throw new CodeToolError(path + ' is not among the changed files of #' + String(x.number));
  if (!current(x))
    throw new CodeToolError(
      'The branch moved on: read the pull request again with get_pull_request',
    );
  if (!onDiff(parsePatch(f.patch), side, line))
    throw new CodeToolError(
      'Line ' + String(line) + ' is not part of the change shown for ' + path,
    );
  await c.query(
    `INSERT INTO pull_request_comments (workspace_id, pull_request_id, path, line, side, body, source, state, author_id, patch_hash)
     VALUES ($1, $2, $3, $4, $5, $6, 'person', 'draft', $7, $8)`,
    [x.workspace_id, x.id, path, line, side, body, a.user.id, f.patch_hash],
  );
  return {
    draft: true,
    note:
      'Saved as your draft on ' +
      path +
      ':' +
      String(line) +
      '; post it with your next review in Orqiva',
  };
}

/** Runs one of the code tools as the token's person; a refusal comes back as the tool's error text. */
export async function runCodeTool(
  name: string,
  input: Record<string, unknown>,
  c: PoolClient,
  a: Access,
): Promise<{ ok: boolean; content: string }> {
  if (!atLeast(a.role, 'member'))
    return { ok: false, content: 'The code and pull requests are for members of the workspace' };
  try {
    const out =
      name === 'code_map'
        ? await codeMap(c, a, input)
        : name === 'code_dependencies'
          ? await codeDependencies(c, a, input)
          : name === 'list_pull_requests'
            ? await listPullRequests(c, a, input)
            : name === 'get_pull_request'
              ? await getPullRequest(c, a, input)
              : await commentOn(c, a, input);
    return { ok: true, content: JSON.stringify(out) };
  } catch (e) {
    if (e instanceof CodeToolError) return { ok: false, content: e.message };
    throw e;
  }
}
