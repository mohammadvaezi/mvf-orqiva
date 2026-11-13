// ── [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move ──
// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-32 | S06 | v0.1.0] Run Draft plan in the integrated terminal with the planning prompt ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the engine's `draft` opens a cmd.exe console; inside VS Code the planning session belongs in the
//          integrated terminal. The prompt is built exactly like plane_plan.cmd_draft (same template, same
//          placeholders, same next-workday start date) and goes through a file, so the command line is short,
//          shell-neutral (Git Bash, PowerShell, zsh) and carries no secret.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Services } from '../services';
import { OrqivaError } from '../util/errors';
import {
  commandLine,
  currentShell,
  openOrReuse,
  vscodeTerminalHost,
  type ShellKind,
  type TerminalHost,
  type TerminalLike,
} from '../util/terminal';
import { isTrusted, TRUST_MESSAGE } from '../util/trust';
import { ORQIVA_PLAN_PROMPT } from './orqivaPlan';
import { endPlanningRun, startPlanningRun, type PortalDeps } from './portal';
import { projectDir, projectFile, projectRel } from '../state/files';
import { DESCRIPTION_REL, descriptionStatus, descriptionPath } from './planService';

export const PLANNING_TERMINAL = 'Claude Code (planning)';
/** in the project's folder (.orqiva, or .plane on a legacy folder) */
export const PROMPT_FILE = ['state', 'plan_prompt.txt'] as const;
export const ALLOWED_TOOLS =
  'Read,Write,Edit,Glob,Grep,Bash(git *),Bash(ls *),Bash(dir *),Bash(cat *)';
export const draftTask = (dir = '.plane'): string =>
  `Plan this project: read ${dir}/description/ and write the planning files as instructed. Ask me if anything is unclear.`;
export const DRAFT_TASK = draftTask();

// ── [PCODE-32 | S06 | v0.1.0] dates: the plan starts on the next working day after today (plane_plan.next_workday) ──
export function nextWorkday(d: Date): Date {
  const x = new Date(d.getTime());
  while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1);
  return x;
}

export function isoDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function startDateFor(today: Date): string {
  const tomorrow = new Date(today.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  return isoDate(nextWorkday(tomorrow));
}

// ── [PCODE-32 | S06 | v0.1.0] fillTemplate: Python str.format semantics for {name} and the {{ }} escapes ──
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{|\}\}|\{([a-z_]+)\}/g, (m, name: string | undefined) => {
    if (m === '{{') return '{';
    if (m === '}}') return '}';
    const v = name === undefined ? undefined : vars[name];
    if (v === undefined)
      throw new OrqivaError(`Planning prompt: unknown placeholder {${name ?? ''}}`, 'config');
    return v;
  });
}

export interface DraftInputs {
  name: string;
  identifier: string;
  template: string;
  today: Date;
}

export function buildPrompt(i: DraftInputs): { prompt: string; startDate: string; today: string } {
  const today = isoDate(i.today);
  const startDate = startDateFor(i.today);
  return {
    prompt: fillTemplate(i.template, {
      name: i.name,
      identifier: i.identifier,
      today,
      start_date: startDate,
    }),
    startDate,
    today,
  };
}

// ── [PCODE-32 | S06 | v0.1.0] draftCommandLine: one line for any shell; the prompt is a file, the task is quoted ──
// ── [PCODE-61 | S12 | v0.1.0] ...and quoted the way *that* shell reads it, so Git Bash and pwsh agree ──
export function draftCommandLine(
  claude: string,
  promptFileRel: string,
  shell: ShellKind = 'posix',
  task: string = DRAFT_TASK,
): string {
  return commandLine(
    claude,
    [
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      ALLOWED_TOOLS,
      '--append-system-prompt-file',
      promptFileRel,
      task,
    ],
    shell,
  );
}

export interface DraftDeps {
  services: Services;
  host?: TerminalHost;
  claudeCommand?: () => string;
  /** injected for tests; otherwise the shell of this window's terminal */
  shell?: ShellKind;
  now?: () => Date;
  /** resolves when the terminal closes; injected for tests */
  waitForClose?: (t: TerminalLike) => Promise<void>;
  /** injected for tests: the template text instead of reading templates/plan_prompt.md from the engine folder */
  template?: string;
  /** [PCODE-456 | S15 | v0.1.0] the portal: the live run and the documents; injected for tests */
  portal?: Omit<PortalDeps, 'log'>;
}

export interface DraftResult {
  terminal: TerminalLike;
  created: boolean;
  promptFile: string;
  startDate: string;
  /** settles when the planning terminal is closed */
  closed: Promise<void>;
}

function waitForTerminalClose(t: TerminalLike): Promise<void> {
  return new Promise((resolve) => {
    const sub = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === (t as unknown) || closed.name === t.name) {
        sub.dispose();
        resolve();
      }
    });
  });
}

// ── [PCODE-32 | S06 | v0.1.0] draftPlan: refuse without a written description, write the prompt, open the terminal ──
export async function draftPlan(deps: DraftDeps): Promise<DraftResult> {
  const { services } = deps;
  const root = services.root();
  const link = services.store.state.link;
  if (!root || !link)
    throw new OrqivaError('Link this folder to an Orqiva project first.', 'config');
  if (!isTrusted()) throw new OrqivaError(TRUST_MESSAGE, 'config');
  const descFile = descriptionPath(root);
  const desc = fs.existsSync(descFile) ? fs.readFileSync(descFile, 'utf8') : null;
  if (descriptionStatus(desc) !== 'written')
    throw new OrqivaError(
      `Write the description first (${projectRel(root, DESCRIPTION_REL)}).`,
      'user',
    );
  // [PCODE-454 | S15 | v0.1.0] a folder on Orqiva plans with the prompt that ships with the extension
  const onOrqiva = Boolean(link.server);
  let template = deps.template ?? (onOrqiva ? ORQIVA_PLAN_PROMPT : undefined);
  if (template === undefined) {
    const loc = await services.location();
    const file = path.join(loc.home, 'templates', 'plan_prompt.md');
    if (!loc.home || !fs.existsSync(file))
      throw new OrqivaError(
        'Engine folder has no templates/plan_prompt.md. Fix orqiva.engineHome.',
        'config',
      );
    template = fs.readFileSync(file, 'utf8');
  }
  const built = buildPrompt({
    name: link.name,
    identifier: link.identifier,
    template,
    today: (deps.now ?? (() => new Date()))(),
  });
  const promptFile = projectFile(root, PROMPT_FILE);
  fs.mkdirSync(path.dirname(promptFile), { recursive: true });
  fs.writeFileSync(promptFile, built.prompt, 'utf8');

  const env: NodeJS.ProcessEnv = onOrqiva ? {} : await services.secrets.envForEngine();
  if (!onOrqiva) {
    const loc = await services.location();
    if (loc.home) env['PLANE_CLAUDE_HOME'] = loc.home;
  }
  const host = deps.host ?? vscodeTerminalHost;
  const claude = (
    deps.claudeCommand ??
    (() => vscode.workspace.getConfiguration('orqiva').get<string>('claudeCommand', 'claude'))
  )();
  // [PCODE-456 | S15 | v0.1.0] on Orqiva the run is live in the portal before Claude starts
  const portalDeps: PortalDeps = { log: services.log, ...deps.portal };
  const live =
    onOrqiva &&
    !host.terminals.some((x) => x.name === PLANNING_TERMINAL && x.exitStatus === undefined)
      ? await startPlanningRun(root, portalDeps)
      : null;
  const { terminal, created } = openOrReuse(host, { name: PLANNING_TERMINAL, cwd: root, env });
  terminal.show(false);
  // [PCODE-61 | S12 | v0.1.0] the line is written for the shell this window actually runs
  if (created)
    terminal.sendText(
      draftCommandLine(
        claude,
        projectRel(root, PROMPT_FILE),
        deps.shell ?? currentShell(),
        draftTask(projectDir(root)),
      ),
      true,
    );
  services.log.info(
    `planning terminal ${created ? 'opened' : 'revealed'}; plan starts ${built.startDate}`,
  );
  return {
    terminal,
    created,
    promptFile,
    startDate: built.startDate,
    // [PCODE-456 | S15 | v0.1.0] closing the terminal ends the run in the portal and sends the documents
    closed: (deps.waitForClose ?? waitForTerminalClose)(terminal).then(async () => {
      if (live) await endPlanningRun(live, portalDeps);
    }),
  };
}
