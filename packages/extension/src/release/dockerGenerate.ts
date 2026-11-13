// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-52 | S10 | v0.1.0] Generate Dockerfile and compose through a Plane task run by Claude Code ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the extension never writes project code itself. A Dockerfile is project code, so it is written the
//          way everything else is: a Plane item first, started, then Claude Code in the terminal with that
//          item active - which is what makes the files carry a fingerprint and land in a commit (criticals #9).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { EngineCommands } from '../engine/commands';
import type { Services } from '../services';
import { projectDir, projectFile } from '../state/files';
import { OrqivaError } from '../util/errors';
import {
  CLAUDE_TERMINAL,
  commandLine,
  currentShell,
  openOrReuse,
  vscodeTerminalHost,
  type ShellKind,
  type TerminalHost,
  type TerminalLike,
} from '../util/terminal';
import { isTrusted, TRUST_MESSAGE } from '../util/trust';

export const TASK_TITLE = 'Add Dockerfile and docker-compose from architecture.md';

// ── [PCODE-52 | S10 | v0.1.0] the item's description: what to write, and how it will be judged ──
export function taskDescription(projectName: string, image: string, dir = '.plane'): string {
  return [
    `Containerise ${projectName} so it can be built and run from the Orqiva Docker panel.`,
    '',
    `Read \`${dir}/architecture.md\` (stack, entry points, services, config) and write:`,
    '',
    '- `Dockerfile` — a production image of the application, small and reproducible; no secrets baked in.',
    '- `docker-compose.yml` — the application plus the services the architecture names (database, cache, …),',
    '  with a healthcheck per service and the ports the architecture uses.',
    '',
    `The image is tagged \`${image}\` by the panel, so the Dockerfile must build from the project root.`,
    '',
    'Acceptance',
    `- [ ] \`docker build -t ${image} .\` succeeds`,
    '- [ ] `docker compose up -d` brings every service to healthy',
    '- [ ] both files carry the fingerprint of this task',
    '',
  ].join('\n');
}

export function claudePrompt(ref: string, dir = '.plane', done = 'plane done'): string {
  return `Task ${ref} is active: read ${dir}/architecture.md and write Dockerfile and docker-compose.yml with fingerprints, then run ${done} ${ref}`;
}

export interface GenerateDeps {
  services: Pick<Services, 'engine' | 'store' | 'root' | 'log' | 'secrets' | 'location'>;
  image: string;
  host?: TerminalHost;
  claudeCommand?: () => string;
  /** injected for tests; otherwise the shell of this window's terminal [PCODE-61 | S12 | v0.1.0] */
  shell?: ShellKind;
  io?: {
    mkdirSync: (p: string, o: { recursive: true }) => void;
    writeFileSync: (p: string, d: string, enc: 'utf8') => void;
    unlinkSync: (p: string) => void;
  };
}

export interface GenerateResult {
  ref: string;
  title: string;
  terminal: TerminalLike;
  prompt: string;
}

const defaultIo = {
  mkdirSync: (p: string, o: { recursive: true }) => {
    fs.mkdirSync(p, o);
  },
  writeFileSync: (p: string, d: string, enc: 'utf8') => {
    fs.writeFileSync(p, d, enc);
  },
  unlinkSync: (p: string) => {
    fs.unlinkSync(p);
  },
};

// ── [PCODE-52 | S10 | v0.1.0] generateDockerFiles: new -> start -> Claude Code, in that order ──
export async function generateDockerFiles(deps: GenerateDeps): Promise<GenerateResult> {
  const { services } = deps;
  const root = services.root();
  const link = services.store.state.link;
  if (!root || !link)
    throw new OrqivaError('Link this folder to an Orqiva project first.', 'config');
  if (!isTrusted()) throw new OrqivaError(TRUST_MESSAGE, 'config');
  // one active task at a time is the whole point of the loop
  const active = services.store.state.active;
  if (active)
    throw new OrqivaError(
      `Finish or park ${active.task} first — only one task can be active.`,
      'user',
    );

  const io = deps.io ?? defaultIo;
  const dir = projectFile(root, ['state']); // [PCODE-455 | S15 | v0.1.0]
  const file = path.join(dir, 'docker-task.md');
  io.mkdirSync(dir, { recursive: true });
  io.writeFileSync(file, taskDescription(link.name, deps.image, projectDir(root)), 'utf8');
  let created: Awaited<ReturnType<EngineCommands['newTask']>>;
  try {
    created = await services.engine.newTask({
      title: TASK_TITLE,
      sprint: 'today',
      label: 'chore',
      priority: 'high',
      descFile: file,
    });
  } finally {
    try {
      io.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
  await services.engine.start(created.ref);

  const env = await services.secrets.envForEngine();
  const loc = await services.location();
  if (loc.home) env['PLANE_CLAUDE_HOME'] = loc.home;
  const host = deps.host ?? vscodeTerminalHost;
  const claude = (
    deps.claudeCommand ??
    (() => vscode.workspace.getConfiguration('orqiva').get<string>('claudeCommand', 'claude'))
  )();
  const { terminal, created: fresh } = openOrReuse(host, { name: CLAUDE_TERMINAL, cwd: root, env });
  terminal.show(false);
  const prompt = link.server
    ? claudePrompt(created.ref, projectDir(root), 'orq done')
    : claudePrompt(created.ref);
  // [PCODE-61 | S12 | v0.1.0] the sentence carries dots and colons; it is quoted for the running shell
  if (fresh) terminal.sendText(commandLine(claude, [prompt], deps.shell ?? currentShell()), true);
  else terminal.sendText(prompt, true); // a session is already running: hand it the sentence
  services.log.info(`docker files: ${created.ref} created and started; Claude Code opened`);
  return { ref: created.ref, title: created.title, terminal, prompt };
}
