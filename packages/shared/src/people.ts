// ── [PCODE-249 | S15 | v0.1.0] T25.4 Alerts and reminders: budgets, anomalies, doc watchers, stale flags and ideas ──
// ── [PCODE-248 | S15 | v0.1.0] T25.3 Custom roles, role conditions and project roles enforced ──
// ── [PCODE-182 | S15 | v0.1.0] B5.3 People live: members, teams, roles, sign-in rules and sessions, access reviews, access checker, offboarding ──
//    Why:  what each built-in role may do, written down once as the server enforces it (the lowest role
//          each kind of request asks for), so the Roles page, the access checker and the docs agree.

export const ROLES = [
  'owner',
  'admin',
  'member',
  'tester',
  'designer',
  'billing',
  'auditor',
  'guest',
] as const;
export type RoleName = (typeof ROLES)[number];

export const ROLE_TEXT: Record<RoleName, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  tester: 'Tester',
  designer: 'Designer',
  billing: 'Billing',
  auditor: 'Auditor',
  guest: 'Guest',
};

/** Each permission and the roles that hold it. */
export const ROLE_PERMISSIONS: { key: string; label: string; roles: readonly RoleName[] }[] = [
  {
    key: 'read',
    label: 'See projects, tasks and documents',
    roles: ['owner', 'admin', 'member', 'tester', 'designer', 'billing', 'auditor', 'guest'],
  },
  {
    key: 'write',
    label: 'Create and change tasks, plans and documents',
    roles: ['owner', 'admin', 'member', 'tester', 'designer'],
  },
  {
    key: 'test',
    label: 'Run tests and record results',
    roles: ['owner', 'admin', 'member', 'tester', 'designer'],
  },
  {
    key: 'agents',
    label: 'Ask agents to work and approve their actions',
    roles: ['owner', 'admin', 'member', 'tester', 'designer'],
  },
  {
    key: 'ship',
    label: 'Plan and ship releases',
    roles: ['owner', 'admin', 'member', 'tester', 'designer'],
  },
  { key: 'risk', label: 'Accept security risks and override policies', roles: ['owner', 'admin'] },
  {
    key: 'agents-admin',
    label: 'Set up agents, providers, prices and budgets',
    roles: ['owner', 'admin'],
  },
  {
    key: 'people',
    label: 'Manage people, roles, tokens and sign-in rules',
    roles: ['owner', 'admin'],
  },
  {
    key: 'money',
    label: 'See costs, licence and invoices',
    roles: ['owner', 'admin', 'member', 'billing'],
  },
  { key: 'owners', label: 'Make or remove owners', roles: ['owner'] },
];

/** Whether a role holds a permission. */
export const roleHas = (role: string, permission: string): boolean =>
  ROLE_PERMISSIONS.find((p) => p.key === permission)?.roles.includes(role as RoleName) ?? false;

// ── [PCODE-248 | S15 | v0.1.0] T25.3 Custom roles, role conditions and project roles enforced ──

/** When a permission of a custom role holds: ISO weekdays (1 Monday … 7 Sunday) and hours [from, to). */
export interface RoleCondition {
  weekdays?: number[];
  hours?: [number, number];
}

const WRITE_TEST = ['test-runs', 'test-cases', 'test-plans', 'test-suites', 'results', 'testlab'];
const WRITE_AGENTS = ['agent-runs', 'approvals', 'agent-actions'];
const WRITE_SHIP = ['releases', 'deploys', 'environments', 'trains', 'promotions', 'versions'];
const WRITE_RISK = ['risk-acceptances', 'exceptions', 'policy-overrides'];
const ADMIN_PEOPLE = [
  'members',
  'roles',
  'teams',
  'invitations',
  'security',
  'access-tokens',
  'access-reviews',
  'sessions',
  'offboarding',
  'project-members',
];
const ADMIN_AGENTS = ['agents', 'ai', 'model-prices', 'prices', 'budgets', 'provider-keys'];
const MONEY = ['ai-spend', 'costs', 'invoices', 'licence', 'billing', 'budgets'];

/**
 * The permission a request needs, from its method, its path inside the workspace and the lowest role
 * the route asks for; null when the base role alone decides (searches and reads that are POSTs, the
 * person's own things).
 */
export function permissionFor(method: string, path: string, min: string): string | null {
  const rest =
    path
      .split('?')[0]
      ?.replace(/^\/api\/workspaces\/[^/]+/, '')
      .split('/')
      .filter(Boolean) ?? [];
  const has = (words: readonly string[]): boolean => rest.some((s) => words.includes(s));
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return has(MONEY) ? 'money' : 'read';
  if (rest.at(-1) === 'search' || rest.at(-1) === 'query') return null;
  // the person's own things: their tokens, inbox, notification rules, devices and settings
  // [PCODE-249 | S15 | v0.1.0] and the pages they watch
  if (
    has([
      'access-tokens',
      'inbox',
      'notification-rules',
      'push',
      'devices',
      'me',
      'presence',
      'watch',
    ])
  )
    return null;
  if (min === 'owner') return 'owners';
  if (min === 'admin') {
    if (has(ADMIN_PEOPLE)) return 'people';
    if (has(ADMIN_AGENTS)) return 'agents-admin';
    if (has(WRITE_RISK)) return 'risk';
    return null;
  }
  if (has(WRITE_RISK)) return 'risk';
  if (has(WRITE_TEST)) return 'test';
  if (has(WRITE_AGENTS)) return 'agents';
  if (has(WRITE_SHIP)) return 'ship';
  return 'write';
}

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hh = (h: number): string => String(h).padStart(2, '0') + ':00';

/** "Mon–Fri 08:00–18:00": when a condition holds, in words. */
export function conditionText(c: RoleCondition): string {
  const days = [...(c.weekdays ?? [])].sort((a, b) => a - b);
  const run =
    days.length > 1 && days.every((d, i) => i === 0 || d === (days[i - 1] ?? 0) + 1)
      ? (DAY[days[0] ?? 0] ?? '') + '–' + (DAY[days.at(-1) ?? 0] ?? '')
      : days.map((d) => DAY[d] ?? '').join(', ');
  const hours = c.hours ? hh(c.hours[0]) + '–' + hh(c.hours[1]) : '';
  return [days.length ? run : '', hours].filter(Boolean).join(' ') || 'always';
}

/** Whether the condition holds at the weekday (ISO) and hour given. */
export function conditionHolds(c: RoleCondition, weekday: number, hour: number): boolean {
  if (c.weekdays?.length && !c.weekdays.includes(weekday)) return false;
  if (c.hours && !(hour >= c.hours[0] && hour < c.hours[1])) return false;
  return true;
}

/** What is wrong with the conditions of a role, or null. */
export function conditionsProblem(conditions: Record<string, unknown>): string | null {
  for (const [key, v] of Object.entries(conditions)) {
    if (!ROLE_PERMISSIONS.some((p) => p.key === key)) return 'There is no permission ' + key;
    if (!v || typeof v !== 'object') return 'A condition is weekdays and hours';
    const c = v as Record<string, unknown>;
    const days = c['weekdays'];
    const hours = c['hours'];
    if (
      days !== undefined &&
      (!Array.isArray(days) ||
        !days.length ||
        !days.every((d) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7))
    )
      return 'Weekdays are 1 (Monday) to 7 (Sunday)';
    if (
      hours !== undefined &&
      (!Array.isArray(hours) ||
        hours.length !== 2 ||
        !hours.every((h) => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 24) ||
        (hours[0] as number) >= (hours[1] as number))
    )
      return 'Hours are [from, to] between 0 and 24, from before to';
  }
  return null;
}
