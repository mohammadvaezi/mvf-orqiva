// ── [PCODE-465 | S15 | v0.1.0] Build with Claude works in every Windows shell: the task prompt goes through a file ──
// ── [PCODE-463 | S15 | v0.1.0] Finishing a task never dead-ends on missing fingerprints: Claude marks the code, or finish without marks ──
// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-16 | S03 | v0.1.0] Add the Start development command opening Claude Code in the integrated terminal ──
// ── [PCODE-73 | S03 | v0.1.0] Support VS Code workspace trust: limited mode until the folder is trusted ──
//    Why:  the daily entry point: one click, Claude Code starts in the project with the session brief.
// ── [PCODE-78 | S08 | v0.1.0] Add the Orqiva Home tab: guided setup steps and a visual task board ──
//    Why:  "Build with Claude" on a card: Claude starts with the task as its first prompt, so nobody has
//          to type anything. One terminal per task: a reused terminal may sit at a shell prompt, where
//          the prompt text would run as a command, so text is only ever sent to a terminal just made.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { projectFile, projectRel } from '../state/files';
import type { Services } from '../services';
import { info } from './notify';
import { isTrusted, TRUST_MESSAGE } from '../util/trust';
import {
  CLAUDE_TERMINAL,
  currentShell,
  openOrReuse,
  quoteArg,
  type ShellKind,
  vscodeTerminalHost,
  type TerminalHost,
} from '../util/terminal';

export interface StartDevDeps {
  services: Services;
  host?: TerminalHost;
  claudeCommand?: () => string;
  /** [PCODE-78 | S08 | v0.1.0] the first thing Claude is asked; with it, a terminal of its own */
  prompt?: { text: string; terminal: string };
  shell?: ShellKind;
}

// ── [PCODE-78 | S08 | v0.1.0] taskPrompt: what "Build with Claude" asks - no secret, one line ──
// [PCODE-462 | S15 | v0.1.0] ...and when the work is done, Claude hands it on itself: orq done moves it to Review
// [PCODE-463 | S15 | v0.1.0] ...naming the fingerprint, since orq done looks for it in the code
export function taskPrompt(ref: string, title: string, orq = 'orq', marker?: string): string {
  const oneLine = title.replace(/\s+/g, ' ').trim();
  return (
    `Work on ${ref}: ${oneLine}. It is the active Orqiva task - read it with: ${orq} show ${ref}. ` +
    `Implement it and meet its acceptance criteria. ` +
    markLine(ref, marker) +
    `When it is finished and its checks pass, run: ` +
    `${orq} done ${ref} - that commits the work and moves the task to Review in Orqiva. ` +
    `If it refuses, fix what it names and run it again. Then tell me what you did.`
  );
}

/** How the code is marked for a task: the fingerprint comment, once per file and above each block. */
function markLine(ref: string, marker?: string): string {
  const fp = marker ?? `[${ref} | <sprint> | v<version>] <title>`;
  return (
    `Mark the code you write for it with the fingerprint comment "${fp}" (in the file's comment syntax): ` +
    `once at the top of every file you create or change, and above every block you write. `
  );
}

// ── [PCODE-463 | S15 | v0.1.0] markPrompt: a finished task without fingerprints gets them, then is handed on ──
export function markPrompt(ref: string, title: string, orq = 'orq', marker?: string): string {
  const oneLine = title.replace(/\s+/g, ' ').trim();
  return (
    `${ref} (${oneLine}) is built, but its code carries no fingerprint, so ${orq} done ${ref} refuses. ` +
    `Find the files that were written or changed for it (git status and git diff show them). ` +
    markLine(ref, marker) +
    `Change nothing else. Then run: ${orq} done ${ref} and tell me what it says.`
  );
}

// ── [PCODE-16 | S03 | v0.1.0] startDevelopment: env from secrets + PLANE_CLAUDE_HOME; the sent text carries no secret ──
export async function startDevelopment(
  deps: StartDevDeps,
): Promise<{ created: boolean } | undefined> {
  const { services } = deps;
  const root = services.root();
  if (!root) {
    info('Link this folder to an Orqiva project first.');
    return undefined;
  }
  if (!isTrusted()) {
    info(TRUST_MESSAGE); // [PCODE-73 | S03 | v0.1.0] no terminal in Restricted Mode
    return undefined;
  }
  const env = await services.secrets.envForEngine();
  const loc = await services.location();
  if (loc.home) env['PLANE_CLAUDE_HOME'] = loc.home;
  const host = deps.host ?? vscodeTerminalHost;
  const command = (
    deps.claudeCommand ??
    (() => vscode.workspace.getConfiguration('orqiva').get<string>('claudeCommand', 'claude'))
  )();
  const name = deps.prompt?.terminal ?? CLAUDE_TERMINAL;
  const { terminal, created } = openOrReuse(host, { name, cwd: root, env });
  terminal.show(false);
  if (created) {
    const shell = deps.shell ?? currentShell();
    terminal.sendText(
      deps.prompt ? `${command} ${quoteArg(promptLine(root, deps.prompt), shell)}` : command,
      true,
    );
  }
  return { created };
}

// ── [PCODE-465 | S15 | v0.1.0] promptLine: the prompt in a file, one plain sentence on the command line ──
//    claude is claude.cmd on many Windows machines, so PowerShell hands the line to cmd.exe: a double quote
//    in the prompt breaks the quoting there and a | or & in it starts another command. The prompt is
//    written to .orqiva/state/prompts/ (git ignores state/) and Claude is asked to read it; the sentence
//    has only letters, dots and slashes.
export function promptLine(root: string, prompt: { text: string; terminal: string }): string {
  const name =
    prompt.terminal
      .replace(/^Claude Code\s*·?\s*/, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'task';
  const file = projectFile(root, ['state', 'prompts', name + '.md']);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, prompt.text + '\n', 'utf8');
  return `Read ${projectRel(root, ['state', 'prompts', name + '.md'])} and do what it says.`;
}

export function registerDevCommands(context: vscode.ExtensionContext, services: Services): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('orqiva.startDevelopment', () => {
      void startDevelopment({ services });
    }),
  );
}
