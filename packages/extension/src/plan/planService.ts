// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
// ── [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move ──
// ── [PCODE-31 | S06 | v0.1.0] Build the plan panel: description status, Draft, Check and Publish ──
// ── [PCODE-33 | S06 | v0.1.0] Validate plan.json with plane_plan.py check and show errors before Publish ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  one status object drives the plan panel: is the description written (the template sentence from
//          the engine's description.md is the tell, exactly like ui.ps1), does plan.json exist and parse, what
//          did `plane_plan.py check` say, and when was the plan published. Buttons follow from it.
import * as fs from 'node:fs';
import type { CheckResult } from '../engine/parse';
import type { Services } from '../services';
import { planePath, projectFile } from '../state/files';
import type { PlanStatusMessage } from '../webviews/protocol';
import { checkPlan } from './orqivaPlan';
import { readBindingFile } from '../server/binding';
import { describeLocation, parseCheckError } from './planCheck';

export const TEMPLATE_MARKER = 'Write here what you want built';
/** in the project's folder (.orqiva, or .plane on a legacy folder) */
export const DESCRIPTION_REL = ['description', 'description.md'] as const;

export type DescriptionStatus = 'missing' | 'template' | 'written';
export type PlanFileStatus = 'missing' | 'invalid' | 'errors' | 'valid';

export interface PlanButtons {
  openDescription: boolean;
  draft: boolean;
  check: boolean;
  publish: boolean;
}

export interface PlanStatus {
  root: string | null;
  description: DescriptionStatus;
  plan: PlanFileStatus;
  /** the engine's check result; null when there was nothing to check */
  check: CheckResult | null;
  /** an engine failure (not a validation error), verbatim */
  checkError: string | null;
  publishedAt: string | null;
  buttons: PlanButtons;
}

export interface PlanIo {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, enc: 'utf8') => string;
}

const defaultIo: PlanIo = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
};

/** [PCODE-454 | S15 | v0.1.0] YYYY-MM-DD in local time, the day the plan's dates are compared with */
export function isoDay(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function descriptionPath(root: string): string {
  return projectFile(root, DESCRIPTION_REL);
}

// ── [PCODE-31 | S06 | v0.1.0] descriptionStatus: missing / still the template / written ──
// ── [PCODE-454 | S15 | v0.1.0] VS Code extension: Home tab shows and changes project, server and account; planning works on the Orqiva server ──
//    Written = any line that is not a heading and not the template's sentence: people keep that sentence
//    at the top and write under the headings, and the plan must not stall on it.
export function descriptionStatus(text: string | null): DescriptionStatus {
  if (text === null) return 'missing';
  const own = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.includes(TEMPLATE_MARKER));
  return own.length ? 'written' : 'template';
}

/** 'missing' | 'invalid' (unparseable or no sprints list) | 'present' (worth a check) */
export function planFileStatus(text: string | null): 'missing' | 'invalid' | 'present' {
  if (text === null) return 'missing';
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' &&
      v !== null &&
      Array.isArray((v as { sprints?: unknown }).sprints)
      ? 'present'
      : 'invalid';
  } catch {
    return 'invalid';
  }
}

// ── [PCODE-31 | S06 | v0.1.0] summaryLine: the one sentence the panel shows for the check ──
export function summaryLine(status: PlanStatus): string {
  switch (status.plan) {
    case 'missing':
      return 'No plan yet. Draft one with Claude.';
    case 'invalid':
      return 'plan.json is not valid JSON (or has no "sprints" list).';
    case 'errors':
      return `Plan has ${String(status.check?.errors.length ?? 0)} error(s).`;
    case 'valid': {
      const c = status.check;
      return c
        ? `Plan valid: ${String(c.sprints)} sprints, ${String(c.items)} items, ${c.from} to ${c.to}`
        : 'Plan valid.';
    }
  }
}

export function publishedLine(status: PlanStatus): string {
  return status.publishedAt ? `Published ${status.publishedAt}` : 'Not yet published';
}

// ── [PCODE-31 | S06 | v0.1.0] buttonsFor: a button is enabled only when its step's precondition holds ──
export function buttonsFor(
  s: Pick<PlanStatus, 'root' | 'description' | 'plan'>,
  busy = false,
): PlanButtons {
  const has = s.root !== null && !busy;
  return {
    openDescription: s.root !== null,
    draft: has && s.description === 'written',
    check: has && s.plan !== 'missing',
    publish: has && s.plan === 'valid',
  };
}

export interface PlanFiles {
  description: string | null;
  plan: string | null;
  publishedAt: string | null;
}

export function readPlanFiles(root: string, io: PlanIo = defaultIo): PlanFiles {
  const read = (p: string): string | null => {
    if (!io.existsSync(p)) return null;
    try {
      return io.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  };
  let publishedAt: string | null = null;
  const pub = read(planePath(root, 'published'));
  if (pub !== null) {
    try {
      const v = JSON.parse(pub) as { at?: unknown };
      if (typeof v.at === 'string') publishedAt = v.at;
    } catch {
      /* unreadable published.json = not published */
    }
  }
  return {
    description: read(descriptionPath(root)),
    plan: read(planePath(root, 'plan')),
    publishedAt,
  };
}

// ── [PCODE-31 | S06 | v0.1.0] computeStatus: pure; the check result is handed in (or an engine failure) ──
export function computeStatus(
  root: string | null,
  files: PlanFiles,
  check: CheckResult | null,
  checkError: string | null = null,
): PlanStatus {
  const description = descriptionStatus(files.description);
  const file = planFileStatus(files.plan);
  const plan: PlanFileStatus =
    file !== 'present' ? file : check ? (check.errors.length ? 'errors' : 'valid') : 'invalid';
  const publishedAt = check?.publishedAt ?? files.publishedAt;
  const s: PlanStatus = {
    root,
    description,
    plan: checkError && file === 'present' ? 'invalid' : plan,
    check,
    checkError,
    publishedAt,
    buttons: { openDescription: false, draft: false, check: false, publish: false },
  };
  s.buttons = buttonsFor(s);
  return s;
}

// ── [PCODE-31 | S06 | v0.1.0] toStatusMessage: what the webview gets (strings ready to show, no paths beyond root) ──
export function toStatusMessage(s: PlanStatus): PlanStatusMessage {
  return {
    root: s.root,
    description: s.description,
    plan: s.plan,
    summary: summaryLine(s),
    errors: s.check?.errors ?? [],
    errorLocations: (s.check?.errors ?? []).map((e) => describeLocation(parseCheckError(e))), // [PCODE-33 | S06 | v0.1.0]
    checkError: s.checkError,
    publishedAt: s.publishedAt,
    published: publishedLine(s),
    buttons: s.buttons,
  };
}

export const EMPTY_STATUS: PlanStatus = computeStatus(
  null,
  { description: null, plan: null, publishedAt: null },
  null,
);

// ── [PCODE-31 | S06 | v0.1.0] PlanService: files + `plane_plan.py check` -> PlanStatus ──
// [PCODE-454 | S15 | v0.1.0] a folder on an Orqiva server is checked here, not by the engine
export class PlanService {
  constructor(
    private readonly services: Pick<Services, 'engine' | 'root' | 'log'> & {
      store?: { state: { link: { server?: string } | null } };
    },
    private readonly io: PlanIo = defaultIo,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Files only; no engine. Used when nothing should spawn (untrusted, no engine). */
  filesOnly(): PlanStatus {
    const root = this.services.root();
    if (!root) return EMPTY_STATUS;
    return computeStatus(root, readPlanFiles(root, this.io), null);
  }

  /** Files, then the engine's check when there is a plan worth checking. */
  async status(): Promise<PlanStatus> {
    const root = this.services.root();
    if (!root) return EMPTY_STATUS;
    const files = readPlanFiles(root, this.io);
    if (planFileStatus(files.plan) !== 'present') return computeStatus(root, files, null);
    // [PCODE-454 | S15 | v0.1.0] the engine's rules, applied in the extension
    if (this.services.store?.state.link?.server)
      return computeStatus(
        root,
        files,
        checkPlan(
          files.plan ?? '',
          files.publishedAt,
          isoDay(this.now()),
          // [PCODE-467 | S15 | v0.1.0] the requests the tasks may name: the ones taken into the project
          readBindingFile(root)?.requests.map((r) => r.ref),
        ),
      );
    try {
      return computeStatus(root, files, await this.services.engine.planCheck());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.services.log.warn(`plan check failed: ${msg}`);
      return computeStatus(root, files, null, msg);
    }
  }
}
