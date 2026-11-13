// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
// ── [PCODE-454 | S15 | v0.1.0] VS Code extension: Home tab shows and changes project, server and account; planning works on the Orqiva server ──
// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-34 | S06 | v0.1.0] Publish the plan with confirmation, single-flight guard and result summary ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  publishing writes the sprints and tasks: to the Orqiva server for a folder linked there, through
//          the legacy engine otherwise. It runs the check first (a plan with errors is never sent), asks
//          once with the counts, and a second click while a publish is running joins the running one
//          instead of starting another (criticals #6).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { detectServer } from '../server/connection';
import type { Services } from '../services';
import { planePath, projectFile } from '../state/files';
import type { PlanJson } from '../state/types';
import { OrqivaError } from '../util/errors';
import { ensurePlanOrder, publishToServer, recordPublished } from './orqivaPlan';
import { syncDocs } from './portal';
import { PlanService, type PlanStatus } from './planService';

export interface PublishResult {
  sprints: number;
  items: number;
  board: string | null;
  perSprint: { name: string; items: number }[];
  raw: string;
}

// ── [PCODE-34 | S06 | v0.1.0] parsePublishOutput: per-sprint lines + "Published: N sprint(s), M item(s) created. Board: url" ──
export function parsePublishOutput(stdout: string): PublishResult {
  const r: PublishResult = { sprints: 0, items: 0, board: null, perSprint: [], raw: stdout.trim() };
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    const done = /^Published: (\d+) sprint\(s\), (\d+) item\(s\) created\.(?: Board: (\S+))?/.exec(
      line,
    );
    if (done) {
      r.sprints = Number(done[1]);
      r.items = Number(done[2]);
      r.board = done[3] ?? null;
      continue;
    }
    const per = /^(.+?): (\d+) new item\(s\)$/.exec(line);
    if (per) r.perSprint.push({ name: per[1] ?? '', items: Number(per[2]) });
  }
  return r;
}

export function confirmMessage(status: PlanStatus): string {
  const c = status.check;
  return `Publish ${String(c?.sprints ?? 0)} sprints and ${String(c?.items ?? 0)} items? Existing items are kept; nothing is deleted.`;
}

export function resultMessage(r: PublishResult): string {
  return `Published: ${String(r.sprints)} sprints, ${String(r.items)} items created.`;
}

export interface PublishDeps {
  services: Pick<Services, 'engine' | 'root' | 'log' | 'store' | 'refreshBoard'>;
  planService?: PlanService;
  /** modal confirmation; injected for tests */
  confirm?: (message: string) => Promise<boolean>;
  /** progress wrapper; injected for tests */
  progress?: <T>(title: string, fn: () => Promise<T>) => Promise<T>;
  /** [PCODE-454 | S15 | v0.1.0] where the Orqiva sign-in is kept, and the server calls; injected for tests */
  home?: () => string;
  fetchImpl?: typeof fetch;
}

// ── [PCODE-454 | S15 | v0.1.0] onServer: a folder on Orqiva publishes to its server, not through the engine ──
async function onServer(deps: PublishDeps, root: string): Promise<PublishResult> {
  const target = detectServer(root, (deps.home ?? os.homedir)());
  if (!target)
    throw new OrqivaError(
      'Not signed in to the Orqiva server of this folder. Sign in on the Orqiva tab first.',
      'config',
    );
  const plan = JSON.parse(fs.readFileSync(planePath(root, 'plan'), 'utf8')) as PlanJson;
  const r = await publishToServer(
    {
      server: target.link.server,
      token: target.token,
      workspaceId: target.link.workspaceId,
      projectId: target.link.projectId,
    },
    plan,
    deps.fetchImpl,
  );
  recordPublished(target.root, r.ids, new Date());
  // [PCODE-456 | S15 | v0.1.0] the published plan is in the portal's Documents too
  await syncDocs(target.root, {
    log: deps.services.log,
    ...(deps.home ? { home: deps.home } : {}),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  return r;
}

let inFlight: Promise<PublishResult> | null = null;

/** tests only */
export function _resetPublishForTests(): void {
  inFlight = null;
}

export function isPublishing(): boolean {
  return inFlight !== null;
}

const defaultConfirm = async (message: string): Promise<boolean> =>
  (await vscode.window.showWarningMessage(message, { modal: true }, 'Publish')) === 'Publish';

const defaultProgress = <T>(title: string, fn: () => Promise<T>): Promise<T> =>
  Promise.resolve(
    vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, fn),
  );

// ── [PCODE-34 | S06 | v0.1.0] publishPlan: check -> confirm -> single-flight engine run -> refresh; undefined = cancelled ──
export async function publishPlan(deps: PublishDeps): Promise<PublishResult | undefined> {
  if (inFlight) return inFlight; // join the running publish; the progress notification is already up
  const { services } = deps;
  const plan = deps.planService ?? new PlanService(services);
  const status = await plan.status();
  if (status.plan !== 'valid') {
    const n = status.check?.errors.length ?? 0;
    throw new OrqivaError(
      status.plan === 'missing'
        ? 'No plan.json to publish. Draft the plan first.'
        : n
          ? `Plan has ${String(n)} error(s). Fix them in the plan panel before publishing.`
          : `plan.json is not valid. ${status.checkError ?? ''}`.trim(),
      'user',
    );
  }
  if (!(await (deps.confirm ?? defaultConfirm)(confirmMessage(status)))) return undefined;
  const run = (deps.progress ?? defaultProgress)('Orqiva: publishing the plan', async () => {
    const root0 = services.root();
    const r =
      root0 && services.store.state.link?.server
        ? await onServer(deps, root0)
        : parsePublishOutput(await services.engine.planPublish());
    services.log.info(`plan published: ${String(r.sprints)} sprint(s), ${String(r.items)} item(s)`);
    const root = services.root();
    if (root) services.store.load(root); // published.json + project.json version; the watcher would too, later
    await services.refreshBoard?.();
    return r;
  });
  inFlight = run;
  try {
    return await run;
  } finally {
    inFlight = null;
  }
}

// ── [PCODE-462 | S15 | v0.1.0] orderOnce: a plan published before the order existed gets it, once ──
//    Writes state/order.json when done, so it runs one time per folder; publishing sets the order itself.
export async function orderOnce(
  root: string,
  log: { info: (m: string) => void; warn: (m: string) => void },
  home: string = os.homedir(),
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  const flag = projectFile(root, ['state', 'order.json']);
  if (fs.existsSync(flag) || !fs.existsSync(planePath(root, 'published'))) return false;
  const target = detectServer(root, home);
  if (!target || !fs.existsSync(planePath(root, 'plan'))) return false;
  try {
    const plan = JSON.parse(fs.readFileSync(planePath(root, 'plan'), 'utf8')) as PlanJson;
    const r = await ensurePlanOrder(
      {
        server: target.link.server,
        token: target.token,
        workspaceId: target.link.workspaceId,
        projectId: target.link.projectId,
      },
      plan,
      fetchImpl,
    );
    fs.mkdirSync(path.dirname(flag), { recursive: true });
    fs.writeFileSync(flag, JSON.stringify({ at: new Date().toISOString(), ...r }, null, 2) + '\n');
    log.info(
      `the plan's tasks are in order now: ${String(r.links)} link(s), ${String(r.ready)} task(s) made ready`,
    );
    return true;
  } catch (e) {
    log.warn(
      'the order of the tasks could not be set: ' + (e instanceof Error ? e.message : String(e)),
    );
    return false;
  }
}
