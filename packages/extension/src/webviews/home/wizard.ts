// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
// ── [PCODE-457 | S15 | v0.1.0] VS Code planning as a conversation: Claude asks, the user answers with text and files, then the plan; replan and description change work; Home tab explains itself ──
// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
// ── [PCODE-79 | S08 | v0.1.0] Add the New project wizard: describe the idea, draft, review and publish the plan visually ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the wizard's position is read from the files, never stored: a description written by hand,
//          a plan Claude wrote in another window or a publish from the palette all move it on by
//          themselves, and closing VS Code half-way loses nothing. Pure, so it is tested without VS Code.
import type { PlanJson } from '../../state/types';
import type { Entry, InterviewState, Question } from '../../plan/interview';
import type { SessionView } from '../../plan/session';

// [PCODE-457 | S15 | v0.1.0] Claude's questions are a step of their own between the idea and the plan
export type WizardStepId = 'describe' | 'questions' | 'draft' | 'review' | 'publish';
export type DescriptionState = 'missing' | 'template' | 'written';
export type PlanState = 'missing' | 'invalid' | 'errors' | 'valid';

export interface WizardInputs {
  description: DescriptionState;
  /** what the user wrote, without the heading the wizard adds; '' for a template */
  descriptionText: string;
  plan: PlanState;
  planJson: PlanJson | null;
  errors: string[];
  checkError: string | null;
  published: boolean;
  /** [PCODE-457 | S15 | v0.1.0] the planning conversation; left out on a folder that plans in a terminal */
  conversation?: { state: InterviewState; entries: Entry[]; planCurrent: boolean } | null;
  running?: SessionView | null;
  /** [PCODE-467 | S15 | v0.1.0] false: the client is not chosen yet, the description step stays */
  bound?: boolean;
}

// ── [PCODE-457 | S15 | v0.1.0] the conversation as the Home tab shows it ──
export interface WizardTalk {
  state: InterviewState;
  /** the questions waiting for answers */
  open: Question[];
  /** what Claude understood, from its latest turn */
  understanding: string;
  /** what was asked and answered before, for the "earlier questions" list */
  answered: { question: string; answer: string; files: string[] }[];
  rounds: number;
  /** a plan exists that was written before the latest turn of the conversation */
  outdatedPlan: boolean;
}

export interface WizardItem {
  title: string;
  label: string;
  priority: string;
  acceptance: number;
}

export interface WizardSprint {
  name: string;
  date: string;
  goal: string;
  items: WizardItem[];
}

export interface WizardData {
  step: WizardStepId;
  steps: { id: WizardStepId; title: string; state: 'done' | 'current' | 'todo' }[];
  descriptionText: string;
  plan: PlanState;
  sprints: WizardSprint[];
  totals: { sprints: number; items: number };
  errors: string[];
  checkError: string | null;
  /** [PCODE-457 | S15 | v0.1.0] null on a folder that plans in a terminal */
  talk: WizardTalk | null;
  running: SessionView | null;
}

const TITLES: Record<WizardStepId, string> = {
  describe: 'Describe your idea',
  questions: "Answer Claude's questions", // [PCODE-457 | S15 | v0.1.0]
  draft: 'Claude writes the plan',
  review: 'Check the plan',
  publish: 'Check and publish', // [PCODE-453 | S15 | v0.1.0]
};

/** the heading the wizard writes above the user's words; the planning run ignores it */
export const DESCRIPTION_HEADING = '# Project description';

export function descriptionFile(text: string): string {
  return `${DESCRIPTION_HEADING}\n\n${text.trim()}\n`;
}

export function descriptionBody(file: string | null): string {
  if (file === null) return '';
  const t = file.replace(/\r\n/g, '\n');
  return (t.startsWith(DESCRIPTION_HEADING) ? t.slice(DESCRIPTION_HEADING.length) : t).trim();
}

// ── [PCODE-79 | S08 | v0.1.0] wizardModel: the first thing not done yet is the step ──
// ── [PCODE-457 | S15 | v0.1.0] ...with Claude's questions before the plan, and a run in progress first ──
export function wizardModel(i: WizardInputs): WizardData | null {
  if (i.published) return null;
  const c = i.conversation ?? null;
  const running = i.running && i.running.phase !== 'idle' ? i.running : null;
  // a plan from before the conversation (or from a terminal) stands until the user asks for a new one
  const planReady = i.plan !== 'missing' && (!c || c.planCurrent);
  const step: WizardStepId =
    i.description !== 'written' || i.bound === false
      ? 'describe'
      : running
        ? running.phase === 'asking'
          ? 'questions'
          : 'draft'
        : c && c.state !== 'clear' && !(c.state === 'none' && i.plan !== 'missing')
          ? 'questions'
          : !planReady
            ? 'draft'
            : i.plan === 'valid'
              ? 'publish'
              : 'review';
  // the list the user sees: the fix-the-plan screen belongs to "Claude writes the plan"
  const order: WizardStepId[] = c
    ? ['describe', 'questions', 'draft', 'publish']
    : ['describe', 'draft', 'publish'];
  const at = order.indexOf(step === 'review' ? 'draft' : step);
  const sprints = (i.planJson?.sprints ?? []).map<WizardSprint>((s) => ({
    name: s.name,
    date: s.date,
    goal: s.goal,
    items: s.items.map((it) => ({
      title: it.title,
      label: it.label,
      priority: it.priority,
      acceptance: it.acceptance.length,
    })),
  }));
  return {
    step,
    steps: order.map((id, n) => ({
      id,
      title: TITLES[id],
      state: n < at ? 'done' : n === at ? 'current' : 'todo',
    })),
    descriptionText: i.description === 'written' ? i.descriptionText : '',
    plan: i.plan,
    sprints,
    totals: { sprints: sprints.length, items: sprints.reduce((n, s) => n + s.items.length, 0) },
    errors: i.errors,
    checkError: i.checkError,
    talk: c ? talkOf(c, i.plan !== 'missing') : null,
    running: i.running ?? null,
  };
}

function talkOf(c: NonNullable<WizardInputs['conversation']>, hasPlan: boolean): WizardTalk {
  const answered: WizardTalk['answered'] = [];
  let understanding = '';
  let open: Question[] = [];
  let rounds = 0;
  for (const e of c.entries) {
    if (e.kind === 'note') continue;
    if (e.understanding) understanding = e.understanding;
    if (e.kind !== 'questions') continue;
    rounds++;
    if (!e.answers) {
      open = e.questions;
      continue;
    }
    for (const q of e.questions) {
      const a = e.answers[q.id];
      answered.push({
        question: q.question,
        answer: a?.text || (a?.files.length ? '' : 'Left to Claude'),
        files: a?.files ?? [],
      });
    }
  }
  return {
    state: c.state,
    open: c.state === 'asking' ? open : [],
    understanding,
    answered,
    rounds,
    outdatedPlan: hasPlan && !c.planCurrent,
  };
}
