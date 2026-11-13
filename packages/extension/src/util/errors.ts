// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-8 | S02 | v0.1.0] Implement the engine runner: spawn, cwd, env passthrough, output, cancellation ──
// ── [PCODE-62 | S12 | v0.1.0] Surface engine and Plane errors as actionable notifications with Open output ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  one error type for everything the user can act on; the message is what the notification shows.
//          The engine answers in whole sentences, but they end in a *command line* ("First: plane status
//          FIX-1 review"), which is the wrong instruction inside an editor that has a button for it. So the
//          known lines are mapped here: the engine's own words stay as the reason, the CLI tail is dropped,
//          and the next step becomes a button that performs it. Pure module - no vscode import - so every
//          mapping is unit-tested, and the table is the single place this copy lives.
export type OrqivaErrorKind = 'engine' | 'config' | 'network' | 'cancelled' | 'user';

// ── [PCODE-8 | S02 | v0.1.0] OrqivaError: message is user-facing (already redacted), detail goes to the log ──
export class OrqivaError extends Error {
  constructor(
    message: string,
    public readonly kind: OrqivaErrorKind = 'engine',
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'OrqivaError';
  }
}

export function isOrqivaError(e: unknown): e is OrqivaError {
  return e instanceof OrqivaError;
}

/** The one button besides "Open output"; `command` is a registered orqiva command. */
export interface ErrorAction {
  label: string;
  command: string;
  args?: readonly string[];
}

export interface DescribedError {
  /** what failed · why · what to do next - one line, as design-system.md asks */
  message: string;
  action?: ErrorAction;
  /** the task the message is about, when the engine named one */
  ref?: string;
}

export const FALLBACK_NEXT = 'Open output for details.';

interface Rule {
  match: RegExp;
  /** rewrites the engine's line; by default it is shown verbatim */
  reason?: (m: RegExpExecArray, raw: string) => string;
  next: string;
  action?: (m: RegExpExecArray) => ErrorAction | undefined;
}

const REF = String.raw`[A-Z]{2,5}-\d+`;

const openTask = (ref: string): ErrorAction => ({
  label: 'Open task',
  command: 'orqiva.openTask',
  args: [ref],
});

// ── [PCODE-62 | S12 | v0.1.0] firstSentence: the fact, without the instruction the engine appends ──
//    Every `die()` in plane_task.py states what is wrong and then how to fix it *on the command line*.
//    The fact is worth repeating verbatim; the instruction is replaced by the rule's own next step, which
//    names a button. An abbreviation ("e.g. FIX-12") is not a sentence end, so a lone letter before the
//    dot does not cut the line in half.
function firstSentence(raw: string): string {
  for (const m of raw.matchAll(/\.\s+(?=[A-Z(])/g)) {
    const head = raw.slice(0, m.index);
    if (head.length < 8 || /(?:^|[\s.])\w$/.test(head)) continue;
    return head;
  }
  return raw.replace(/[.\s]+$/, '');
}

// ── [PCODE-62 | S12 | v0.1.0] the table: the lines the engine and the Plane client actually produce ──
//    Order matters only where two patterns could both match; the first hit wins.
export const ERROR_RULES: readonly Rule[] = [
  {
    match: new RegExp(`^(${REF}) is still active`),
    reason: (_m, raw) => firstSentence(raw),
    next: 'Move it first: Status → Review, or Done.',
    action: (m) => openTask(m[1] ?? ''),
  },
  {
    match: new RegExp(`^(${REF}) is Done`),
    reason: (_m, raw) => firstSentence(raw),
    next: 'Create a new task for the follow-up work.',
    action: () => ({ label: 'New task', command: 'orqiva.newTask' }),
  },
  {
    match: new RegExp(`^(${REF}) has no usable description`),
    reason: (_m, raw) => firstSentence(raw),
    next: 'Add what, why and the acceptance checks in Orqiva, then start it again.',
    action: (m) => openTask(m[1] ?? ''),
  },
  {
    match: /no file carries the fingerprint/,
    reason: (_m, raw) => firstSentence(raw),
    next: 'Add the marker above the code you wrote for this task.',
    action: () => ({ label: 'Copy fingerprint', command: 'orqiva.copyFingerprint' }),
  },
  {
    match: /a task needs (a complete description|at least one acceptance check)/,
    reason: (_m, raw) => firstSentence(raw),
    next: 'Fill in what, why and how to verify, then create it again.',
    action: () => ({ label: 'New task', command: 'orqiva.newTask' }),
  },
  {
    match: /not linked to a Plane project/,
    reason: (_m, raw) => firstSentence(raw),
    next: 'Link this folder to a project first.',
    action: () => ({ label: 'Link project', command: 'orqiva.linkProject' }),
  },
  {
    match: /no state named/,
    next: 'Run the project set-up to add the standard states.',
    action: () => ({ label: 'Open setup', command: 'orqiva.openSetup' }),
  },
  {
    match: /no sprint matching/,
    reason: (_m, raw) => firstSentence(raw),
    next: "Name today, next, or the sprint's own name.",
  },
  {
    match: new RegExp(`no task (${REF}) in Plane`),
    next: 'Sync and try again; the item may be new or may have been renamed.',
    action: () => ({ label: 'Sync now', command: 'orqiva.sync' }),
  },
  {
    match: /task id looks wrong/,
    reason: (_m, raw) => firstSentence(raw),
    next: 'Write the reference the way Orqiva does, for example PCODE-12.',
  },
  {
    match: /git commit failed/,
    next: 'Fix what git reports, then run Done again.',
  },
  {
    match: /\b429\b|rate limit/i,
    next: 'Wait a moment and try again; the tracker allows 60 requests a minute.',
    action: () => ({ label: 'Sync now', command: 'orqiva.sync' }),
  },
  {
    match: /\b401\b|unauthorized|invalid token/i,
    next: 'The tracker refused the key. Enter it again in Set-up.',
    action: () => ({ label: 'Open setup', command: 'orqiva.openSetup' }),
  },
  {
    match: /\b403\b|forbidden/i,
    next: 'The key has no access to this project. Check workspace and project in Set-up.',
    action: () => ({ label: 'Open setup', command: 'orqiva.openSetup' }),
  },
  {
    match: /\b404\b|not found/i,
    next: 'Orqiva has no such item; sync and try again.',
    action: () => ({ label: 'Sync now', command: 'orqiva.sync' }),
  },
  {
    match: /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|unreachable/i,
    next: 'Check the server address and your connection; updates are queued meanwhile.',
    action: () => ({ label: 'Open setup', command: 'orqiva.openSetup' }),
  },
];

/** What an unmapped error of that kind suggests instead. */
const BY_KIND: Partial<Record<OrqivaErrorKind, string>> = {
  config: 'Fix the setting or the connection, then try again.',
  network: 'Check the server address and your connection; updates are queued meanwhile.',
  cancelled: 'Nothing was changed.',
};

function firstLine(text: string): string {
  return (text.split('\n').find((l) => l.trim()) ?? text).trim();
}

// ── [PCODE-62 | S12 | v0.1.0] describeError: the pure half of showError ──
//    The redactor is injected because a key must never reach the copy, and redact() must stay out of a
//    module the tests import without the extension host.
export function describeError(
  action: string,
  err: unknown,
  redactor: (s: string) => string = (s) => s,
): DescribedError {
  const raw = firstLine(redactor(err instanceof Error ? err.message : String(err)))
    .replace(/^ERROR:\s*/i, '')
    .trim();
  const kind = isOrqivaError(err) ? err.kind : 'engine';
  for (const rule of ERROR_RULES) {
    const m = rule.match.exec(raw);
    if (!m) continue;
    const reason = (rule.reason ? rule.reason(m, raw) : raw).replace(/\.$/, '');
    const act = rule.action?.(m);
    const ref = m[1] && new RegExp(`^${REF}$`).test(m[1]) ? m[1] : undefined;
    return {
      message: `${action} failed. ${reason}. ${rule.next}`,
      ...(act ? { action: act } : {}),
      ...(ref ? { ref } : {}),
    };
  }
  return {
    message: `${action} failed. ${raw.replace(/\.$/, '')}. ${BY_KIND[kind] ?? FALLBACK_NEXT}`,
  };
}
