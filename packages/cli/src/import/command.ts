// ── [PCODE-360 | S15 | v0.1.0] T35.7b Jira and Linear imports with assignees and comments ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-107 | S15 | v0.1.0] Build the Plane importer: projects, items, states, comments, cycles, history ──
//    Why:  `orq import plane --project PCODE` from a folder linked to the target server (orq link): it imports
//          into that workspace, as a new project with Plane's key, or into the linked project with
//          --into-linked. The Plane key comes from the environment the engine already uses
//          (PLANE_API_KEY, PLANE_BASE_URL, PLANE_WORKSPACE_SLUG) and is never written anywhere.
// ── [PCODE-109 | S15 | v0.1.0] Move PCODE into Orqiva and retire Plane for this project ──
// ── [PCODE-129 | S15 | v0.1.0] Import from Jira and Linear CSV exports ──
import { makeApi, type Api } from '../loop/api.js';
import { findRoot, loadCredentials } from '../loop/config.js';
import { linked, option, LoopError, type LoopDeps, type LoopResult } from '../loop/commands.js';
import {
  PlaneReader,
  readPlaneProject,
  sendBundle,
  type Bundle,
  type PlaneReaderOptions,
} from './plane.js';
// [PCODE-129 | S15 | v0.1.0]
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { matchPeople, readJira, readLinear, readPeople, TrackerError } from './trackers.js'; // [PCODE-360 | S15 | v0.1.0]

export const IMPORT_USAGE =
  '  import plane --project KEY [--key NEWKEY] [--into-linked] [--server URL [--workspace ID]] [--dry-run]\n' +
  '                             copy a Plane project with its comments, cycles and history\n' +
  '  import jira|linear <export.csv> [--project KEY] [--key NEWKEY] [--people people.csv] [--into-linked] [--server URL [--workspace ID]] [--dry-run]\n' +
  '                             bring a Jira or Linear CSV export in with assignees and comments; running it again updates\n' +
  '                             (--people: a CSV of name or id, email for people the members list does not match)';

// [PCODE-109 | S15 | v0.1.0] where to import: the linked folder's workspace, or, on a fresh server where
// no project exists to link to yet, --server (signed in with orq login) and --workspace when there are several
async function target(
  argv: readonly string[],
  deps: LoopDeps,
): Promise<{ api: Api; server: string; workspaceId: string; projectId?: string }> {
  const server = option(argv, '--server')?.replace(/\/$/, '');
  if (!server && findRoot(deps.cwd)) {
    const l = linked(deps);
    return {
      api: l.api,
      server: l.link.server,
      workspaceId: l.link.workspaceId,
      projectId: l.link.projectId,
    };
  }
  if (!server)
    throw new LoopError('Link this folder (orq link KEY) or name the server: --server <url>');
  const token = deps.env['ORQIVA_TOKEN'] ?? loadCredentials(deps.home).servers[server]?.token;
  if (!token)
    throw new LoopError('Not signed in to ' + server + '. Run: orq login --server ' + server);
  const api = makeApi(server, token, deps.fetchImpl);
  const me = await api.call<{ workspaces: { id: string; name: string }[] }>('GET', '/auth/me');
  const wanted = option(argv, '--workspace');
  const ws = wanted
    ? me.workspaces.find((w) => w.id === wanted)
    : me.workspaces.length === 1
      ? me.workspaces[0]
      : undefined;
  if (!ws)
    throw new LoopError(
      'Pick the workspace with --workspace <id>: ' +
        me.workspaces.map((w) => w.name + ' ' + w.id).join(', '),
    );
  return { api, server, workspaceId: ws.id };
}

export async function runImport(
  argv: readonly string[],
  deps: LoopDeps & { log?: (line: string) => void; plane?: PlaneReaderOptions },
): Promise<LoopResult> {
  // [PCODE-129 | S15 | v0.1.0] Jira and Linear arrive as CSV exports
  if (argv[1] === 'jira' || argv[1] === 'linear') return importCsv(argv, deps);
  if (argv[1] !== 'plane') return { code: 2, out: 'Usage: orq ' + IMPORT_USAGE.trim() };
  const project = option(argv, '--project');
  if (!project) return { code: 2, out: 'Usage: orq ' + IMPORT_USAGE.trim() };
  const env = deps.env;
  const apiKey = env['PLANE_API_KEY'];
  const workspace = option(argv, '--plane-workspace') ?? env['PLANE_WORKSPACE_SLUG'];
  const baseUrl = option(argv, '--plane-url') ?? env['PLANE_BASE_URL'];
  if (!apiKey || !workspace || !baseUrl)
    throw new LoopError(
      'Set PLANE_API_KEY, PLANE_BASE_URL and PLANE_WORKSPACE_SLUG (a Plane API key, read only is enough)',
    );
  const log = deps.log ?? (() => undefined);
  const dry = argv.includes('--dry-run');
  const l = dry ? null : await target(argv, deps);
  const reader = new PlaneReader({ apiKey, workspace, baseUrl }, { ...deps.plane, log });
  const bundle = await readPlaneProject(reader, project, log);
  const newKey = option(argv, '--key');
  if (newKey) bundle.project.key = newKey.toUpperCase();
  const read =
    String(bundle.items.length) +
    ' items, ' +
    String(bundle.comments.length) +
    ' comments, ' +
    String(bundle.history.length) +
    ' history entries, ' +
    String(bundle.sprints.length) +
    ' cycles (' +
    String(reader.requests) +
    ' Plane requests)';
  if (!l) return { code: 0, out: 'Dry run: read ' + read + '. Nothing was sent.' };
  if (argv.includes('--into-linked') && !l.projectId)
    throw new LoopError('--into-linked needs a folder linked with orq link');
  const into = argv.includes('--into-linked') ? l.projectId : undefined;
  const r = await sendBundle(l.api, l.workspaceId, bundle, into, log);
  return {
    code: 0,
    out:
      'Imported ' +
      bundle.project.key +
      ' into ' +
      l.server +
      ': ' +
      String(r.counts.items) +
      ' items, ' +
      String(r.counts.comments) +
      ' comments, ' +
      String(r.counts.history) +
      ' new history entries, ' +
      String(r.counts.sprints) +
      ' sprints, ' +
      String(r.counts.states) +
      ' states, ' +
      String(r.counts.labels) +
      ' labels. Read ' +
      read +
      '. Running it again updates instead of duplicating.',
  };
}

// [PCODE-129 | S15 | v0.1.0]
async function importCsv(
  argv: readonly string[],
  deps: LoopDeps & { log?: (line: string) => void },
): Promise<LoopResult> {
  const tool = argv[1] === 'jira' ? 'jira' : 'linear';
  const file = argv[2];
  if (!file || file.startsWith('--')) return { code: 2, out: 'Usage: orq ' + IMPORT_USAGE.trim() };
  const path = isAbsolute(file) ? file : join(deps.cwd, file);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new LoopError('Cannot read ' + path);
  }
  const now = new Date(deps.now?.() ?? Date.now()).toISOString();
  let read: { bundle: Bundle; skipped: number };
  try {
    read = (tool === 'jira' ? readJira : readLinear)(text, now, option(argv, '--project'));
  } catch (e) {
    if (e instanceof TrackerError) throw new LoopError(e.message);
    throw e;
  }
  const { bundle, skipped } = read;
  const newKey = option(argv, '--key');
  if (newKey) bundle.project.key = newKey.toUpperCase();
  const what =
    String(bundle.items.length) +
    ' issues of ' +
    bundle.project.key +
    ' (' +
    String(bundle.states.length) +
    ' statuses, ' +
    String(bundle.sprints.length) +
    ' sprints, ' +
    String(bundle.labels.length) +
    ' labels)' +
    (skipped
      ? '; ' + String(skipped) + ' issues of other projects left out (choose with --project)'
      : '');
  // [PCODE-360 | S15 | v0.1.0] the people the file names, matched to the workspace's members before sending
  const peopleFile = option(argv, '--people');
  let extra: { name: string; email: string }[] = [];
  if (peopleFile) {
    const p = isAbsolute(peopleFile) ? peopleFile : join(deps.cwd, peopleFile);
    try {
      extra = readPeople(readFileSync(p, 'utf8'));
    } catch {
      throw new LoopError('Cannot read ' + p);
    }
  }
  if (argv.includes('--dry-run')) {
    const m = matchPeople(structuredClone(bundle), [], extra);
    return {
      code: 0,
      out:
        'Dry run: read ' +
        what +
        ', ' +
        String(bundle.comments.length) +
        ' comments, ' +
        String(m.named) +
        ' people named. Nothing was sent.',
    };
  }
  const l = await target(argv, deps);
  const members = await l.api.call<{ name: string; email: string }[]>(
    'GET',
    '/api/workspaces/' + l.workspaceId + '/members',
  );
  const people = matchPeople(bundle, members, extra);
  if (argv.includes('--into-linked') && !l.projectId)
    throw new LoopError('--into-linked needs a folder linked with orq link');
  const into = argv.includes('--into-linked') ? l.projectId : undefined;
  const r = await sendBundle(l.api, l.workspaceId, bundle, into, deps.log ?? (() => undefined));
  return {
    code: 0,
    out:
      'Imported ' +
      String(r.counts.items) +
      ' items from ' +
      (tool === 'jira' ? 'Jira' : 'Linear') +
      ' into ' +
      bundle.project.key +
      ' on ' +
      l.server +
      '. Read ' +
      what +
      ', ' +
      String(r.counts.comments) +
      ' comments. ' +
      // [PCODE-360 | S15 | v0.1.0]
      (people.unmatched.length
        ? String(people.named - people.unmatched.length) +
          ' of ' +
          String(people.named) +
          ' people matched members; not matched (add them with --people): ' +
          people.unmatched.slice(0, 10).join(', ') +
          (people.unmatched.length > 10 ? ' …' : '') +
          '. '
        : people.named
          ? 'All ' + String(people.named) + ' people matched members. '
          : '') +
      'Running it again updates instead of duplicating.',
  };
}
