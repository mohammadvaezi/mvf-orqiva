// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
// ── [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move ──
// ── [PCODE-454 | S15 | v0.1.0] VS Code extension: Home tab shows and changes project, server and account; planning works on the Orqiva server ──
//    Why:  a folder linked to an Orqiva server has no Python engine, so the plan is drafted, checked and
//          published by the extension itself: the planning prompt ships with it, the check applies the
//          engine's rules to plan.json, and Publish makes the sprints and tasks on the server through the
//          same API as `orq`. A second Publish adds only what is new: sprints and tasks are matched by name
//          and title. Free of vscode, so it is tested against a fake server.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeApi } from '../../../cli/src/loop/api';
import { linkPlanRequests } from '../server/binding';
import type { CheckResult } from '../engine/parse';
import { planePath } from '../state/files';
import type { PlanJson } from '../state/types';
import type { PublishResult } from './publish';

const PRIORITIES = new Set(['urgent', 'high', 'medium', 'low', 'none']);
const LABELS = new Set(['feature', 'bug', 'chore', 'test', 'hotfix']);
const LABEL_COLOURS: Record<string, string> = {
  feature: '#3b82f6',
  bug: '#ef4444',
  chore: '#6b7280',
  test: '#10b981',
  hotfix: '#f97316',
};

interface LooseItem {
  title?: unknown;
  description_md?: unknown;
  acceptance?: unknown;
  priority?: unknown;
  label?: unknown;
  requests?: unknown;
}
interface LooseSprint {
  name?: unknown;
  date?: unknown;
  items?: LooseItem[];
}

const isDay = (d: unknown): d is string =>
  typeof d === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  !Number.isNaN(new Date(d + 'T00:00:00Z').getTime());

// ── [PCODE-454 | S15 | v0.1.0] validatePlan: the engine's rules, in the engine's "sprint N item M: …" words ──
// [PCODE-467 | S15 | v0.1.0] ...and the client requests a task names must be the project's (requestRefs)
export function validatePlan(plan: unknown, today: string, requestRefs?: string[]): string[] {
  const known = requestRefs ? new Set(requestRefs.map((r) => r.toUpperCase())) : null;
  const sprints = (plan as { sprints?: unknown } | null)?.sprints;
  if (!Array.isArray(sprints) || sprints.length === 0)
    return ["plan.json needs a non-empty 'sprints' list"];
  const errs: string[] = [];
  const titles = new Set<string>();
  const dates = new Set<string>();
  (sprints as LooseSprint[]).forEach((s, si) => {
    const where = 'sprint ' + String(si + 1);
    if (!s.name) errs.push(where + ': missing name');
    let d = typeof s.date === 'string' ? s.date : '';
    if (!isDay(s.date)) {
      errs.push(`${where}: date '${d}' is not YYYY-MM-DD`);
      d = '';
    }
    if (d && d < today) errs.push(`${where}: date ${d} is in the past`);
    if (d && dates.has(d)) errs.push(`${where}: two sprints on ${d}`);
    if (d) dates.add(d);
    const items = Array.isArray(s.items) ? s.items : [];
    if (!items.length) errs.push(where + ': no items');
    items.forEach((it, ii) => {
      const w = `${where} item ${String(ii + 1)}`;
      const t = typeof it.title === 'string' ? it.title.trim() : '';
      if (!t) errs.push(w + ': missing title');
      else if (titles.has(t.toLowerCase())) errs.push(`${w}: duplicate title '${t}'`);
      titles.add(t.toLowerCase());
      const desc = typeof it.description_md === 'string' ? it.description_md.trim() : '';
      if (desc.length < 40) errs.push(w + ': description too short');
      if (!Array.isArray(it.acceptance) || !it.acceptance.length)
        errs.push(w + ': no acceptance checks');
      if (!PRIORITIES.has(typeof it.priority === 'string' ? it.priority : 'medium'))
        errs.push(w + ': bad priority');
      if (!LABELS.has(typeof it.label === 'string' ? it.label : 'feature'))
        errs.push(w + ': bad label');
      if (known && it.requests !== undefined) {
        if (!Array.isArray(it.requests)) errs.push(w + ': requests is not a list');
        else
          for (const r of it.requests as unknown[])
            if (typeof r !== 'string' || !known.has(r.toUpperCase()))
              errs.push(`${w}: request '${String(r)}' is not one of the project's client requests`);
      }
    });
  });
  return errs;
}

// ── [PCODE-454 | S15 | v0.1.0] checkPlan: what `plane_plan.py check` reports, for a plan.json text ──
export function checkPlan(
  text: string,
  publishedAt: string | null,
  today: string,
  requestRefs?: string[], // [PCODE-467 | S15 | v0.1.0]
): CheckResult {
  let plan: unknown = null;
  try {
    plan = JSON.parse(text);
  } catch {
    /* reported below as the missing sprints list */
  }
  const errors = validatePlan(plan, today, requestRefs);
  const sprints = Array.isArray((plan as PlanJson | null)?.sprints)
    ? (plan as PlanJson).sprints
    : [];
  return {
    sprints: sprints.length,
    items: sprints.reduce((n, s) => n + (Array.isArray(s.items) ? s.items.length : 0), 0),
    from: sprints[0]?.date ?? '',
    to: sprints[sprints.length - 1]?.date ?? '',
    version: (plan as PlanJson | null)?.version ?? '0.1.0',
    publishedAt,
    errors,
  };
}

/** The text of a task: what and why, the acceptance checks as a list, and the files to look at. */
export function taskDescription(it: PlanJson['sprints'][number]['items'][number]): string {
  let body =
    it.description_md.trimEnd() +
    '\n\n### Acceptance\n' +
    it.acceptance.map((a) => '- [ ] ' + a).join('\n');
  if (it.files_hint?.length)
    body += '\n\n### Files (hint)\n' + it.files_hint.map((f) => '- `' + f + '`').join('\n');
  return body;
}

export interface OrqivaTarget {
  server: string;
  token: string;
  workspaceId: string;
  projectId: string;
}

interface Named {
  id: string;
  name: string;
}

// ── [PCODE-454 | S15 | v0.1.0] publishToServer: sprints by name, tasks by title; only what is new is made ──
export async function publishToServer(
  t: OrqivaTarget,
  plan: PlanJson,
  fetchImpl?: typeof fetch,
): Promise<PublishResult & { ids: Record<string, string> }> {
  const api = makeApi(t.server, t.token, fetchImpl);
  const base = `/api/workspaces/${t.workspaceId}/projects/${t.projectId}`;
  const sprints = new Map(
    (await api.call<Named[]>('GET', base + '/sprints')).map((s) => [s.name.toLowerCase(), s]),
  );
  const existing = new Set(
    (await api.call<{ title: string }[]>('GET', base + '/items')).map((i) =>
      i.title.trim().toLowerCase(),
    ),
  );
  const labels = new Map(
    (await api.call<Named[]>('GET', base + '/labels')).map((l) => [l.name.toLowerCase(), l.id]),
  );
  const labelId = async (name: string): Promise<string> => {
    const known = labels.get(name);
    if (known) return known;
    const made = await api.call<Named>('POST', base + '/labels', {
      name,
      color: LABEL_COLOURS[name] ?? '#6b7280',
    });
    labels.set(name, made.id);
    return made.id;
  };
  const r: PublishResult & { ids: Record<string, string> } = {
    sprints: 0,
    items: 0,
    board: t.server.replace(/\/+$/, '') + '/projects/' + t.projectId,
    perSprint: [],
    raw: '',
    ids: {},
  };
  for (const s of plan.sprints) {
    let sprint = sprints.get(s.name.toLowerCase());
    if (!sprint) {
      sprint = await api.call<Named>('POST', base + '/sprints', {
        name: s.name.slice(0, 120),
        goal: ((s as Partial<typeof s>).goal ?? '').slice(0, 2000),
        startDate: s.date,
        endDate: s.date,
      });
      sprints.set(s.name.toLowerCase(), sprint);
      r.sprints++;
    }
    let made = 0;
    for (const it of s.items) {
      const key = it.title.trim().toLowerCase();
      if (existing.has(key)) continue;
      // plan.json may leave label and priority out; the check reads them as feature and medium
      const loose = it as Partial<typeof it>;
      const label = (loose.label ?? 'feature').toLowerCase();
      const item = await api.call<{ id: string }>('POST', base + '/items', {
        title: it.title.trim().slice(0, 255),
        description: taskDescription(it),
        priority: loose.priority ?? 'medium',
        kind: label === 'bug' || label === 'hotfix' ? 'bug' : 'task',
        sprintId: sprint.id,
        labelIds: [await labelId(label)],
      });
      existing.add(key);
      r.ids[it.title] = item.id;
      made++;
    }
    r.items += made;
    r.perSprint.push({ name: s.name, items: made });
  }
  r.raw = r.perSprint.map((p) => `${p.name}: ${String(p.items)} new item(s)`).join('\n');
  // [PCODE-462 | S15 | v0.1.0] in plan order and ready; a server without the routes still gets the tasks
  try {
    await ensurePlanOrder(t, plan, fetchImpl);
  } catch (e) {
    r.raw +=
      '\nThe order of the tasks could not be set: ' + (e instanceof Error ? e.message : String(e));
  }
  // [PCODE-467 | S15 | v0.1.0] every task linked to the client requests it serves
  try {
    const linked = await linkPlanRequests(t, plan, fetchImpl);
    if (linked.unknown.length)
      r.raw += '\nNot client requests of this project: ' + [...new Set(linked.unknown)].join(', ');
  } catch (e) {
    r.raw +=
      '\nThe tasks could not be linked to the client requests: ' +
      (e instanceof Error ? e.message : String(e));
  }
  return r;
}

// ── [PCODE-462 | S15 | v0.1.0] ensurePlanOrder: the plan's order on the server, and its tasks ready to start ──
//    Each task waits for the one before it in the plan (finish to start), so they are built in that order;
//    a task that never started is in To do (not Backlog) and ready, because the plan gave it a
//    description and acceptance checks. Runs after every publish, and once for a plan published before;
//    it only adds what is missing and never moves a task that has started.
export async function ensurePlanOrder(
  t: OrqivaTarget,
  plan: PlanJson,
  fetchImpl?: typeof fetch,
): Promise<{ links: number; ready: number }> {
  const api = makeApi(t.server, t.token, fetchImpl);
  const ws = `/api/workspaces/${t.workspaceId}`;
  const base = ws + `/projects/${t.projectId}`;
  const [project, items, planned] = await Promise.all([
    api.call<{ states: { id: string; name: string; group: string }[] }>('GET', base),
    api.call<{ id: string; title: string; stateId: string; ready?: boolean }[]>(
      'GET',
      base + '/items',
    ),
    api.call<{ dependencies: { predecessorId: string; successorId: string }[] }>(
      'GET',
      base + '/plan',
    ),
  ]);
  const todo =
    project.states.find((x) => x.name.toLowerCase() === 'todo') ??
    project.states.find((x) => x.group === 'unstarted');
  const backlog = new Set(project.states.filter((x) => x.group === 'backlog').map((x) => x.id));
  const byTitle = new Map(items.map((i) => [i.title.trim().toLowerCase(), i]));
  const order = plan.sprints
    .flatMap((sp) => sp.items)
    .map((it) => byTitle.get(it.title.trim().toLowerCase()))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const linked = new Set(planned.dependencies.map((d) => d.predecessorId + '>' + d.successorId));
  const waits = new Set(planned.dependencies.map((d) => d.successorId));
  const r = { links: 0, ready: 0 };
  for (const [n, it] of order.entries()) {
    const before = order[n - 1];
    // a task someone linked by hand keeps its own order
    if (before && !waits.has(it.id) && !linked.has(before.id + '>' + it.id)) {
      await api.call('POST', base + '/dependencies', {
        predecessorId: before.id,
        successorId: it.id,
      });
      r.links++;
    }
    const patch: Record<string, unknown> = {};
    if (todo && backlog.has(it.stateId)) patch['stateId'] = todo.id;
    if (it.ready !== true) patch['ready'] = true;
    if (Object.keys(patch).length) {
      await api.call('PATCH', ws + '/items/' + it.id, patch);
      r.ready++;
    }
  }
  return r;
}

/** Notes the publish where the plan panel and the wizard look for it: state/published.json in the project's folder. */
export function recordPublished(root: string, ids: Record<string, string>, at: Date): string {
  const file = planePath(root, 'published');
  let items: Record<string, string> = {};
  try {
    items =
      (JSON.parse(fs.readFileSync(file, 'utf8')) as { items?: Record<string, string> }).items ?? {};
  } catch {
    /* first publish */
  }
  const stamp = at.toISOString().slice(0, 19);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ at: stamp, items: { ...items, ...ids } }, null, 2) + '\n',
    'utf8',
  );
  return stamp;
}

// ── [PCODE-454 | S15 | v0.1.0] the planning prompt for a folder on Orqiva (the engine's, without the engine) ──
export const ORQIVA_PLAN_PROMPT = `You are the planning engine of an AI-run software project. Project: **{name}** (Orqiva key \`{identifier}\`).
Today is {today}. The project root is the current folder; the planning inputs are in \`.orqiva/description/\`.

Do this, in order, and write files - do not create tasks anywhere yourself (a separate step publishes):

1. Read every file in \`.orqiva/description/\`: the description, the planning conversation
   (\`conversation.md\`: your questions and the user's answers, which are requirements too) and the
   attachments it names. Where something is still open, decide and write the assumption into architecture.md.
2. Write \`.orqiva/architecture.md\`: purpose, stack, app structure (folders, modules, entry points), data
   model, integrations, config/secrets, testing strategy. Concrete, not generic: name the folders and
   files the first sprint will create.
3. Write \`.orqiva/design-system.md\`: tokens, components, copy rules; or state that the project has no UI.
4. Write \`.orqiva/criticals.md\`: the must-never-break list as a table (critical, why, guarded by).
5. Write \`.orqiva/rules.md\`: the coding conventions for this stack (naming, formatting, test command,
   branch policy, dependency policy). If the file exists, keep what is there and add to it.
6. Write \`.orqiva/plan.json\`: one-day sprints, working days only, starting {start_date}. Schema:

\`\`\`json
{{
  "version": "0.1.0",
  "sprints": [
    {{
      "name": "Sprint 01 - <theme>",
      "date": "YYYY-MM-DD",
      "goal": "<one sentence: what is demonstrably true at the end of the day>",
      "items": [
        {{
          "title": "<verb + object, max 80 chars>",
          "label": "feature|bug|chore|test",
          "priority": "urgent|high|medium|low",
          "description_md": "<what and why, 3-10 lines, references architecture.md sections>",
          "acceptance": ["<observable check>", "..."],
          "files_hint": ["<path the work will likely touch>"],
          "requests": ["<the refs of the client requests this task serves, from requests.md>"]
        }}
      ]
    }}
  ]
}}
\`\`\`

Planning rules:
- Sprint 01 is always foundation: repo layout, toolchain, test runner, CI, the smallest runnable app.
- Each sprint has 3-7 items that one developer (Claude) can finish in a day; each item has at least two
  acceptance checks and a description of at least 40 characters; titles are unique across the plan.
- Order by dependency, then by value. Put the criticals' guards into the sprint that introduces the risk.
- Cover the "must have" list completely; put "nice to have" items after it, clearly labelled in the goal.
- The last planned sprint is "Release readiness": docs, install, smoke test, handover.
- Every task names the client requests it serves (\`requests\`, the refs in \`.orqiva/description/requests.md\`).
  Work no request asks for - foundation, tooling, CI - gets [] and its description says why it is needed.
  Plan nothing the client did not ask for beyond that.

When the files are written, print a short summary (sprints, item count, open questions) and stop. The user
will review the plan in VS Code and press "Publish" to send it to Orqiva.
`;
