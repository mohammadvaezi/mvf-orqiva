// ── [PCODE-16 | S03 | v0.1.0] Add the Start development command opening Claude Code in the integrated terminal ──
// ── [PCODE-61 | S12 | v0.1.0] Harden engine spawning for paths with spaces and non-Windows shells ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  Claude Code runs in a terminal; the terminal must sit in the project root with the engine env so the
//          hooks and the `plane` command work. One terminal per name - a second click reveals, never duplicates.
//          Everything else in the extension spawns with an argv array, but a terminal only takes a *line*, so
//          this is the one place where quoting is ours to get right - and it differs per shell.
import * as vscode from 'vscode';

export const CLAUDE_TERMINAL = 'Claude Code';

/** The three quoting conventions a VS Code terminal can be running. */
export type ShellKind = 'posix' | 'powershell' | 'cmd';

// ── [PCODE-61 | S12 | v0.1.0] detectShell: from the shell path, not from the platform ──
//    A Windows machine may well be on Git Bash, and a Mac may be on pwsh; the executable name is the
//    only honest signal. The platform decides only when there is no path at all.
export function detectShell(shellPath: string | undefined, platform: NodeJS.Platform): ShellKind {
  const name = (shellPath ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.toLowerCase()
    .replace(/\.exe$/, '');
  if (!name) return platform === 'win32' ? 'powershell' : 'posix';
  if (name === 'cmd') return 'cmd';
  if (name === 'powershell' || name === 'pwsh') return 'powershell';
  // bash, zsh, sh, fish, dash, git-bash, wsl… all take POSIX quoting
  return 'posix';
}

// ── [PCODE-61 | S12 | v0.1.0] quoteArg: one argument, safe in that shell, with no interpolation left ──
export function quoteArg(value: string, shell: ShellKind): string {
  if (shell === 'powershell') return `'${value.replace(/'/g, "''")}'`;
  if (shell === 'cmd') return `"${value.replace(/"/g, '""').replace(/%/g, '%%')}"`;
  // POSIX: single quotes take everything literally; a quote of its own closes, escapes and reopens
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const BARE = /^[A-Za-z0-9_./\\:@+-]+$/;

// ── [PCODE-61 | S12 | v0.1.0] commandLine: the command plus its arguments, quoted only where needed ──
//    PowerShell treats a quoted first word as a string to print, so a command that needs quoting - the
//    usual reason being a path with a space - is called through the call operator.
export function commandLine(command: string, args: readonly string[], shell: ShellKind): string {
  const head = BARE.test(command)
    ? command
    : shell === 'powershell'
      ? `& ${quoteArg(command, shell)}`
      : quoteArg(command, shell);
  const tail = args.map((a) => (BARE.test(a) ? a : quoteArg(a, shell)));
  return [head, ...tail].join(' ');
}

// ── [PCODE-61 | S12 | v0.1.0] currentShell: what this window's terminal actually runs ──
export function currentShell(): ShellKind {
  let shellPath: string | undefined;
  try {
    shellPath = vscode.env.shell;
  } catch {
    shellPath = undefined;
  }
  return detectShell(shellPath, process.platform);
}

export interface TerminalSpec {
  name: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface TerminalLike {
  name: string;
  sendText(text: string, addNewLine?: boolean): void;
  show(preserveFocus?: boolean): void;
  exitStatus?: unknown;
}

export interface TerminalHost {
  terminals: readonly TerminalLike[];
  createTerminal(options: { name: string; cwd: string; env: Record<string, string> }): TerminalLike;
}

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && v !== '') out[k] = v;
  return out;
}

// ── [PCODE-16 | S03 | v0.1.0] openOrReuse: an existing live terminal of that name wins ──
export function openOrReuse(
  host: TerminalHost,
  spec: TerminalSpec,
): { terminal: TerminalLike; created: boolean } {
  const existing = host.terminals.find((t) => t.name === spec.name && t.exitStatus === undefined);
  if (existing) return { terminal: existing, created: false };
  return {
    terminal: host.createTerminal({ name: spec.name, cwd: spec.cwd, env: cleanEnv(spec.env) }),
    created: true,
  };
}

export const vscodeTerminalHost: TerminalHost = {
  get terminals(): readonly TerminalLike[] {
    return vscode.window.terminals;
  },
  createTerminal: (o) => vscode.window.createTerminal({ name: o.name, cwd: o.cwd, env: o.env }),
};
