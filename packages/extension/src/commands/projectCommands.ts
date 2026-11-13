// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-30 | S06 | v0.1.0] Add New project and Link project commands calling plane_init.py ──
// ── [PCODE-79 | S08 | v0.1.0] Add the New project wizard: describe the idea, draft, review and publish the plan visually ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the two ways a folder becomes a Plane project, both through the engine's plane_init.py so the
//          extension and the PlaneClaude window scaffold exactly the same .plane/. The engine runs with cwd =
//          the chosen workspace folder (there is no project root yet); afterwards the store is re-pointed at
//          that folder and the welcome view gives way to the board without a reload.
//          [PCODE-453 | S15 | v0.1.0] Signed in to an Orqiva server, both work on the server instead
//          (server/account.ts) and Plane is only the way for a computer that is not.
import { homedir, hostname } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { EngineCommands } from '../engine/commands';
import {
  createProject,
  linkFolder,
  listProjects,
  listWorkspaces,
  signIn,
  signedIn,
  type OrqivaAccount,
  type ServerProject,
} from '../server/account';
import type { Services } from '../services';
import { OrqivaError } from '../util/errors';
import { showError } from './notify';

export interface ProjectCommandDeps {
  services: Services;
  /** after a successful create/link: refresh welcome keys, reconnect the board … */
  afterLink?: () => Promise<void>;
  /** [PCODE-453 | S15 | v0.1.0] where ~/.orqiva lives; tests point it elsewhere */
  home?: () => string;
}

export const IDENTIFIER_RE = /^[A-Z]{2,5}$/;

// ── [PCODE-30 | S06 | v0.1.0] identifier helpers: pure, shared by the input box and the final guard ──
// ── [PCODE-80 | S08 | v0.1.0] Fix Home buttons staying disabled after creating a project ──
export function suggestIdentifier(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  return letters.length >= 2 ? letters.slice(0, 5) : '';
}

export function validateIdentifier(value: string): string | undefined {
  return IDENTIFIER_RE.test(value) ? undefined : 'Two to five capital letters, e.g. PCODE';
}

export function newProjectArgs(name: string, identifier: string): string[] {
  return ['--name', name, '--identifier', identifier];
}

export function linkProjectArgs(identifier: string): string[] {
  return ['--project', identifier];
}

export interface InitSummary {
  action: 'created' | 'linked' | 'unknown';
  name: string;
  identifier: string;
  states: string[];
  labels: string[];
  scaffolded: string[];
  board: string | null;
}

// ── [PCODE-30 | S06 | v0.1.0] parseInitSummary: the engine's lines -> one structured summary ──
export function parseInitSummary(stdout: string): InitSummary {
  const s: InitSummary = {
    action: 'unknown',
    name: '',
    identifier: '',
    states: [],
    labels: [],
    scaffolded: [],
    board: null,
  };
  const list = (rest: string): string[] =>
    rest
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^(Created|Linked) Plane project (.+) \(([A-Z0-9]+)\)$/.exec(line);
    if (head) {
      s.action = head[1] === 'Created' ? 'created' : 'linked';
      s.name = head[2] ?? '';
      s.identifier = head[3] ?? '';
      continue;
    }
    if (line.startsWith('States added: ')) s.states = list(line.slice('States added: '.length));
    else if (line.startsWith('Labels added: '))
      s.labels = list(line.slice('Labels added: '.length));
    else if (line.startsWith('Scaffolded: '))
      s.scaffolded = list(line.slice('Scaffolded: '.length));
    else if (line.startsWith('Board: ')) s.board = line.slice('Board: '.length).trim();
  }
  return s;
}

export function summaryMessage(s: InitSummary): string {
  const verb = s.action === 'created' ? 'Created' : s.action === 'linked' ? 'Linked' : 'Ready';
  const parts = [`${verb} ${s.identifier} ${s.name}`.trim()];
  if (s.states.length) parts.push(`${String(s.states.length)} states added`);
  if (s.labels.length) parts.push(`${String(s.labels.length)} labels added`);
  if (s.scaffolded.length) parts.push(`scaffolded ${s.scaffolded.join(', ')}`);
  return `${parts.join(' · ')}.`;
}

// ── [PCODE-30 | S06 | v0.1.0] pickFolder: one folder is taken, several are offered, none is a config error ──
export async function pickFolder(
  folders: readonly { name: string; fsPath: string }[],
  quickPick: <T extends vscode.QuickPickItem>(
    items: T[],
    options: vscode.QuickPickOptions,
  ) => Thenable<T | undefined> = (items, options) => vscode.window.showQuickPick(items, options),
): Promise<string | undefined> {
  if (folders.length === 0)
    throw new OrqivaError('Open a folder first. A project is one workspace folder.', 'config');
  const only = folders[0];
  if (folders.length === 1 && only) return only.fsPath;
  const pick = await quickPick(
    folders.map((f) => ({ label: f.name, description: f.fsPath })),
    { placeHolder: 'Which folder becomes the project?' },
  );
  return pick?.description;
}

function workspaceFolders(): { name: string; fsPath: string }[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    name: f.name,
    fsPath: f.uri.fsPath,
  }));
}

async function finish(deps: ProjectCommandDeps, folder: string, stdout: string): Promise<void> {
  const { services } = deps;
  const summary = parseInitSummary(stdout);
  services.relocate(folder);
  services.log.info(`project ${summary.action}: ${summary.identifier} at ${folder}`);
  await deps.afterLink?.();
  const OPEN = 'Open board';
  // [PCODE-80 | S08 | v0.1.0] shown, not awaited: a notification with a button settles only when the
  // user clicks or closes it, and the Home tab waits for this command to finish
  void vscode.window
    .showInformationMessage(summaryMessage(summary), ...(summary.board ? [OPEN] : []))
    .then((pick) => {
      if (pick === OPEN && summary.board)
        void vscode.env.openExternal(vscode.Uri.parse(summary.board));
    });
}

// ── [PCODE-453 | S15 | v0.1.0] the folder is on the Orqiva project now: re-read it, say so ──
async function finishOnServer(
  deps: ProjectCommandDeps,
  folder: string,
  verb: 'Created' | 'Linked',
  p: ServerProject,
): Promise<void> {
  const { services } = deps;
  services.relocate(folder);
  services.log.info(`project ${verb.toLowerCase()} on ${p.server}: ${p.projectKey} at ${folder}`);
  await deps.afterLink?.();
  const OPEN = 'Open in Orqiva';
  void vscode.window
    .showInformationMessage(`${verb} ${p.projectKey} ${p.projectName} (${p.workspaceName}).`, OPEN)
    .then((pick) => {
      if (pick === OPEN)
        void vscode.env.openExternal(vscode.Uri.parse(p.server + '/projects/' + p.projectId));
    });
}

async function pickWorkspace(
  account: OrqivaAccount,
): Promise<{ id: string; name: string } | undefined> {
  const all = (await listWorkspaces(account)).filter((w) => w.role !== 'guest');
  if (!all.length)
    throw new OrqivaError(
      `You cannot create projects on ${account.server}. Ask an admin to make you a member.`,
      'config',
    );
  const only = all[0];
  if (all.length === 1 && only) return only;
  const pick = await vscode.window.showQuickPick(
    all.map((w) => ({ label: w.name, description: w.role, id: w.id })),
    { placeHolder: 'Which workspace gets the new project?' },
  );
  return pick ? { id: pick.id, name: pick.label } : undefined;
}

// ── [PCODE-79 | S08 | v0.1.0] projectArg: { name, identifier } from the Home wizard, else nothing ──
export function projectArg(arg: unknown): { name: string; identifier: string } | undefined {
  if (typeof arg !== 'object' || arg === null) return undefined;
  const { name, identifier } = arg as { name?: unknown; identifier?: unknown };
  if (typeof name !== 'string' || typeof identifier !== 'string' || !name.trim()) return undefined;
  return { name: name.trim(), identifier: identifier.trim().toUpperCase() };
}

// ── [PCODE-30 | S06 | v0.1.0] the commands: New project (name + identifier) and Link project (quick pick) ──
export function createProjectCommands(
  deps: ProjectCommandDeps,
): Record<string, (...args: unknown[]) => Promise<void>> {
  const { services } = deps;
  const home = deps.home ?? homedir; // [PCODE-453 | S15 | v0.1.0]

  // [PCODE-79 | S08 | v0.1.0] the Home wizard passes name and identifier; the palette still asks
  const newProject = async (arg?: unknown): Promise<void> => {
    try {
      const given = projectArg(arg);
      const folder = await pickFolder(workspaceFolders());
      if (!folder) return;
      const account = signedIn(home()); // [PCODE-453 | S15 | v0.1.0]
      const title = account ? 'New Orqiva project' : 'New project';
      const name =
        given?.name ??
        (
          await vscode.window.showInputBox({
            title,
            prompt: 'Project name',
            value: path.basename(folder),
            validateInput: (v) => (v.trim() ? undefined : 'A name is needed'),
          })
        )?.trim();
      if (!name) return;
      const identifier = (
        given?.identifier ??
        (await vscode.window.showInputBox({
          title,
          prompt: 'Identifier - the prefix of every task (e.g. PCODE-12)',
          value: suggestIdentifier(name),
          validateInput: (v) => validateIdentifier(v.toUpperCase()),
        }))
      )
        ?.trim()
        .toUpperCase();
      if (!identifier) return;
      const invalid = validateIdentifier(identifier);
      if (invalid) throw new OrqivaError(`Identifier ${identifier}: ${invalid}`, 'user');
      // [PCODE-453 | S15 | v0.1.0] signed in to Orqiva: the project is made on the server, then linked
      if (account) {
        const workspace = await pickWorkspace(account);
        if (!workspace) return;
        const p = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Orqiva: creating ${identifier}`,
          },
          () => createProject(account, workspace, { key: identifier, name }),
        );
        linkFolder(folder, p);
        await finishOnServer(deps, folder, 'Created', p);
        return;
      }
      const engine = new EngineCommands(services.runAt(folder));
      const out = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Orqiva: creating ${identifier}`,
        },
        () => engine.initCreate(name, identifier),
      );
      await finish(deps, folder, out);
    } catch (e) {
      await showError('New project', e, services.log);
    }
  };

  const linkProject = async (): Promise<void> => {
    try {
      const folder = await pickFolder(workspaceFolders());
      if (!folder) return;
      // [PCODE-453 | S15 | v0.1.0] signed in to Orqiva: the projects on the server, as `orq link` sees them
      const account = signedIn(home());
      if (account) {
        const all = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Orqiva: reading projects' },
          () => listProjects(account),
        );
        if (!all.length)
          throw new OrqivaError(
            `No projects on ${account.server} that you can see yet. Create one there or use New project.`,
            'config',
          );
        // [PCODE-454 | S15 | v0.1.0] the project the folder is linked to now is marked, to change it
        const now = services.store.state.link;
        const chosen = await vscode.window.showQuickPick(
          all.map((p) => ({
            label: p.projectKey,
            description: p.projectName + (now?.project_id === p.projectId ? '  (linked now)' : ''),
            detail: p.workspaceName + ' on ' + p.server,
            project: p,
          })),
          { placeHolder: 'Which Orqiva project does this folder belong to?' },
        );
        if (!chosen) return;
        linkFolder(folder, chosen.project);
        await finishOnServer(deps, folder, 'Linked', chosen.project);
        return;
      }
      const engine = new EngineCommands(services.runAt(folder));
      const projects = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Orqiva: reading projects' },
        () => engine.initList(),
      );
      if (!projects.length)
        throw new OrqivaError('No projects in this workspace yet. Use New project.', 'config');
      const pick = await vscode.window.showQuickPick(
        [...projects]
          .sort((a, b) => a.identifier.localeCompare(b.identifier))
          .map((p) => ({ label: p.identifier, description: p.name })),
        { placeHolder: 'Which project does this folder belong to?' },
      );
      if (!pick) return;
      const out = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Orqiva: linking ${pick.label}`,
        },
        () => engine.initLink(pick.label),
      );
      await finish(deps, folder, out);
    } catch (e) {
      await showError('Link project', e, services.log);
    }
  };

  // ── [PCODE-453 | S15 | v0.1.0] Sign in: server, e-mail, password; the token orq login would keep ──
  const signInCommand = async (): Promise<void> => {
    try {
      const before = signedIn(home());
      const server = (
        await vscode.window.showInputBox({
          title: 'Sign in to Orqiva (1/3)',
          prompt: 'The address of your Orqiva server',
          value: before?.server ?? services.store.state.link?.server ?? 'http://',
          ignoreFocusOut: true,
          validateInput: (v) =>
            /^https?:\/\/[^\s/]+/.test(v.trim())
              ? undefined
              : 'An address such as http://server:8080',
        })
      )?.trim();
      if (!server) return;
      const email = (
        await vscode.window.showInputBox({
          title: 'Sign in to Orqiva (2/3)',
          prompt: 'Your e-mail address',
          value: before?.email ?? '',
          ignoreFocusOut: true,
          validateInput: (v) => (v.includes('@') ? undefined : 'Your e-mail address'),
        })
      )?.trim();
      if (!email) return;
      const password = await vscode.window.showInputBox({
        title: 'Sign in to Orqiva (3/3)',
        prompt: 'Your password. It is not stored; this computer keeps a personal token.',
        password: true,
        ignoreFocusOut: true,
      });
      if (!password) return;
      const me = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Orqiva: signing in' },
        () => signIn(home(), { server, email, password, hostname: hostname() }),
      );
      services.log.info(`signed in to ${me.server} as ${me.email}`);
      await deps.afterLink?.();
      void vscode.window.showInformationMessage(
        `Signed in to ${me.server} as ${me.name} <${me.email}>.`,
      );
    } catch (e) {
      await showError('Sign in', e, services.log);
    }
  };

  // ── [PCODE-454 | S15 | v0.1.0] VS Code extension: Home tab shows and changes project, server and account; planning works on the Orqiva server ──
  //    the linked project's page in the Orqiva web app
  const openProjectOnline = async (): Promise<void> => {
    const link = services.store.state.link;
    if (!link?.server) {
      void vscode.window.showInformationMessage('This folder is not linked to an Orqiva project.');
      return;
    }
    await vscode.env.openExternal(
      vscode.Uri.parse(link.server.replace(/\/+$/, '') + '/projects/' + link.project_id),
    );
  };

  return {
    'orqiva.openProjectOnline': openProjectOnline,
    'orqiva.newProject': newProject,
    'orqiva.linkProject': linkProject,
    'orqiva.signIn': signInCommand,
  };
}

export function registerProjectCommands(
  context: vscode.ExtensionContext,
  deps: ProjectCommandDeps,
): Record<string, (...args: unknown[]) => Promise<void>> {
  const cmds = createProjectCommands(deps);
  for (const [id, fn] of Object.entries(cmds))
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  return cmds;
}
