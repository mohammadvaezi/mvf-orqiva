// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
// ── [PCODE-463 | S15 | v0.1.0] Finishing a task never dead-ends on missing fingerprints: Claude marks the code, or finish without marks ──
// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
// ── [PCODE-458 | S15 | v0.1.0] VS Code extension updates itself from GitHub: CI publishes the build, Update button installs it ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-78 | S08 | v0.1.0] Add the Orqiva Home tab: guided setup steps and a visual task board ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  host side of the Home tab. It invents no behaviour: every button is one of the commands that
//          already exist (setup, connect, new/link project, new task, start, done, plan), so the engine
//          stays the only writer (critical #2) and the Home tab cannot drift from the sidebar. It feeds
//          the webview a HomeData picture and redraws whenever the store, the key or the folder change.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  descriptionPath,
  PlanService,
  readPlanFiles,
  type PlanStatus,
} from '../../plan/planService';
import { startDevelopment, taskPrompt } from '../../commands/devCommands';
import { signedIn } from '../../server/account';
import { defaultInstalledOrq, syncDocs } from '../../plan/portal';
import { orqCommand, planTarget } from '../../server/planSync'; // [PCODE-462 | S15 | v0.1.0]
import {
  applyBinding,
  listClients,
  loadBinding,
  writeBindingFiles,
  type BindingChoice,
} from '../../server/binding'; // [PCODE-467 | S15 | v0.1.0]
import { planePath } from '../../state/files';
import {
  addAttachment,
  hashText,
  interviewState,
  planIsCurrent,
  readInterview,
} from '../../plan/interview';
import type { PlanningSession } from '../../plan/session';
import type { Services } from '../../services';
import type { WelcomeState } from '../../views/welcome';
import { isTrusted } from '../../util/trust';
import { redact } from '../../util/redact';
import { createPanel, type PanelHandle } from '../host';
import type { HomeAction, HomeToHost, HostToHome } from '../protocol';
import { homeModel, type HomeBinding, type HomeData } from './model';
import { descriptionBody, descriptionFile, wizardModel, type WizardData } from './wizard';

export interface HomeRunner {
  start(ref: string): Promise<void>;
  done(ref: string): Promise<void>;
}

export interface HomePanelDeps {
  context: vscode.ExtensionContext;
  services: Services;
  welcome: WelcomeState;
  runner: HomeRunner;
  hasRecent: () => boolean;
  /** [PCODE-457 | S15 | v0.1.0] the planning conversation of this window */
  planning?: PlanningSession;
}

// ── [PCODE-78 | S08 | v0.1.0] each Home button is exactly one existing command ──
// ── [PCODE-79 | S08 | v0.1.0] Add the New project wizard: describe the idea, draft, review and publish the plan visually ──
export const ACTION_COMMANDS: Record<HomeAction, string> = {
  openSetup: 'orqiva.openSetup',
  openFolder: 'workbench.action.files.openFolder',
  newProject: 'orqiva.newProject',
  linkProject: 'orqiva.linkProject',
  openRecent: 'orqiva.openRecentProject',
  newTask: 'orqiva.newTask',
  sync: 'orqiva.sync',
  planProject: 'orqiva.openPlanPanel',
  openDashboard: 'orqiva.openDashboard',
  trust: 'workbench.trust.manage',
  draftPlan: 'orqiva.draftPlan', // [PCODE-79 | S08 | v0.1.0]
  publishPlan: 'orqiva.publishPlan',
  signIn: 'orqiva.signIn', // [PCODE-453 | S15 | v0.1.0]
  openProjectOnline: 'orqiva.openProjectOnline', // [PCODE-454 | S15 | v0.1.0]
  checkForUpdates: 'orqiva.checkForUpdates', // [PCODE-458 | S15 | v0.1.0]
};

// ── [PCODE-79 | S08 | v0.1.0] the wizard from the files; the engine's check only when they changed ──
const planCache = new Map<string, PlanStatus>();
export async function wizardData(
  services: Services,
  planning?: PlanningSession,
  bound?: boolean, // [PCODE-467 | S15 | v0.1.0]
): Promise<WizardData | null> {
  const root = services.root();
  if (!root || !services.store.state.link) return null;
  const files = readPlanFiles(root);
  const key = JSON.stringify([root, files.description, files.plan, files.publishedAt]);
  let status = planCache.get(key);
  if (!status) {
    status = await new PlanService(services).status();
    planCache.clear();
    planCache.set(key, status);
  }
  return wizardModel({
    description: status.description,
    descriptionText: descriptionBody(files.description),
    plan: status.plan,
    planJson: services.store.state.plan,
    errors: status.check?.errors ?? [],
    checkError: status.checkError,
    published: status.publishedAt !== null,
    // [PCODE-457 | S15 | v0.1.0] on Orqiva, the conversation with Claude comes before the plan
    ...(services.store.state.link.server
      ? {
          conversation: conversationOf(root, files.description),
          running: planning?.state ?? null,
          ...(bound === undefined ? {} : { bound }),
        }
      : {}),
  });
}

// ── [PCODE-457 | S15 | v0.1.0] where the conversation stands, from its file ──
function conversationOf(
  root: string,
  description: string | null,
): NonNullable<Parameters<typeof wizardModel>[0]['conversation']> {
  const iv = readInterview(root);
  return {
    state: interviewState(iv, hashText(description ?? '')),
    entries: iv?.entries ?? [],
    planCurrent: planIsCurrent(iv),
  };
}

// [PCODE-454 | S15 | v0.1.0] the sign-in for the folder's server when there is one, else the latest
function accountFor(server: string | undefined): { server: string; email: string } | null {
  const a = signedIn(os.homedir(), server);
  return a ? { server: a.server, email: a.email } : null;
}

export async function homeData(deps: HomePanelDeps): Promise<HomeData> {
  const keys = await deps.welcome.refresh();
  const st = deps.services.store.state;
  const binding = await bindingFor(deps.services); // [PCODE-467 | S15 | v0.1.0]
  return homeModel({
    folderOpen: (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
    trusted: isTrusted(),
    engineFound: keys['orqiva.engineFound'],
    connected: keys['orqiva.connected'],
    // [PCODE-454 | S15 | v0.1.0] where the project lives, and who this computer is signed in as
    link: st.link
      ? {
          identifier: st.link.identifier,
          name: st.link.name,
          ...(st.link.server ? { server: st.link.server, projectId: st.link.project_id } : {}),
        }
      : null,
    account: accountFor(st.link?.server),
    sprints: st.sprints,
    activeRef: st.active?.task ?? null,
    online: st.online,
    hasRecent: deps.hasRecent(),
    wizard: await wizardData(
      deps.services,
      deps.planning,
      binding?.error ? undefined : binding?.ok,
    ),
    binding,
  });
}

// ── [PCODE-467 | S15 | v0.1.0] the binding of the folder's project, from the server, kept for a little while ──
let bindingCache: { key: string; at: number; value: HomeBinding } | null = null;
export function forgetBinding(): void {
  bindingCache = null;
}

async function bindingFor(services: Services): Promise<HomeBinding | null> {
  const root = services.root();
  if (!root || !services.store.state.link?.server) return null;
  const t = planTarget(root, os.homedir());
  if (!t) return null;
  const key = root + '|' + t.projectId;
  if (bindingCache?.key === key && Date.now() - bindingCache.at < 30_000) return bindingCache.value;
  let value: HomeBinding;
  try {
    const [b, clients] = await Promise.all([loadBinding(t), listClients(t).catch(() => [])]);
    const ok = Boolean(b.client) || b.internal;
    // a project linked in the portal plans here too
    if (ok) writeBindingFiles(root, b);
    value = {
      ok,
      client: b.client,
      internal: b.internal,
      requests: b.requests.map((r) => ({
        id: r.id,
        ref: r.ref,
        title: r.title,
        inProject: r.inProject,
        tasks: r.items.length,
      })),
      clients,
    };
  } catch (e) {
    value = {
      ok: true,
      client: null,
      internal: false,
      requests: [],
      clients: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
  bindingCache = { key, at: Date.now(), value };
  return value;
}

function findItem(services: Services, ref: string): { title: string; url?: string } | undefined {
  for (const s of services.store.state.sprints) {
    const it = s.items.find((i) => i.ref === ref);
    if (it) return it;
  }
  return undefined;
}

// ── [PCODE-78 | S08 | v0.1.0] Build with Claude: start the task if it is not the active one, then Claude ──
export async function buildWithClaude(deps: HomePanelDeps, ref: string): Promise<void> {
  const { services } = deps;
  if (services.store.state.active?.task !== ref) await deps.runner.start(ref);
  const title = findItem(services, ref)?.title ?? services.store.state.active?.title ?? ref;
  const root = services.root();
  // [PCODE-463 | S15 | v0.1.0] the exact fingerprint of the task, so orq done finds its code
  const a = services.store.state.active;
  const marker =
    a?.task === ref ? `[${a.task} | ${a.sprint} | v${a.version}] ${a.title}` : undefined;
  await startDevelopment({
    services,
    // [PCODE-462 | S15 | v0.1.0] with the orq this folder runs, so Claude can hand the task on itself
    prompt: {
      text: taskPrompt(ref, title, root ? orqCommand(root, defaultInstalledOrq()) : 'orq', marker),
      terminal: `Claude Code · ${ref}`,
    },
  });
}

export async function openHomePanel(
  deps: HomePanelDeps,
): Promise<PanelHandle<HomeToHost, HostToHome>> {
  const { context, services } = deps;
  const { handle, created } = createPanel<HomeToHost, HostToHome>(context, {
    id: 'home',
    title: 'Orqiva',
    entry: 'home',
    column: vscode.ViewColumn.One,
    log: (l) => {
      services.log.warn(l);
    },
  });
  const push = async (): Promise<void> => {
    try {
      await handle.post({ type: 'home/data', data: await homeData(deps) });
    } catch (e) {
      services.log.error('home data', e);
    }
  };
  if (!created) {
    await push();
    return handle;
  }
  handle.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');

  const busy = async (what: string, fn: () => Promise<void>): Promise<void> => {
    await handle.post({ type: 'home/busy', busy: true, what });
    try {
      await fn();
    } catch (e) {
      // the command already showed its own notification; the tab says it in place too
      await handle.post({
        type: 'home/error',
        message: redact(e instanceof Error ? e.message : String(e)),
      });
    } finally {
      await handle.post({ type: 'home/busy', busy: false });
      await push();
    }
  };

  // [PCODE-457 | S15 | v0.1.0] Claude works for minutes: its errors land on the wizard, not in a busy state
  const plan = (what: string, fn: (p: PlanningSession) => Promise<void>): void => {
    if (!deps.planning) return;
    void fn(deps.planning).catch((e: unknown) =>
      handle.post({
        type: 'home/error',
        message: redact(e instanceof Error ? e.message : String(e)),
      }),
    );
    services.log.info('planning: ' + what);
  };

  // [PCODE-467 | S15 | v0.1.0] the choice on the server and in the files Claude reads
  const bind = async (root: string, choice: BindingChoice, description: string): Promise<void> => {
    const t = planTarget(root, os.homedir());
    if (!t) throw new Error('Sign in to the Orqiva server of this folder first.');
    await applyBinding(t, choice, description);
    forgetBinding();
  };

  const subs: vscode.Disposable[] = [
    services.store.onDidChange(() => void push()),
    ...(deps.planning ? [deps.planning.onDidChange(() => void push())] : []),
    context.secrets.onDidChange(() => void push()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void push()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => void push()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('orqiva')) void services.location(true).then(push);
    }),
    handle.onMessage((m) => {
      if (m.type === 'home/ready') {
        void push();
        return;
      }
      // [PCODE-79 | S08 | v0.1.0] New project from the form: the same command, without its input boxes
      if (m.type === 'home/createProject') {
        void busy('createProject', async () => {
          await vscode.commands.executeCommand('orqiva.newProject', {
            name: m.name,
            identifier: m.identifier,
          });
        });
        return;
      }
      if (m.type === 'home/saveDescription') {
        void busy('saveDescription', async () => {
          const root = services.root();
          if (!root) throw new Error('Link this folder to a project first.');
          const file = descriptionPath(root);
          const before = fs.existsSync(file) ? await fs.promises.readFile(file, 'utf8') : null;
          await fs.promises.mkdir(path.dirname(file), { recursive: true });
          await fs.promises.writeFile(file, descriptionFile(m.text), 'utf8');
          // [PCODE-467 | S15 | v0.1.0] for whom: the client chosen with the description, and its requests
          if (m.binding) await bind(root, m.binding, m.text);
          // [PCODE-456 | S15 | v0.1.0] the description is in the portal at once
          void syncDocs(root, { log: services.log });
          // [PCODE-457 | S15 | v0.1.0] Claude reads it: the first time, or again when it changed
          if (services.store.state.link?.server)
            plan('the description was saved', (p) => p.descriptionChanged(before));
        });
        return;
      }
      // ── [PCODE-467 | S15 | v0.1.0] the client chosen for a project planned before: then Claude maps its tasks ──
      if (m.type === 'home/binding') {
        void busy('binding', async () => {
          const root = services.root();
          if (!root) throw new Error('Link this folder to a project first.');
          const file = descriptionPath(root);
          const text = fs.existsSync(file) ? await fs.promises.readFile(file, 'utf8') : '';
          await bind(root, m.binding, text);
          if (fs.existsSync(planePath(root, 'published')))
            plan('map the tasks to the requests', async (p) => {
              const r = await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: "Claude maps the tasks to the client's requests…",
                },
                () => p.mapTasks(),
              );
              forgetBinding();
              void vscode.window.showInformationMessage(
                `${String(r.mapped)} task(s) serve a client request; ${String(r.unrequested)} serve none (marked "not requested").`,
              );
            });
        });
        return;
      }
      // ── [PCODE-457 | S15 | v0.1.0] the conversation: next turn, answers, notes, plan again, files ──
      if (m.type === 'home/plan') {
        plan(m.op, (p) =>
          m.op === 'stop'
            ? Promise.resolve().then(() => {
                p.stop();
              })
            : m.op === 'write'
              ? p.writePlan()
              : m.op === 'skip'
                ? p.skipQuestions()
                : p.next(),
        );
        return;
      }
      if (m.type === 'home/answers') {
        plan('answers', (p) => p.answer(m.answers));
        return;
      }
      if (m.type === 'home/note') {
        plan('a note', (p) => p.addNote(m.text, m.files));
        return;
      }
      if (m.type === 'home/replan') {
        plan('plan it again', (p) => p.replan(m.wish));
        return;
      }
      if (m.type === 'home/attach') {
        void (async () => {
          const root = services.root();
          if (!root) return;
          const picked = await vscode.window.showOpenDialog({
            canSelectMany: true,
            openLabel: 'Attach',
            title: 'Files for Claude: documents, PDFs, pictures, spreadsheets as CSV, text',
          });
          if (!picked?.length) return;
          const files = picked.map((u) => addAttachment(root, u.fsPath));
          await handle.post({ type: 'home/attached', question: m.question, files });
        })().catch((e: unknown) =>
          handle.post({
            type: 'home/error',
            message: 'The file could not be attached: ' + redact(String(e)),
          }),
        );
        return;
      }
      if (m.type === 'home/go') {
        void vscode.commands.executeCommand(ACTION_COMMANDS[m.action]);
        return;
      }
      const { op, ref } = m;
      if (op === 'open') void vscode.commands.executeCommand('orqiva.openTask', ref);
      else if (op === 'plane') {
        const url = findItem(services, ref)?.url;
        if (url) void vscode.env.openExternal(vscode.Uri.parse(url));
      } else if (op === 'start') void busy(`start:${ref}`, () => deps.runner.start(ref));
      else if (op === 'done') void busy(`done:${ref}`, () => deps.runner.done(ref));
      else void busy(`build:${ref}`, () => buildWithClaude(deps, ref));
    }),
  ];
  handle.panel.onDidDispose(() => {
    subs.forEach((s) => {
      s.dispose();
    });
  });
  await push();
  return handle;
}
