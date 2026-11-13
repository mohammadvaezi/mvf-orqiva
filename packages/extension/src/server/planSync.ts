// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
// ── [PCODE-456 | S15 | v0.1.0] Planning in VS Code shows live in the portal: local AI runs, hook steps, plan documents synced ──
//    Why:  what happens while a project is planned in VS Code shows in the Orqiva portal. The planning run
//          of Claude Code is a run of the Planner agent there, live: VS Code opens it, the orq hooks add a
//          step for every tool Claude uses (they find the run in .orqiva/state/run.json), and VS Code ends
//          it when the planning terminal closes. The description and the documents Claude writes land in
//          the project's Documents under "Project plan", updated in place: a page someone changed in the
//          portal since the last sync is left alone and named. Free of vscode, so it is tested against a
//          fake server.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeApi } from '../../../cli/src/loop/api';
import { installHooks, RUN_TOOLS } from '../../../cli/src/loop/hooks';
import { detectServer } from './connection';
import { projectFile } from '../state/files';
import type { RunUsage } from '../plan/claudeRun';
import type { PlanJson } from '../state/types';

export interface PlanTarget {
  root: string;
  server: string;
  token: string;
  workspaceId: string;
  projectId: string;
}

/** The server, sign-in and project of an Orqiva folder; null when it is not on Orqiva or not signed in. */
export function planTarget(root: string, home: string): PlanTarget | null {
  const t = detectServer(root, home);
  if (!t) return null;
  return {
    root: t.root,
    server: t.link.server,
    token: t.token,
    workspaceId: t.link.workspaceId,
    projectId: t.link.projectId,
  };
}

const api = (t: PlanTarget, fetchImpl?: typeof fetch) => makeApi(t.server, t.token, fetchImpl);
const ws = (t: PlanTarget): string => '/api/workspaces/' + t.workspaceId;
const runFile = (root: string): string => projectFile(root, ['state', 'run.json']);

// ── [PCODE-456 | S15 | v0.1.0] the planning run: opened, found by the hooks, ended with its result ──
export async function openPlanRun(
  t: PlanTarget,
  input: { instruction: string; client: string },
  fetchImpl?: typeof fetch,
): Promise<string> {
  const run = await api(t, fetchImpl).call<{ id: string }>(
    'POST',
    ws(t) + '/projects/' + t.projectId + '/local-runs',
    { agent: 'planner', instruction: input.instruction, client: input.client },
  );
  const file = runFile(t.root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ runId: run.id }, null, 2) + '\n', 'utf8');
  return run.id;
}

/** The run of this folder that VS Code opened and has not ended yet, if any. */
export function openRunId(root: string): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(runFile(root), 'utf8')) as { runId?: unknown };
    return typeof v.runId === 'string' ? v.runId : null;
  } catch {
    return null;
  }
}

export async function finishPlanRun(
  t: PlanTarget,
  runId: string,
  result: {
    status: 'succeeded' | 'failed' | 'cancelled';
    summary?: string;
    error?: string;
    /** [PCODE-466 | S15 | v0.1.0] what the AI used in the run */
    usage?: RunUsage;
  },
  fetchImpl?: typeof fetch,
): Promise<void> {
  fs.rmSync(runFile(t.root), { force: true }); // the hooks stop reporting first
  await api(t, fetchImpl).call('POST', ws(t) + '/agent-runs/' + runId + '/finish', result);
}

/** Ends a run with a note in VS Code's words, when no hook was there to report it (start, plan written). */
export async function addRunNote(
  t: PlanTarget,
  runId: string,
  text: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  await api(t, fetchImpl).call('POST', ws(t) + '/agent-runs/' + runId + '/steps', {
    kind: 'note',
    text,
  });
}

// ── [PCODE-456 | S15 | v0.1.0] the hooks that report the steps: brought up to date before a planning run ──
const ORQ_HOOK = /^node "([^"]+)" hook [A-Za-z]+$/;

/**
 * The folder's Claude Code hooks, so that they report every tool to an open run: hooks from an older orq
 * are rewritten with the same orq; a folder without them gets them when orq is installed on this
 * computer. Returns what it did, for the log.
 */
export function refreshHooks(
  root: string,
  installedOrq: string | null,
): 'current' | 'updated' | 'installed' | 'no-orq' {
  const file = path.join(root, '.claude', 'settings.json');
  let settings: { hooks?: Record<string, { matcher?: string; hooks?: { command?: string }[] }[]> } =
    {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof settings;
  } catch {
    /* no settings yet */
  }
  const entries = Object.values(settings.hooks ?? {}).flat();
  const orq = entries
    .flatMap((e) => e.hooks ?? [])
    .map((h) => ORQ_HOOK.exec(h.command ?? '')?.[1])
    .find((p): p is string => Boolean(p));
  if (orq) {
    const post = settings.hooks?.['PostToolUse']?.find((e) =>
      e.hooks?.some((h) => ORQ_HOOK.test(h.command ?? '')),
    );
    if (post?.matcher === RUN_TOOLS) return 'current';
    installHooks(root, orq);
    return 'updated';
  }
  if (!installedOrq || !fs.existsSync(installedOrq)) return 'no-orq';
  installHooks(root, installedOrq.replace(/\\/g, '/'));
  return 'installed';
}

// ── [PCODE-462 | S15 | v0.1.0] the orq command Claude runs in this folder: the hooks' own, else this computer's ──
export function orqCommand(root: string, installedOrq: string | null): string {
  try {
    const settings = JSON.parse(
      fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'),
    ) as { hooks?: Record<string, { hooks?: { command?: string }[] }[]> };
    const orq = Object.values(settings.hooks ?? {})
      .flat()
      .flatMap((e) => e.hooks ?? [])
      .map((h) => ORQ_HOOK.exec(h.command ?? '')?.[1])
      .find((p): p is string => Boolean(p));
    if (orq) return 'node "' + orq + '"';
  } catch {
    /* no hooks in this folder */
  }
  return installedOrq && fs.existsSync(installedOrq)
    ? 'node "' + installedOrq.replace(/\\/g, '/') + '"'
    : 'orq';
}

// ── [PCODE-456 | S15 | v0.1.0] the plan as a page: the sprints with their goal and tasks ──
export function planMarkdown(plan: PlanJson): string {
  const items = plan.sprints.reduce((n, s) => n + s.items.length, 0);
  const lines = [
    `${String(plan.sprints.length)} one-day sprints with ${String(items)} tasks, from ${plan.sprints[0]?.date ?? ''} to ${plan.sprints[plan.sprints.length - 1]?.date ?? ''}. Version ${plan.version}.`,
    '',
  ];
  for (const s of plan.sprints) {
    lines.push(`## ${s.name} (${s.date})`, '', s.goal, '');
    for (const it of s.items)
      lines.push(
        `- **${it.title}** (${it.label}, ${it.priority}): ${String(it.acceptance.length)} acceptance checks`,
      );
    lines.push('');
  }
  return lines.join('\n');
}

/** The documents that go to the portal, in the order they are listed there. */
export const PLAN_DOCS: { key: string; title: string; file: string[] }[] = [
  { key: 'description', title: 'Description', file: ['description', 'description.md'] },
  // [PCODE-457 | S15 | v0.1.0] Claude's questions and the answers, as the planning run read them
  {
    key: 'conversation',
    title: 'Planning conversation',
    file: ['description', 'conversation.md'],
  },
  { key: 'architecture', title: 'Architecture', file: ['architecture.md'] },
  { key: 'designSystem', title: 'Design system', file: ['design-system.md'] },
  { key: 'criticals', title: 'Criticals', file: ['criticals.md'] },
  { key: 'rules', title: 'Rules', file: ['rules.md'] },
  { key: 'plan', title: 'Sprint plan', file: ['plan.json'] },
];
export const PLAN_FOLDER = 'Project plan';

interface SyncState {
  folder?: string;
  pages: Record<string, { id: string; version: number }>;
}
interface DocNode {
  id: string;
  parentId: string | null;
  kind: string;
  title: string;
  version: number;
}
interface FullPage {
  page: DocNode;
  body: string;
}

export interface SyncReport {
  created: string[];
  updated: string[];
  /** changed in the portal since the last sync: not overwritten */
  kept: string[];
  folderId: string;
}

const stateFile = (root: string): string => projectFile(root, ['state', 'docs.json']);

/** A document's text for the portal: the file, or the plan as a page; null when it does not exist yet. */
function docBody(root: string, d: (typeof PLAN_DOCS)[number]): string | null {
  const file = projectFile(root, d.file);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  if (d.key !== 'plan') return text.trim() ? text : null;
  try {
    const plan = JSON.parse(text) as PlanJson;
    return Array.isArray(plan.sprints) && plan.sprints.length ? planMarkdown(plan) : null;
  } catch {
    return null;
  }
}

// ── [PCODE-456 | S15 | v0.1.0] syncPlanDocs: create what is new, update what only VS Code changed ──
export async function syncPlanDocs(t: PlanTarget, fetchImpl?: typeof fetch): Promise<SyncReport> {
  const a = api(t, fetchImpl);
  const base = ws(t);
  let state: SyncState = { pages: {} };
  try {
    state = JSON.parse(fs.readFileSync(stateFile(t.root), 'utf8')) as SyncState;
  } catch {
    /* first sync */
  }
  const tree = await a.call<DocNode[]>('GET', base + '/projects/' + t.projectId + '/docs');
  let folder = tree.find((n) => n.id === state.folder && n.kind === 'folder');
  folder ??= tree.find(
    (n) => n.kind === 'folder' && n.parentId === null && n.title === PLAN_FOLDER,
  );
  if (!folder)
    folder = (
      await a.call<FullPage>('POST', base + '/projects/' + t.projectId + '/docs', {
        title: PLAN_FOLDER,
        kind: 'folder',
      })
    ).page;
  const report: SyncReport = { created: [], updated: [], kept: [], folderId: folder.id };
  const pages: SyncState['pages'] = {};
  for (const d of PLAN_DOCS) {
    const body = docBody(t.root, d);
    const known = state.pages[d.key];
    const node =
      tree.find((n) => n.id === known?.id) ??
      tree.find((n) => n.parentId === folder.id && n.kind === 'page' && n.title === d.title);
    if (body === null) {
      if (known && node) pages[d.key] = known;
      continue;
    }
    if (!node) {
      const made = await a.call<FullPage>('POST', base + '/projects/' + t.projectId + '/docs', {
        title: d.title,
        parentId: folder.id,
        body,
      });
      pages[d.key] = { id: made.page.id, version: made.page.version };
      report.created.push(d.title);
      continue;
    }
    // someone worked on the page in the portal since VS Code last wrote it: theirs stays
    if (!known || known.id !== node.id || known.version !== node.version) {
      const now = await a.call<FullPage>('GET', base + '/docs/' + node.id);
      if (now.body.trim() !== body.trim()) {
        report.kept.push(d.title);
        if (known?.id === node.id) pages[d.key] = known;
        continue;
      }
      pages[d.key] = { id: node.id, version: now.page.version };
      continue;
    }
    const current = await a.call<FullPage>('GET', base + '/docs/' + node.id);
    if (current.body.trim() === body.trim()) {
      pages[d.key] = { id: node.id, version: current.page.version };
      continue;
    }
    const saved = await a.call<FullPage>('PUT', base + '/docs/' + node.id, {
      body,
      baseVersion: current.page.version,
    });
    pages[d.key] = { id: node.id, version: saved.page.version };
    report.updated.push(d.title);
  }
  // the description is the project's own description too (the portal shows it on the overview)
  const description = docBody(t.root, PLAN_DOCS[0] ?? { key: '', title: '', file: [] });
  if (description)
    await a.call('PATCH', base + '/projects/' + t.projectId, {
      description: description.slice(0, 10_000),
    });
  fs.mkdirSync(path.dirname(stateFile(t.root)), { recursive: true });
  fs.writeFileSync(
    stateFile(t.root),
    JSON.stringify({ folder: folder.id, pages } satisfies SyncState, null, 2) + '\n',
    'utf8',
  );
  return report;
}

/** One line for the log and a notification. */
export function syncLine(r: SyncReport): string {
  const parts: string[] = [];
  if (r.created.length) parts.push('added ' + r.created.join(', '));
  if (r.updated.length) parts.push('updated ' + r.updated.join(', '));
  if (r.kept.length)
    parts.push(r.kept.join(', ') + ' changed in the portal, left as they are there');
  return parts.length ? 'Project plan in Orqiva: ' + parts.join('; ') + '.' : '';
}
