// ── [PCODE-350 | S15 | v0.1.0] T35.3a Templates library for projects, PRDs, sprints and agents ──
//    Why:  a team starts the same kinds of work again and again: a project with its board and labels, a
//          sprint with its rituals, an agent with its instructions, a PRD with the sections the team wants.
//          The library keeps them, built in and the workspace's own, in one shape per kind, checked here so
//          server and web agree on what a template holds.
import type { IdeaKind, TemplateSection } from './prd.js';

export type LibraryKind = 'project' | 'sprint' | 'agent' | 'prd';

export type StateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';

export interface ProjectTemplateBody {
  states?: { name: string; grp: StateGroup; color: string }[];
  labels: { name: string; color: string }[];
  epics: string[];
  settings: Record<string, unknown>;
}
export interface SprintTemplateBody {
  days: number;
  goal: string;
  tasks: string[];
}
export interface AgentTemplateBody {
  name: string;
  description: string;
  model?: string;
  instructions: string;
}
export interface PrdTemplateBody {
  ideaKind: IdeaKind;
  sections: TemplateSection[];
}

export type LibraryBody =
  ProjectTemplateBody | SprintTemplateBody | AgentTemplateBody | PrdTemplateBody;

export interface LibraryTemplate {
  /** "builtin:<slug>" for the built-in ones */
  id: string;
  kind: LibraryKind;
  name: string;
  description: string;
  body: LibraryBody;
  builtIn: boolean;
}

const COLOR = /^#[0-9a-f]{6}$/;
const GROUPS = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'];
const IDEA_KINDS = ['feature', 'improvement', 'bug', 'research', 'change_request'];
const str = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** Why a template's body does not fit its kind, or null when it does. */
export function libraryProblem(kind: LibraryKind, body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return 'The template is empty';
  const b = body as Record<string, unknown>;
  if (kind === 'project') {
    if (b['states'] !== undefined) {
      const st = b['states'];
      if (!Array.isArray(st) || st.length < 2 || st.length > 20)
        return 'A board needs 2 to 20 states';
      for (const s of st as Record<string, unknown>[]) {
        if (
          !str(s['name'], 60) ||
          !GROUPS.includes(String(s['grp'])) ||
          !COLOR.test(String(s['color']))
        )
          return 'Each state needs a name, a group and a colour';
      }
      const groups = (st as { grp: string }[]).map((s) => s.grp);
      if (!groups.includes('completed')) return 'A board needs a done state';
      if (new Set((st as { name: string }[]).map((s) => s.name.toLowerCase())).size !== st.length)
        return 'Two states have the same name';
    }
    if (!Array.isArray(b['labels']) || b['labels'].length > 40)
      return 'Labels are a list of up to 40';
    for (const l of b['labels'] as Record<string, unknown>[])
      if (!str(l['name'], 60) || !COLOR.test(String(l['color'])))
        return 'Each label needs a name and a colour';
    if (
      !Array.isArray(b['epics']) ||
      b['epics'].length > 30 ||
      !b['epics'].every((e) => str(e, 200))
    )
      return 'Epics are a list of up to 30 titles';
    if (typeof b['settings'] !== 'object' || b['settings'] === null || Array.isArray(b['settings']))
      return 'Settings are keys with values';
    return null;
  }
  if (kind === 'sprint') {
    const d = b['days'];
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 42)
      return 'A sprint lasts 1 to 42 days';
    if (typeof b['goal'] !== 'string' || b['goal'].length > 2000) return 'The goal is too long';
    if (
      !Array.isArray(b['tasks']) ||
      b['tasks'].length > 30 ||
      !b['tasks'].every((t) => str(t, 200))
    )
      return 'Tasks are a list of up to 30 titles';
    return null;
  }
  if (kind === 'agent') {
    if (!str(b['name'], 80)) return 'An agent needs a name';
    if (typeof b['description'] !== 'string' || b['description'].length > 500)
      return 'The description is too long';
    if (!str(b['instructions'], 20_000)) return 'An agent needs instructions';
    if (b['model'] !== undefined && !str(b['model'], 100)) return 'The model is not a model name';
    return null;
  }
  if (!IDEA_KINDS.includes(String(b['ideaKind']))) return 'Choose the kind of idea the PRD is for';
  const sec = b['sections'];
  if (!Array.isArray(sec) || !sec.length || sec.length > 20)
    return 'A PRD template has 1 to 20 sections';
  for (const s of sec as Record<string, unknown>[])
    if (
      !/^[a-z][a-z0-9_]{1,40}$/.test(String(s['key'])) ||
      !str(s['title'], 80) ||
      typeof s['hint'] !== 'string'
    )
      return 'Each section needs a key, a title and a hint';
  return null;
}

const LABEL = (name: string, color: string): { name: string; color: string } => ({ name, color });

export const BUILTIN_LIBRARY: readonly LibraryTemplate[] = [
  {
    id: 'builtin:software-product',
    kind: 'project',
    name: 'Software product',
    description:
      'The standard board, labels for bugs, features and debt, and the epics of a first release.',
    builtIn: true,
    body: {
      labels: [
        LABEL('bug', '#ef4444'),
        LABEL('feature', '#3f76ff'),
        LABEL('tech-debt', '#f59e0b'),
        LABEL('security', '#a855f7'),
      ],
      epics: ['Discovery', 'MVP', 'Beta', 'Launch'],
      settings: {},
    },
  },
  {
    id: 'builtin:client-project',
    kind: 'project',
    name: 'Client project',
    description:
      'A board with client acceptance, labels for change requests and the epics from kick-off to handover.',
    builtIn: true,
    body: {
      states: [
        { name: 'Backlog', grp: 'backlog', color: '#8b8d98' },
        { name: 'Todo', grp: 'unstarted', color: '#3f76ff' },
        { name: 'In Progress', grp: 'started', color: '#f59e0b' },
        { name: 'Review', grp: 'started', color: '#a855f7' },
        { name: 'Client acceptance', grp: 'started', color: '#06b6d4' },
        { name: 'Done', grp: 'completed', color: '#16a34a' },
        { name: 'Cancelled', grp: 'cancelled', color: '#6b7280' },
      ],
      labels: [
        LABEL('change-request', '#f59e0b'),
        LABEL('bug', '#ef4444'),
        LABEL('billable', '#16a34a'),
      ],
      epics: ['Kick-off', 'Design', 'Delivery', 'Acceptance', 'Handover'],
      settings: {},
    },
  },
  {
    id: 'builtin:two-week-sprint',
    kind: 'sprint',
    name: 'Two-week sprint',
    description: 'Fourteen days with planning, a review and a retrospective.',
    builtIn: true,
    body: { days: 14, goal: '', tasks: ['Sprint planning', 'Sprint review', 'Retrospective'] },
  },
  {
    id: 'builtin:release-sprint',
    kind: 'sprint',
    name: 'Release sprint',
    description: 'One week to freeze, test, write the notes and ship.',
    builtIn: true,
    body: {
      days: 7,
      goal: 'Ship the release',
      tasks: [
        'Freeze the release',
        'Regression test run',
        'Release notes',
        'Client sign-off',
        'Ship and watch',
      ],
    },
  },
  {
    id: 'builtin:release-notes-writer',
    kind: 'agent',
    name: 'Release notes writer',
    description: 'Writes release notes for clients from the tasks and commits of a release.',
    builtIn: true,
    body: {
      name: 'Release notes writer',
      description: 'Writes release notes for clients from the tasks and commits of a release.',
      instructions:
        'You write release notes for the client in plain words: what is new, what changed, what was fixed. Group by what the user notices, not by task. Leave out internal work. Name the tasks only where it helps the reader.',
    },
  },
  {
    id: 'builtin:bug-triage',
    kind: 'agent',
    name: 'Bug triager',
    description: 'Reads new bugs, asks for what is missing and proposes a severity and an owner.',
    builtIn: true,
    body: {
      name: 'Bug triager',
      description: 'Reads new bugs, asks for what is missing and proposes a severity and an owner.',
      instructions:
        'You read a new bug report. If steps, expected and actual result or the environment are missing, ask for them in one comment. Propose a severity with one sentence why, and the person who last changed the code involved as owner. Change nothing yourself.',
    },
  },
  {
    id: 'builtin:lean-prd',
    kind: 'prd',
    name: 'Lean PRD for features',
    description: 'The few sections a small team needs before building a feature.',
    builtIn: true,
    body: {
      ideaKind: 'feature',
      sections: [
        { key: 'users', title: 'Who it is for', hint: 'The person and the moment they need it.' },
        {
          key: 'success',
          title: 'How we know it worked',
          hint: 'One or two numbers with targets.',
        },
        { key: 'out', title: 'Not in this version', hint: 'What we leave out on purpose.' },
      ],
    },
  },
];

/** A template's body for a project that exists: its states, labels, epics and project settings. */
export function projectTemplateOf(p: {
  states: { name: string; grp: string; color: string }[];
  labels: { name: string; color: string }[];
  epics: string[];
  settings: Record<string, unknown>;
}): ProjectTemplateBody {
  return {
    states: p.states.map((s) => ({ name: s.name, grp: s.grp as StateGroup, color: s.color })),
    labels: p.labels.map((l) => ({ name: l.name, color: l.color })),
    epics: p.epics.slice(0, 30),
    settings: p.settings,
  };
}

/** The last day of a sprint that starts on `start` and lasts `days` days. */
export function sprintEnd(start: string, days: number): string {
  return new Date(Date.parse(start + 'T00:00:00Z') + (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
