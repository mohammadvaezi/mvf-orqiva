// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
// ── [PCODE-296 | S15 | v0.1.0] T30.9 Accessibility checks: alt text, names, focus order, target size, in the code and on the page ──
// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-103 | S15 | v0.1.0] Build the CLI `orq` and the Claude Code hooks against the new server ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Why:  the task loop on the developer's machine: login, link a repository to a project, then
//          list → start → code with fingerprints → done. Every command is a function of its arguments
//          and injected dependencies (cwd, home, network, git), so the tests run it without a terminal.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { indexMarkdown } from '@orqiva/shared';
import type { Exec } from './exec.js'; // [PCODE-436 | S15 | v0.1.0]
import { ApiError, flushQueue, makeApi, type Api } from './api.js';
import {
  ensureStateIgnored,
  dotDir,
  findRoot,
  loadActive,
  loadCredentials,
  loadLink,
  saveActive,
  saveCredentials,
  statePath,
  writeJson,
  linkPath,
  type ActiveTask,
  type LoopRules,
  type ProjectLink,
} from './config.js';
import { scanRepo } from './scan.js';
import { isUiFile } from '@orqiva/shared'; // [PCODE-290 | S15 | v0.1.0]
import { findingLine, kitIndex, lintFiles } from './kit.js';
import { a11yFiles, a11yLine } from './a11y.js'; // [PCODE-296 | S15 | v0.1.0]

export interface LoopDeps {
  cwd: string;
  home: string;
  hostname: string;
  exec: Exec;
  fetchImpl?: typeof fetch;
  /** asks for a password without echo; undefined when there is no terminal */
  readSecret?: (prompt: string) => Promise<string>;
  env: Record<string, string | undefined>;
  now?: () => number;
}

export interface LoopResult {
  code: number;
  out: string;
}

export class LoopError extends Error {}

interface Fingerprint {
  task: string;
  sprint: string;
  version: string;
  title: string;
  marker: string;
}
interface TaskOut {
  id: string;
  ref: string;
  title: string;
  description: string;
  state: string;
  projectId: string;
  projectKey: string;
}
export interface StartOut {
  sessionId: string;
  task: TaskOut;
  fingerprint: Fingerprint;
  rules: LoopRules;
  resumed: boolean;
}

export function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

/** Arguments that are neither flags nor the values of flags. */
export function positionals(argv: readonly string[], valued: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (valued.includes(a)) i++;
    else if (!a.startsWith('--')) out.push(a);
  }
  return out;
}

/** One client per machine and checkout: two clones on one laptop are two places of work. */
export const clientKey = (hostname: string, root: string): string =>
  hostname + ':' + root.replace(/\\/g, '/');

export interface Linked {
  root: string;
  link: ProjectLink;
  api: Api;
  client: string;
  ws: string;
}

export function linked(deps: LoopDeps): Linked {
  const root = findRoot(deps.cwd);
  if (!root)
    throw new LoopError(
      'This folder is not linked to a project. Run: orq link <PROJECT-KEY> --server <url>',
    );
  const link = loadLink(root);
  if (!link) throw new LoopError('.orqiva/project.json cannot be read');
  const token = deps.env['ORQIVA_TOKEN'] ?? loadCredentials(deps.home).servers[link.server]?.token;
  if (!token)
    throw new LoopError(
      'Not signed in to ' + link.server + '. Run: orq login --server ' + link.server,
    );
  return {
    root,
    link,
    api: makeApi(link.server, token, deps.fetchImpl),
    client: clientKey(deps.hostname, root),
    ws: '/api/workspaces/' + link.workspaceId,
  };
}

export function activeFrom(
  r: StartOut,
  clientSession: string,
  previous: ActiveTask | null,
): ActiveTask {
  const same = previous?.ref === r.task.ref;
  return {
    sessionId: r.sessionId,
    ref: r.task.ref,
    taskId: r.task.id,
    title: r.task.title,
    sprint: r.fingerprint.sprint,
    version: r.fingerprint.version,
    marker: r.fingerprint.marker,
    rules: r.rules,
    clientSession,
    files: same ? previous.files : [],
    pending: same ? previous.pending : [],
    lastProgressAt: same ? previous.lastProgressAt : 0,
    lastCommit: same ? previous.lastCommit : '',
  };
}

const markerHelp = (a: ActiveTask): string =>
  'Fingerprint: `' +
  a.marker +
  '` in a comment, once in each file header and above every block written for the task.';

async function login(argv: readonly string[], deps: LoopDeps): Promise<LoopResult> {
  const root = findRoot(deps.cwd);
  const server = (option(argv, '--server') ?? (root ? loadLink(root)?.server : undefined))?.replace(
    /\/$/,
    '',
  );
  if (!server)
    throw new LoopError('Usage: orq login --server <url> [--email you@company] [--token orq_…]');
  let token = option(argv, '--token') ?? deps.env['ORQIVA_TOKEN'];
  let email = option(argv, '--email') ?? '';
  if (!token) {
    if (!email)
      throw new LoopError(
        'Give --email (a password is asked for) or --token (create one in the web app)',
      );
    const password =
      deps.env['ORQIVA_PASSWORD'] ?? (deps.readSecret ? await deps.readSecret('Password: ') : '');
    if (!password) throw new LoopError('No password given');
    const anon = makeApi(server, '', deps.fetchImpl);
    const r = await anon.call<{ token: string }>('POST', '/auth/tokens', {
      name: 'orq on ' + deps.hostname,
      email,
      password,
    });
    token = r.token;
  }
  const me = await makeApi(server, token, deps.fetchImpl).call<{
    user: { email: string; name: string };
  }>('GET', '/auth/me');
  email = me.user.email;
  const creds = loadCredentials(deps.home);
  creds.servers[server] = { token, email };
  saveCredentials(deps.home, creds);
  return { code: 0, out: 'Signed in to ' + server + ' as ' + me.user.name + ' <' + email + '>' };
}

async function link(argv: readonly string[], deps: LoopDeps): Promise<LoopResult> {
  const [key] = positionals(argv.slice(1), ['--server', '--workspace']);
  if (!key)
    throw new LoopError('Usage: orq link <PROJECT-KEY> [--server <url>] [--workspace <id>]');
  const creds = loadCredentials(deps.home);
  const server = (option(argv, '--server') ?? Object.keys(creds.servers)[0])?.replace(/\/$/, '');
  if (!server) throw new LoopError('Sign in first: orq login --server <url>');
  const token = deps.env['ORQIVA_TOKEN'] ?? creds.servers[server]?.token;
  if (!token)
    throw new LoopError('Not signed in to ' + server + '. Run: orq login --server ' + server);
  const api = makeApi(server, token, deps.fetchImpl);
  const me = await api.call<{ workspaces: { id: string; name: string }[] }>('GET', '/auth/me');
  const wanted = option(argv, '--workspace');
  const found: ProjectLink[] = [];
  for (const w of me.workspaces) {
    if (wanted && w.id !== wanted) continue;
    const projects = await api.call<{ id: string; key: string; name: string; archived: boolean }[]>(
      'GET',
      '/api/workspaces/' + w.id + '/projects',
    );
    for (const p of projects)
      if (p.key === key.toUpperCase() && !p.archived)
        found.push({
          server,
          workspaceId: w.id,
          projectId: p.id,
          projectKey: p.key,
          projectName: p.name,
        });
  }
  const [only] = found;
  if (!only)
    throw new LoopError('No project ' + key.toUpperCase() + ' that you can see on ' + server);
  if (found.length > 1)
    throw new LoopError(
      'Project ' +
        only.projectKey +
        ' exists in several workspaces; pick one with --workspace <id>',
    );
  writeJson(linkPath(deps.cwd), only);
  ensureStateIgnored(deps.cwd);
  return {
    code: 0,
    out:
      'Linked ' +
      deps.cwd +
      ' to ' +
      only.projectName +
      ' (' +
      only.projectKey +
      '). Next: orq hooks install, then orq list',
  };
}

async function list(deps: LoopDeps): Promise<LoopResult> {
  const l = linked(deps);
  const rows = await l.api.call<
    { ref: string; title: string; state: string; sprint: string | null }[]
  >('GET', l.ws + '/loop/open?project=' + l.link.projectKey);
  if (rows.length === 0) return { code: 0, out: 'No open tasks in ' + l.link.projectKey };
  const active = loadActive(l.root);
  const lines = rows.map(
    (r) =>
      (active?.ref === r.ref ? '* ' : '  ') +
      r.ref.padEnd(10) +
      r.state.padEnd(13) +
      (r.sprint ?? 'Backlog').slice(0, 24).padEnd(26) +
      r.title,
  );
  return { code: 0, out: lines.join('\n') };
}

async function show(ref: string, deps: LoopDeps): Promise<LoopResult> {
  const l = linked(deps);
  const r = await l.api.call<{ task: TaskOut; fingerprint: Fingerprint }>(
    'GET',
    l.ws + '/loop/tasks/' + ref,
  );
  return {
    code: 0,
    out: [
      r.task.ref + '  ' + r.task.title,
      'State: ' + r.task.state,
      'Fingerprint: ' + r.fingerprint.marker,
      '',
      r.task.description.trim() || '(no description)',
    ].join('\n'),
  };
}

async function start(ref: string, deps: LoopDeps): Promise<LoopResult> {
  const l = linked(deps);
  const clientSession = deps.env['CLAUDE_SESSION_ID'] ?? '';
  const r = await l.api.call<StartOut>('POST', l.ws + '/loop/start', {
    ref,
    client: l.client,
    clientSession,
  });
  const a = activeFrom(r, clientSession, loadActive(l.root));
  saveActive(l.root, a);
  return {
    code: 0,
    out: (r.resumed ? 'Resumed ' : 'Started ') + a.ref + ' ' + a.title + '\n' + markerHelp(a),
  };
}

const STATES = ['review', 'test', 'blocked', 'todo', 'backlog', 'progress'];

async function status(argv: readonly string[], deps: LoopDeps): Promise<LoopResult> {
  const [ref, state] = positionals(argv.slice(1), ['--note']);
  if (!ref || !state || !STATES.includes(state))
    throw new LoopError('Usage: orq status <REF> ' + STATES.join('|') + ' [--note "why"]');
  const l = linked(deps);
  const note = option(argv, '--note');
  const r = await l.api.call<{ state: string; ended: boolean }>('POST', l.ws + '/loop/status', {
    ref,
    state,
    ...(note ? { note } : {}),
  });
  if (r.ended && loadActive(l.root)?.ref === ref.toUpperCase()) saveActive(l.root, null);
  return {
    code: 0,
    out: ref.toUpperCase() + ' → ' + r.state + (r.ended ? ' (no longer active here)' : ''),
  };
}

async function note(ref: string, text: string, deps: LoopDeps): Promise<LoopResult> {
  const l = linked(deps);
  const t = await l.api.call<{ task: TaskOut }>('GET', l.ws + '/loop/tasks/' + ref);
  await l.api.call('POST', l.ws + '/items/' + t.task.id + '/comments', { body: text });
  return { code: 0, out: 'Noted on ' + t.task.ref };
}

async function create(argv: readonly string[], deps: LoopDeps): Promise<LoopResult> {
  const [title] = positionals(argv.slice(1), ['--desc-file', '--desc']);
  const file = option(argv, '--desc-file');
  const description = file
    ? readFileSync(resolve(deps.cwd, file), 'utf8') // [PCODE-105 | S15 | v0.1.0] absolute paths too (VS Code passes one)
    : (option(argv, '--desc') ?? '');
  if (!title) throw new LoopError('Usage: orq new "Title" --desc-file what-why-check.md [--start]');
  const l = linked(deps);
  const it = await l.api.call<{ ref: string; title: string }>(
    'POST',
    l.ws + '/projects/' + l.link.projectId + '/items',
    {
      title,
      description,
    },
  );
  if (argv.includes('--start')) {
    const s = await start(it.ref, deps);
    return { code: 0, out: 'Created ' + it.ref + '\n' + s.out };
  }
  return { code: 0, out: 'Created ' + it.ref + ' ' + it.title };
}

async function git(deps: LoopDeps, root: string, args: string[]): Promise<string> {
  const r = await deps.exec('git', args, root);
  if (r.code !== 0) throw new LoopError('git ' + args.join(' ') + ' failed: ' + r.out.trim());
  return r.out.trim();
}

/** The paths git ignores, of those given (none when git cannot tell). */
async function ignoredPaths(deps: LoopDeps, root: string, paths: string[]): Promise<Set<string>> {
  if (!paths.length) return new Set();
  const r = await deps.exec('git', ['check-ignore', '--', ...new Set(paths)], root);
  // exit 1: none ignored; 128: not a repository
  return new Set(
    r.code === 0
      ? r.out
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean)
      : [],
  );
}

async function done(argv: readonly string[], deps: LoopDeps): Promise<LoopResult> {
  const [ref] = positionals(argv.slice(1), []);
  if (!ref) throw new LoopError('Usage: orq done <REF> [--force] [--no-commit]');
  const l = linked(deps);
  const force = argv.includes('--force');
  const task = (await l.api.call<{ task: TaskOut }>('GET', l.ws + '/loop/tasks/' + ref)).task;
  // [PCODE-218 | S15 | v0.1.0] build output git ignores (out/, a generated site) is not the task's code
  const found = scanRepo(l.root, task.ref);
  const ignored = await ignoredPaths(
    deps,
    l.root,
    found.map((h) => h.file),
  );
  const hits = found.filter((h) => !ignored.has(h.file));
  if (hits.length === 0 && !force)
    throw new LoopError(
      'No fingerprint of ' +
        task.ref +
        ' in the code. Mark the code you wrote for it, or for a task without code: orq done ' +
        task.ref +
        ' --force',
    );
  // the index is regenerated from every marker in the repository, so it is part of the commit
  const all = scanRepo(l.root);
  writeFileSync(
    join(dotDir(l.root), 'fingerprints.md'),
    indexMarkdown(all, { name: l.link.projectName, key: l.link.projectKey }),
  );
  let commit: string | null = null;
  if (!argv.includes('--no-commit')) {
    const active = loadActive(l.root);
    const touched = new Set([
      ...(active?.ref === task.ref ? active.files : []),
      ...hits.map((h) => h.file),
      '.orqiva/fingerprints.md',
    ]);
    const paths = [...touched].filter((p) => existsSync(join(l.root, p)));
    await git(deps, l.root, ['add', '--', ...paths]);
    const staged = await deps.exec('git', ['diff', '--cached', '--quiet'], l.root);
    if (staged.code === 1) {
      await git(deps, l.root, ['commit', '-m', task.ref + ' ' + task.title]);
      commit = await git(deps, l.root, ['rev-parse', 'HEAD']);
    }
  }
  const r = await l.api.call<{ state: string; files: number }>('POST', l.ws + '/loop/done', {
    ref: task.ref,
    commit,
    files: hits.map((h) => ({ path: h.file, line: h.line, kind: h.kind })),
    ...(force ? { force: true } : {}),
  });
  // [PCODE-290 | S15 | v0.1.0] raw colours and sizes in the task's UI files: a warning, never a stop
  const active = loadActive(l.root);
  const kitNote = await kitWarning(l, [
    ...new Set([...(active?.ref === task.ref ? active.files : []), ...hits.map((h) => h.file)]),
  ]);
  if (active?.ref === task.ref) saveActive(l.root, null);
  // [PCODE-466 | S15 | v0.1.0] the turn that ran this reports its tokens afterwards: they are this task's
  writeJson(statePath(l.root, 'last-task.json'), { ref: task.ref, at: new Date().toISOString() });
  return {
    code: 0,
    out:
      task.ref +
      ' → ' +
      r.state +
      ': ' +
      String(r.files) +
      ' file(s) fingerprinted' +
      (commit ? ', commit ' + commit.slice(0, 9) : ', nothing to commit') +
      kitNote +
      (await a11yWarning(
        l,
        active?.ref === task.ref ? active.files : [],
        hits.map((h) => h.file),
      )),
  };
}

/** [PCODE-290 | S15 | v0.1.0] a line about raw values in UI files, or '' (also when the server cannot be asked). */
async function kitWarning(l: Linked, files: readonly string[]): Promise<string> {
  const ui = files.filter(isUiFile);
  if (!ui.length) return '';
  try {
    const { index, count } = await kitIndex(l);
    if (!count) return '';
    const found = await lintFiles(l.root, ui, index);
    if (!found.length) return '';
    return (
      '\nUI kit: ' +
      String(found.length) +
      ' raw colour(s) or size(s) in this task’s files; tokens exist for ' +
      String(found.filter((f) => f.token).length) +
      ' of them.\n' +
      found.slice(0, 10).map(findingLine).join('\n') +
      (found.length > 10 ? '\n  … orq kit check shows all.' : '')
    );
  } catch {
    return '';
  }
}

/** [PCODE-296 | S15 | v0.1.0] accessibility problems in the task's files: a warning, never a stop. */
async function a11yWarning(
  l: Linked,
  touched: readonly string[],
  fingerprinted: readonly string[],
): Promise<string> {
  try {
    const found = await a11yFiles(l.root, [...new Set([...touched, ...fingerprinted])]);
    if (!found.length) return '';
    return (
      '\nAccessibility: ' +
      String(found.length) +
      ' problem(s) in this task’s files.\n' +
      found.slice(0, 10).map(a11yLine).join('\n') +
      (found.length > 10 ? '\n  … orq a11y check shows all.' : '')
    );
  } catch {
    return '';
  }
}

async function sync(deps: LoopDeps): Promise<LoopResult> {
  const l = linked(deps);
  const [sent, left] = await flushQueue(l.root, l.api);
  const r = await l.api.call<{ active: StartOut | null }>(
    'GET',
    l.ws + '/loop/active?client=' + encodeURIComponent(l.client),
  );
  const previous = loadActive(l.root);
  const lines: string[] = [];
  if (sent || left)
    lines.push(
      'Sent ' +
        String(sent) +
        ' waiting update(s)' +
        (left ? ', ' + String(left) + ' still waiting' : ''),
    );
  if (r.active) {
    const a = activeFrom({ ...r.active, resumed: true }, previous?.clientSession ?? '', previous);
    saveActive(l.root, a);
    lines.push('Active: ' + a.ref + ' ' + a.title, markerHelp(a));
  } else {
    if (previous) saveActive(l.root, null);
    lines.push('No active task here. orq list, then orq start <REF>');
  }
  return { code: 0, out: lines.join('\n') };
}

export const LOOP_USAGE = [
  '  login --server URL [--email E | --token T]   sign in; the token is kept in ~/.orqiva',
  '  link KEY [--server URL] [--workspace ID]     link this folder to a project',
  '  sync                       send waiting updates, recover the active task',
  '  list                       open tasks of the project, active sprint first',
  '  show REF                   a task and its fingerprint',
  '  new "Title" --desc-file F [--start]',
  '  start REF                  In Progress, assigned to you, active here',
  '  status REF review|test|blocked|todo [--note "why"]',
  '  note REF "text"            a comment on the task',
  '  done REF [--force] [--no-commit]   scan fingerprints, commit, report',
  '  hooks install              wire the Claude Code hooks of this repository',
];

/** Runs a loop command, or returns null when the command is not one. */
export async function runLoop(argv: readonly string[], deps: LoopDeps): Promise<LoopResult | null> {
  const [command, a1, a2] = argv;
  const need = (v: string | undefined, usage: string): string => {
    if (!v) throw new LoopError('Usage: ' + usage);
    return v;
  };
  try {
    switch (command) {
      case 'login':
        return await login(argv, deps);
      case 'link':
        return await link(argv, deps);
      case 'list':
        return await list(deps);
      case 'show':
        return await show(need(a1, 'orq show <REF>'), deps);
      case 'start':
        return await start(need(a1, 'orq start <REF>'), deps);
      case 'status':
        return await status(argv, deps);
      case 'note':
        return await note(
          need(a1, 'orq note <REF> "text"'),
          need(a2, 'orq note <REF> "text"'),
          deps,
        );
      case 'new':
        return await create(argv, deps);
      case 'done':
        return await done(argv, deps);
      case 'sync':
        return await sync(deps);
      default:
        return null;
    }
  } catch (err) {
    if (err instanceof LoopError || err instanceof ApiError) return { code: 1, out: err.message };
    throw err;
  }
}
