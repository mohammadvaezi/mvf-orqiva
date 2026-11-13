// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-14 | S03 | v0.1.0] Add Sync, Start, Done, Status and Note commands wired to the engine ──
// ── [PCODE-62 | S12 | v0.1.0] Surface engine and Plane errors as actionable notifications with Open output ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  one place turns an error into the three-part message design-system.md asks for (what failed,
//          why - the engine's line -, what to do next) with an "Open output" button and, where the next
//          step is a command we have, the button that performs it. This is the ONLY module allowed to call
//          window.showErrorMessage; an eslint rule keeps it that way, because an error raised from a catch
//          somewhere else is the one that shows a stack trace and offers no way forward.
import * as vscode from 'vscode';
import { describeError, isOrqivaError, type ErrorAction } from '../util/errors';
import type { Logger } from '../util/log';
import { redact } from '../util/redact';

export const OPEN_OUTPUT = 'Open output';
/** the same message is not shown again inside this window */
export const DEDUPE_MS = 30_000;

// ── [PCODE-14 | S03 | v0.1.0] errorMessage: pure formatter, tested without VS Code ──
export function errorMessage(action: string, err: unknown): string {
  return describeError(action, err, redact).message;
}

// ── [PCODE-62 | S12 | v0.1.0] when each message was last shown ──
//    A dead network fails every poll and every panel refresh with the same sentence; without this the user
//    gets a stack of identical toasts and stops reading any of them.
const lastShown = new Map<string, number>();

export function resetErrorDedupe(): void {
  lastShown.clear();
}

export interface ShowErrorDeps {
  now?: () => number;
  show?: (message: string, ...items: string[]) => Thenable<string | undefined>;
  run?: (command: string, ...args: unknown[]) => Thenable<unknown>;
}

// ── [PCODE-52 | S10 | v0.1.0] the notification is not awaited ──
//    A toast with a button only resolves when somebody clicks or dismisses it. Awaiting that kept the whole
//    command running - forever in an automated host - although its work was already finished and logged.
export function showError(
  action: string,
  err: unknown,
  log: Logger,
  deps: ShowErrorDeps = {},
): Promise<void> {
  const described = describeError(action, err, redact);
  const { message } = described;
  log.error(message, isOrqivaError(err) ? (err.detail ?? '') : '');
  const now = (deps.now ?? Date.now)();
  const seen = lastShown.get(message);
  if (seen !== undefined && now - seen < DEDUPE_MS) return Promise.resolve();
  lastShown.set(message, now);
  const next: ErrorAction | undefined = described.action;
  const items = next ? [next.label, OPEN_OUTPUT] : [OPEN_OUTPUT];
  const show =
    deps.show ?? ((m: string, ...i: string[]) => vscode.window.showErrorMessage(m, ...i));
  const run = deps.run ?? ((c: string, ...a: unknown[]) => vscode.commands.executeCommand(c, ...a));
  void Promise.resolve(show(message, ...items)).then(
    (pick) => {
      if (pick === OPEN_OUTPUT) log.show();
      else if (next && pick === next.label) void run(next.command, ...(next.args ?? []));
    },
    () => undefined,
  );
  return Promise.resolve();
}

export function info(message: string): void {
  void vscode.window.showInformationMessage(redact(message));
}
