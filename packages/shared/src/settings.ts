// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-347 | S15 | v0.1.0] T35.1b Homes for developers and testers with widgets the person chooses ──
// ── [PCODE-333 | S15 | v0.1.0] T33.4b Sandbox per run with repo tools, pull requests by a bot Git identity ──
// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
// ── [PCODE-318 | S15 | v0.1.0] T32.4b Masking of personal data in test results and the test-data vault ──
// ── [PCODE-262 | S15 | v0.1.0] T27.4 Canvas views: timeline, mind map, portfolio; agents as resources and heat map; scenario diff; commits on bars ──
// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
// ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
// ── [PCODE-253 | S15 | v0.1.0] T26.2 Capacity from profiles, absences, holidays and agents; Planner proposes assignees and new stories ──
// ── [PCODE-252 | S15 | v0.1.0] T26.1 Estimation: units, async planning poker, suggestions from similar tasks, estimate vs actual ──
// ── [PCODE-249 | S15 | v0.1.0] T25.4 Alerts and reminders: budgets, anomalies, doc watchers, stale flags and ideas ──
// ── [PCODE-162 | S15 | v0.1.0] B1.1 Live shell server: inbox, notification rules, settings inheritance, shell summary ──
//    Why:  the settings a workspace can set, with their defaults, their kind of value and the levels where
//          they may be overridden. The most specific level wins: a person's value over the project's, the
//          project's over the team's, the team's over the workspace's, which beats the default. Server and
//          clients share this list, so the settings page shows where each value comes from.

import { HOME_WIDGETS } from './homewidgets.js'; // [PCODE-347 | S15 | v0.1.0]

export type SettingScope = 'workspace' | 'team' | 'project' | 'user';
export const SCOPE_ORDER: readonly SettingScope[] = ['user', 'project', 'team', 'workspace'];

export interface WorkspaceSettingDef {
  key: string;
  label: string;
  kind: 'string' | 'number' | 'boolean' | 'strings' | 'object';
  default: unknown;
  scopes: readonly SettingScope[];
  /** for strings: the allowed values */
  options?: readonly string[];
  min?: number;
  max?: number;
}

export const SETTINGS: readonly WorkspaceSettingDef[] = [
  {
    key: 'locale.language',
    label: 'Language',
    kind: 'string',
    default: 'en',
    options: ['en', 'de'],
    scopes: ['workspace', 'user'],
  },
  // owner's decision at gate A1: German number format everywhere
  {
    key: 'money.format',
    label: 'Number and money format',
    kind: 'string',
    default: 'de-DE',
    options: ['de-DE', 'en-GB'],
    scopes: ['workspace'],
  },
  {
    key: 'money.currency',
    label: 'Currency',
    kind: 'string',
    default: 'EUR',
    options: ['EUR'],
    scopes: ['workspace'],
  },
  {
    key: 'calendar.working_days',
    label: 'Working days',
    kind: 'strings',
    default: ['mon', 'tue', 'wed', 'thu', 'fri'],
    options: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    scopes: ['workspace', 'team', 'user'],
  },
  // [PCODE-253 | S15 | v0.1.0] public holidays and closing days, which no one works
  {
    key: 'calendar.holidays',
    label: 'Holidays (YYYY-MM-DD)',
    kind: 'strings',
    default: [],
    scopes: ['workspace'],
  },
  {
    key: 'calendar.working_hours',
    label: 'Working hours',
    kind: 'object',
    default: { from: '08:00', to: '18:00', timeZone: 'Europe/Berlin' },
    scopes: ['workspace', 'team', 'user'],
  },
  {
    key: 'planning.sprint_weeks',
    label: 'Sprint length (weeks)',
    kind: 'number',
    default: 2,
    min: 1,
    max: 6,
    // [PCODE-351 | S15 | v0.1.0] a team keeps its own cadence too
    scopes: ['workspace', 'team', 'project'],
  },
  // [PCODE-252 | S15 | v0.1.0] how tasks are estimated, and how many hours a point is
  {
    key: 'planning.estimate_unit',
    label: 'Estimate in',
    kind: 'string',
    default: 'points',
    options: ['points', 'hours', 'tshirt'],
    scopes: ['workspace', 'project'],
  },
  {
    key: 'planning.hours_per_point',
    label: 'Hours of work in one point',
    kind: 'number',
    default: 6,
    min: 1,
    max: 40,
    scopes: ['workspace', 'project'],
  },
  // [PCODE-262 | S15 | v0.1.0] how many tasks an agent carries on one day in the workload
  {
    key: 'planning.agent_parallel_tasks',
    label: 'Tasks an agent carries a day',
    kind: 'number',
    default: 3,
    min: 1,
    max: 50,
    scopes: ['workspace', 'project'],
  },
  {
    key: 'planning.definition_of_ready',
    label: 'Definition of ready',
    kind: 'strings',
    default: ['acceptance criteria', 'estimate', 'no open questions'],
    scopes: ['workspace', 'project'],
  },
  {
    key: 'planning.definition_of_done',
    label: 'Definition of done',
    kind: 'strings',
    default: ['criteria met', 'review approved', 'tests green', 'docs updated'],
    scopes: ['workspace', 'project'],
  },
  // [PCODE-254 | S15 | v0.1.0] moving a task to done with open entries of the definition needs a reason
  // [PCODE-333 | S15 | v0.1.0] agents commit as <agent key>@<this domain>
  {
    key: 'agents.git_email_domain',
    label: 'Mail domain of the agents’ Git identity',
    kind: 'string',
    default: 'agents.orqiva.local',
    scopes: ['workspace', 'project'],
  },
  // [PCODE-322 | S15 | v0.1.0] the public vulnerability feeds: EPSS gets the workspace's CVE ids
  {
    key: 'security.vuln_feeds',
    label:
      'Read the EPSS scores (FIRST, sent the CVE ids of your findings) and the known-exploited list (CISA) once a day',
    kind: 'boolean',
    default: false,
    scopes: ['workspace'],
  },
  // [PCODE-318 | S15 | v0.1.0] personal data and test data kept out of test results
  {
    key: 'tests.mask_personal_data',
    label: 'Mask emails, phone numbers, IBANs, card numbers and test data in test results',
    kind: 'boolean',
    default: true,
    scopes: ['workspace', 'project'],
  },
  {
    key: 'planning.enforce_definition_of_done',
    label: 'Ask for a reason when a task is done with open entries of the definition',
    kind: 'boolean',
    default: false,
    scopes: ['workspace', 'project'],
  },
  // [PCODE-255 | S15 | v0.1.0] how long a bug may stay open by priority; where Git news moves a task
  {
    key: 'planning.bug_sla_hours',
    label: 'Fix time of a bug by priority (hours)',
    kind: 'object',
    default: { urgent: 8, high: 24, medium: 72, low: 168 },
    scopes: ['workspace', 'project'],
  },
  {
    key: 'git.moves',
    label: 'Move a task when its branch, pull request or merge arrives',
    kind: 'object',
    default: { branch: '', opened: '', merged: '' },
    scopes: ['workspace', 'project'],
  },
  {
    key: 'agents.default_autonomy',
    label: 'Agent autonomy by default',
    kind: 'string',
    default: 'approve',
    options: ['suggest', 'approve', 'scoped', 'autonomous'],
    scopes: ['workspace', 'project'],
  },
  {
    key: 'clients.digest',
    label: 'Client e-mails',
    kind: 'string',
    default: 'daily',
    options: ['each', 'daily', 'weekly'],
    scopes: ['workspace', 'project'],
  },
  // [PCODE-249 | S15 | v0.1.0] when an untouched flag and a quiet idea remind their owner
  {
    key: 'flags.stale_days',
    label: 'Remind of a flag unchanged for (days)',
    kind: 'number',
    default: 30,
    min: 1,
    max: 365,
    scopes: ['workspace'],
  },
  {
    key: 'ideas.stale_days',
    label: 'Remind of an idea without activity for (days)',
    kind: 'number',
    default: 14,
    min: 1,
    max: 365,
    scopes: ['workspace'],
  },
  // [PCODE-347 | S15 | v0.1.0] the widgets of a person's home, in their order; empty is the preset of their kind of home
  {
    key: 'home.widgets',
    label: 'Home widgets',
    kind: 'strings',
    default: [],
    options: Object.keys(HOME_WIDGETS),
    scopes: ['user'],
  },
];

export const settingDef = (key: string): WorkspaceSettingDef | undefined =>
  SETTINGS.find((s) => s.key === key);

/** Why a value does not fit its setting, or null when it fits. */
export function settingProblem(def: WorkspaceSettingDef, value: unknown): string | null {
  switch (def.kind) {
    case 'string':
      if (typeof value !== 'string') return 'must be text';
      if (def.options && !def.options.includes(value))
        return 'must be one of ' + def.options.join(', ');
      return null;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
      if (def.min !== undefined && value < def.min) return 'must be at least ' + String(def.min);
      if (def.max !== undefined && value > def.max) return 'must be at most ' + String(def.max);
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'strings':
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && v.length <= 200))
        return 'must be a list of texts';
      if (def.options && !value.every((v) => def.options?.includes(v as string)))
        return 'may contain only ' + def.options.join(', ');
      return null;
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? null
        : 'must be an object';
  }
}

export interface EffectiveSetting {
  key: string;
  value: unknown;
  /** where the value comes from */
  source: SettingScope | 'default';
}

/** The effective value of every setting, from the values stored per scope. */
export function resolveSettings(
  stored: { scope: SettingScope; key: string; value: unknown }[],
): EffectiveSetting[] {
  return SETTINGS.map((def) => {
    for (const scope of SCOPE_ORDER) {
      if (!def.scopes.includes(scope)) continue;
      const hit = stored.find((s) => s.scope === scope && s.key === def.key);
      if (hit) return { key: def.key, value: hit.value, source: scope };
    }
    return { key: def.key, value: def.default, source: 'default' };
  });
}
