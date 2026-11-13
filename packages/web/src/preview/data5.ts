// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-157 | S15 | v0.1.0] D5 preview: Agents, People, Tokens and costs, Activity, Insights, Settings ──
//    Why:  the sample data behind the platform sections: agents with their configuration, runs, costs and
//          quality; people, roles and access; AI spend, prices and access tokens; a generated stream of many
//          thousand activity events; and the metrics for Insights. Money is in euro, converted from the
//          providers' dollar prices with the day's rate.

// ── agents ───────────────────────────────────────────────────────────────────────────────────────────────
export type Autonomy = 'suggest' | 'approve' | 'scoped' | 'autonomous';

export interface AgentRow {
  id: string;
  role: string;
  model: string;
  fallback: string;
  autonomy: Autonomy;
  on: boolean;
  runsToday: number;
  monthCost: number;
  budget: number;
  success: number;
  perMergedPr: number | null;
  owner: string;
  prompt: string;
}

export const AGENTS: AgentRow[] = [
  {
    id: 'a-coder',
    role: 'Implementation',
    model: 'claude-opus-5-5',
    fallback: 'claude-sonnet-5-5',
    autonomy: 'approve',
    on: true,
    runsToday: 14,
    monthCost: 612.4,
    budget: 900,
    success: 0.84,
    perMergedPr: 3.9,
    owner: 'mara',
    prompt: 'v12',
  },
  {
    id: 'a-reviewer',
    role: 'Code review',
    model: 'claude-sonnet-5-5',
    fallback: 'claude-haiku-4-5',
    autonomy: 'scoped',
    on: true,
    runsToday: 22,
    monthCost: 141.2,
    budget: 250,
    success: 0.91,
    perMergedPr: 0.6,
    owner: 'lea',
    prompt: 'v7',
  },
  {
    id: 'a-tester',
    role: 'Test design',
    model: 'claude-sonnet-5-5',
    fallback: 'claude-haiku-4-5',
    autonomy: 'scoped',
    on: true,
    runsToday: 6,
    monthCost: 88.7,
    budget: 150,
    success: 0.88,
    perMergedPr: null,
    owner: 'sara',
    prompt: 'v5',
  },
  {
    id: 'a-analyst',
    role: 'Requirements',
    model: 'claude-opus-5-5',
    fallback: 'claude-sonnet-5-5',
    autonomy: 'approve',
    on: true,
    runsToday: 3,
    monthCost: 204.9,
    budget: 300,
    success: 0.95,
    perMergedPr: null,
    owner: 'mara',
    prompt: 'v9',
  },
  {
    id: 'a-planner',
    role: 'Sprint planning',
    model: 'claude-sonnet-5-5',
    fallback: 'claude-haiku-4-5',
    autonomy: 'suggest',
    on: true,
    runsToday: 1,
    monthCost: 22.1,
    budget: 60,
    success: 0.97,
    perMergedPr: null,
    owner: 'mara',
    prompt: 'v4',
  },
  {
    id: 'a-security',
    role: 'Security',
    model: 'claude-sonnet-5-5',
    fallback: 'claude-haiku-4-5',
    autonomy: 'scoped',
    on: false,
    runsToday: 0,
    monthCost: 61.3,
    budget: 120,
    success: 0.79,
    perMergedPr: 2.1,
    owner: 'ole',
    prompt: 'v6',
  },
];

export const ACTION_RULES: { action: string; rule: 'never' | 'approve' | 'allowed' }[] = [
  { action: 'Read files in scope', rule: 'allowed' },
  { action: 'Write files in scope', rule: 'allowed' },
  { action: 'Run shell commands', rule: 'approve' },
  { action: 'Run database migrations', rule: 'approve' },
  { action: 'Push a branch', rule: 'allowed' },
  { action: 'Open a pull request', rule: 'allowed' },
  { action: 'Merge', rule: 'never' },
  { action: 'Deploy', rule: 'never' },
  { action: 'Call an external API', rule: 'approve' },
  { action: 'Spend more than €5 in one run', rule: 'approve' },
];

export const TOOLS = [
  { name: 'Files (read, write, search)', server: 'built-in', on: true },
  { name: 'Shell in sandbox', server: 'built-in', on: true },
  { name: 'Git', server: 'built-in', on: true },
  { name: 'Orqiva tasks and comments', server: 'Orqiva MCP', on: true },
  { name: 'Code map and fingerprints', server: 'Orqiva MCP', on: true },
  { name: 'Figma designs', server: 'Figma MCP', on: true },
  { name: 'Browser (Playwright)', server: 'Playwright MCP', on: false },
  { name: 'Sentry issues', server: 'Sentry MCP', on: false },
];

export const PROMPT_DIFF = [
  {
    kind: 'same' as const,
    text: 'You implement one task at a time and keep every change inside its scope.',
  },
  { kind: 'del' as const, text: 'Write tests when the task asks for them.' },
  {
    kind: 'add' as const,
    text: 'Write or update tests for every change; run them before you push.',
  },
  {
    kind: 'same' as const,
    text: 'Put the fingerprint of the task on every file and block you write.',
  },
  {
    kind: 'add' as const,
    text: 'Use only tokens and components from the project’s UI kit for any UI.',
  },
];

export const TRACE = [
  {
    name: 'Plan the change',
    kind: 'model',
    start: 0,
    dur: 6.2,
    tokens: '8.1k in · 1.2k out',
    cost: 0.21,
  },
  {
    name: 'read_file src/dispatch/route.ts',
    kind: 'tool',
    start: 6.2,
    dur: 0.1,
    tokens: '',
    cost: 0,
  },
  {
    name: 'read_page ADR-007 (Documents)',
    kind: 'tool',
    start: 6.3,
    dur: 0.2,
    tokens: '',
    cost: 0,
  },
  {
    name: 'Write the timeout handling',
    kind: 'model',
    start: 6.5,
    dur: 11.8,
    tokens: '14.6k in · 3.4k out · 9.2k cached',
    cost: 0.44,
  },
  {
    name: 'write_file src/dispatch/route.ts',
    kind: 'tool',
    start: 18.3,
    dur: 0.1,
    tokens: '',
    cost: 0,
  },
  { name: 'shell: npm test -- route', kind: 'tool', start: 18.4, dur: 21.7, tokens: '', cost: 0 },
  {
    name: 'Fix the failing test',
    kind: 'model',
    start: 40.1,
    dur: 7.9,
    tokens: '18.2k in · 1.1k out · 14k cached',
    cost: 0.19,
  },
  { name: 'shell: npm test -- route', kind: 'tool', start: 48, dur: 19.6, tokens: '', cost: 0 },
  {
    name: 'git push agent/nwl-188-timeout',
    kind: 'tool',
    start: 67.6,
    dur: 2.1,
    tokens: '',
    cost: 0,
  },
];

export const COST_MATRIX: { agent: string; byProject: Record<string, number>; waste: number }[] = [
  {
    agent: 'a-coder',
    byProject: { NWL: 241.3, HEL: 288.6, NWD: 51.2, AUR: 0, PE: 31.3 },
    waste: 48.2,
  },
  {
    agent: 'a-reviewer',
    byProject: { NWL: 52.1, HEL: 49.8, NWD: 18.4, AUR: 0, PE: 20.9 },
    waste: 3.1,
  },
  { agent: 'a-tester', byProject: { NWL: 31.0, HEL: 37.2, NWD: 20.5, AUR: 0, PE: 0 }, waste: 6.4 },
  {
    agent: 'a-analyst',
    byProject: { NWL: 54.7, HEL: 61.0, NWD: 0, AUR: 39.8, PE: 49.4 },
    waste: 2.2,
  },
  { agent: 'a-planner', byProject: { NWL: 6.1, HEL: 5.9, NWD: 2.8, AUR: 1.5, PE: 5.8 }, waste: 0 },
  { agent: 'a-security', byProject: { NWL: 13.5, HEL: 69.7, NWD: 8.4, AUR: 0, PE: 0 }, waste: 9.8 },
];

// ── people ───────────────────────────────────────────────────────────────────────────────────────────────
export const MEMBERS = [
  {
    id: 'ada',
    role: 'Owner',
    team: 'Platform',
    projects: 'all',
    mfa: 'passkey',
    last: 'now',
    seat: 'full',
  },
  {
    id: 'mara',
    role: 'Admin',
    team: 'Delivery',
    projects: 'all',
    mfa: 'authenticator',
    last: 'now',
    seat: 'full',
  },
  {
    id: 'jonas',
    role: 'Member',
    team: 'Delivery',
    projects: 'HEL, PE',
    mfa: 'authenticator',
    last: '5 min',
    seat: 'full',
  },
  {
    id: 'lea',
    role: 'Member',
    team: 'Delivery',
    projects: 'NWL, AUR',
    mfa: 'passkey',
    last: 'now',
    seat: 'full',
  },
  {
    id: 'tim',
    role: 'Member',
    team: 'Mobile',
    projects: 'NWL, NWD',
    mfa: 'none',
    last: '2 days',
    seat: 'full',
  },
  {
    id: 'sara',
    role: 'Tester',
    team: 'Quality',
    projects: 'NWL, HEL, NWD',
    mfa: 'authenticator',
    last: 'now',
    seat: 'full',
  },
  {
    id: 'nico',
    role: 'Designer',
    team: 'Design',
    projects: 'all',
    mfa: 'none',
    last: '1 day',
    seat: 'full',
  },
  {
    id: 'ole',
    role: 'Admin',
    team: 'Platform',
    projects: 'all',
    mfa: 'passkey',
    last: 'now',
    seat: 'full',
  },
  {
    id: 'c-kai',
    role: 'Client · approver',
    team: 'Nordwind',
    projects: 'NWL, NWD',
    mfa: 'authenticator',
    last: 'today',
    seat: 'client (free)',
  },
  {
    id: 'c-ines',
    role: 'Client · approver',
    team: 'Helio',
    projects: 'HEL',
    mfa: 'authenticator',
    last: 'today',
    seat: 'client (free)',
  },
  {
    id: 'c-paul',
    role: 'Client · viewer',
    team: 'Aurum',
    projects: 'AUR',
    mfa: 'passkey',
    last: '3 days',
    seat: 'client (free)',
  },
];

export const PERMISSIONS = [
  'Create and edit tasks',
  'Delete tasks',
  'Start agent runs',
  'Approve agent actions',
  'Change agent settings',
  'Sign gates',
  'Deploy to production',
  'See costs',
  'Manage people',
  'Manage billing',
];

export const ROLE_MATRIX: Record<string, boolean[]> = {
  Owner: [true, true, true, true, true, true, true, true, true, true],
  Admin: [true, true, true, true, true, true, true, true, true, false],
  Member: [true, false, true, true, false, false, false, false, false, false],
  Tester: [true, false, true, false, false, false, false, false, false, false],
  'Client · approver': [false, false, false, false, false, true, false, false, false, false],
};

// ── tokens and costs ─────────────────────────────────────────────────────────────────────────────────────
export const SPEND_DAYS = [
  31, 38, 42, 29, 12, 9, 44, 51, 39, 47, 58, 11, 8, 46, 49, 52, 61, 133, 14, 10, 48, 50, 41, 39, 47,
  12, 9, 55, 49, 51, 47.6,
];

export const PRICES = [
  { model: 'claude-opus-5-5', input: 4.6, output: 23.0, cacheRead: 0.46, from: '1 Sep 2026' },
  { model: 'claude-sonnet-5-5', input: 2.76, output: 13.8, cacheRead: 0.28, from: '1 Sep 2026' },
  { model: 'claude-haiku-4-5', input: 0.92, output: 4.6, cacheRead: 0.09, from: '1 Aug 2026' },
];

export const PROVIDER_KEYS = [
  {
    provider: 'Anthropic',
    scope: 'Workspace',
    key: 'sk-ant-…7Qa2',
    health: 'ok',
    limit: '61 % of rate limit',
    added: 'Ada',
  },
  {
    provider: 'Anthropic',
    scope: 'Project HEL (client pays)',
    key: 'sk-ant-…m9Xk',
    health: 'ok',
    limit: '12 %',
    added: 'Mara',
  },
  {
    provider: 'OpenAI',
    scope: 'Workspace (fallback only)',
    key: 'sk-…4Lr0',
    health: 'unused 30 days',
    limit: '—',
    added: 'Ada',
  },
];

export const ACCESS_TOKENS = [
  {
    name: 'orq CLI on Lea’s laptop',
    kind: 'Personal',
    owner: 'lea',
    scopes: 'tasks:write, loop:write · NWL, AUR',
    expires: '12 Dec',
    last: '2 min ago · 10.0.4.22',
    state: 'ok',
  },
  {
    name: 'GitHub Actions – fleet-portal',
    kind: 'Service account',
    owner: 'ole',
    scopes: 'tests:write, scans:write · NWL',
    expires: 'OIDC, 1 h',
    last: '09:40 · GitHub',
    state: 'ok',
  },
  {
    name: 'Runner build-box',
    kind: 'Runner',
    owner: 'ole',
    scopes: 'deploys · NWL, HEL',
    expires: '31 Dec',
    last: 'now · 10.0.9.4',
    state: 'ok',
  },
  {
    name: 'Old import script',
    kind: 'Personal',
    owner: 'tim',
    scopes: 'items:write · all projects',
    expires: 'in 6 days',
    last: '97 days ago',
    state: 'stale',
  },
  {
    name: 'Tim’s test token',
    kind: 'Personal',
    owner: 'tim',
    scopes: 'admin',
    expires: 'revoked 2 Oct',
    last: 'found in a commit',
    state: 'leaked',
  },
];

// ── activity ─────────────────────────────────────────────────────────────────────────────────────────────
export interface Ev {
  i: number;
  t: string;
  minute: number;
  who: string;
  verb: string;
  object: string;
  project: string;
  kind: 'task' | 'code' | 'agent' | 'test' | 'deploy' | 'security' | 'client' | 'doc';
  repeat?: number;
}

const WHO = [
  'lea',
  'a-coder',
  'sara',
  'jonas',
  'a-reviewer',
  'mara',
  'a-tester',
  'ole',
  'c-kai',
  'tim',
  'a-security',
  'nico',
];
const KINDS: Ev['kind'][] = [
  'code',
  'agent',
  'test',
  'task',
  'code',
  'task',
  'test',
  'deploy',
  'client',
  'task',
  'security',
  'doc',
];
const VERBS: Record<Ev['kind'], string[]> = {
  task: ['moved', 'commented on', 'created', 'estimated', 'assigned'],
  code: ['pushed to', 'opened a pull request for', 'merged'],
  agent: ['finished a step on', 'asked for approval on', 'started'],
  test: ['passed', 'failed', 'recorded evidence on'],
  deploy: ['deployed', 'rolled back', 'promoted'],
  security: ['found', 'fixed', 'accepted the risk of'],
  client: ['approved', 'requested', 'commented on'],
  doc: ['edited', 'approved', 'read'],
};
const OBJECTS = [
  'NWL-188',
  'HEL-212',
  'NWL-191',
  'AUR-4',
  'C-412',
  'v1.4.0-rc.2',
  'F-79',
  'ADR-007',
  'CR-9',
  'NWL-196',
  'HEL-224',
  'PE-12',
];
const PROJ = ['NWL', 'HEL', 'NWL', 'AUR', 'NWL', 'NWL', 'NWL', 'NWL', 'HEL', 'NWL', 'HEL', 'PE'];

/** A deterministic stream of `n` events, newest first, spread over the last 24 hours. */
export function events(n: number): Ev[] {
  const out: Ev[] = [];
  let seed = 7;
  // xorshift: the low bits of a plain linear generator repeat, which made every kind look the same
  const rnd = (m: number): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % m;
  };
  // a working day: busy from 8 to 18, quiet at night; hour 0 is the hour before now (09:59)
  const weight = (hoursAgo: number): number => {
    const clock = (((9 - hoursAgo) % 24) + 24) % 24;
    return clock >= 8 && clock <= 18
      ? clock === 11 || clock === 15
        ? 9
        : 6
      : clock >= 6 && clock <= 21
        ? 2
        : 0.4;
  };
  const cum: number[] = [];
  let sum = 0;
  for (let h = 0; h < 24; h++) cum.push((sum += weight(h)));
  const minuteOf = (u: number): number => {
    const target = u * sum;
    const h = cum.findIndex((c) => c >= target);
    const before = h > 0 ? (cum[h - 1] ?? 0) : 0;
    return h * 60 + Math.floor(((target - before) / Math.max(0.0001, weight(h))) * 60);
  };
  for (let i = 0; i < n; i++) {
    const k = rnd(12);
    const kind = KINDS[k] ?? 'task';
    const verbs = VERBS[kind];
    const minute = Math.min(1439, minuteOf(i / n));
    const h = 9 - Math.floor(minute / 60);
    const hh = ((h % 24) + 24) % 24;
    out.push({
      i,
      t: String(hh).padStart(2, '0') + ':' + String(59 - (minute % 60)).padStart(2, '0'),
      minute,
      who: WHO[rnd(12)] ?? 'lea',
      verb: verbs[rnd(verbs.length)] ?? 'changed',
      object: OBJECTS[k] ?? 'NWL-1',
      project: PROJ[k] ?? 'NWL',
      kind,
      ...(kind === 'agent' && rnd(5) === 0 ? { repeat: 12 + rnd(40) } : {}),
    });
  }
  return out;
}

// ── insights ─────────────────────────────────────────────────────────────────────────────────────────────
export const THROUGHPUT = [
  { week: 'W33', human: 21, agent: 14 },
  { week: 'W34', human: 24, agent: 17 },
  { week: 'W35', human: 19, agent: 22 },
  { week: 'W36', human: 23, agent: 25 },
  { week: 'W37', human: 22, agent: 29 },
  { week: 'W38', human: 20, agent: 31 },
  { week: 'W39', human: 24, agent: 33 },
  { week: 'W40', human: 21, agent: 36 },
];

export const INTEGRATIONS = [
  { name: 'GitHub', what: '4 repositories, webhooks and checks', state: 'connected' },
  { name: 'Gitea', what: 'self-hosted mirror', state: 'connected' },
  { name: 'Slack', what: 'notifications to #nordwind, #helio', state: 'connected' },
  { name: 'Microsoft Teams', what: 'notifications for Aurum', state: 'not connected' },
  { name: 'Figma', what: 'NWL and HEL design files', state: 'connected' },
  { name: 'Sentry', what: 'errors to incidents', state: 'not connected' },
  { name: 'Google Calendar', what: 'reviews, absences', state: 'connected' },
  { name: 'E-mail in', what: 'requests@broszio.dev → client requests', state: 'connected' },
  { name: 'Anthropic', what: 'model provider', state: 'connected' },
  { name: 'Stripe', what: 'billing', state: 'test mode' },
];
