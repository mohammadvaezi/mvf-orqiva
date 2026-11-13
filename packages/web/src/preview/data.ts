// ── [PCODE-200 | S15 | v0.1.0] T16.4 Handover screens: design preview, team Handover tab, portal Handover section with signature ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-154 | S15 | v0.1.0] D2 preview: Ideation, Planning and Canvas ──
// ── [PCODE-153 | S15 | v0.1.0] D1 preview: design system v2, shell, Cmd-K, Home, Inbox, project overview ──
//    Why:  the sample world the preview is drawn with: one engineering department working for several
//          clients on several projects, with people and agents side by side. Nothing here comes from the
//          server; every figure is invented but plausible, so the owner can judge the screens with
//          realistic density. Money is in euro.

export type Health = 'on-track' | 'at-risk' | 'late';
export type Role = 'developer' | 'lead' | 'admin' | 'tester' | 'client';

export interface Person {
  id: string;
  name: string;
  initials: string;
  title: string;
  /** 1..6, picks the avatar colour */
  tone: number;
  kind: 'human' | 'agent' | 'client';
  clientId?: string;
  online?: boolean;
  /** where they are right now, for presence */
  where?: string;
}

export interface Client {
  id: string;
  name: string;
  short: string;
  tone: number;
  owner: string;
  health: Health;
  openRequests: number;
  slaBreaches: number;
  revenueYtd: number;
  csat: number;
}

export interface Phase {
  key: string;
  label: string;
  /** 0..100 */
  done: number;
  state: 'done' | 'active' | 'next' | 'later';
}

export interface Project {
  key: string;
  name: string;
  clientId: string | null;
  lead: string;
  health: Health;
  healthNote: string;
  phase: string;
  sprint: { name: string; day: number; days: number; goal: string; done: number; total: number };
  milestone: { name: string; date: string; daysLeft: number };
  budget: { used: number; total: number; ai: number };
  quality: {
    tests: number;
    testsTotal: number;
    findings: number;
    critical: number;
    coverage: number;
  };
  team: string[];
  agents: string[];
  version: string;
  phases: Phase[];
  burndown: number[];
  ideal: number[];
  risks: { text: string; level: 'high' | 'medium' | 'low'; owner: string }[];
  next: { text: string; date: string }[];
}

export type InboxKind =
  'approval' | 'review' | 'mention' | 'question' | 'signoff' | 'request' | 'test' | 'incident';

export interface InboxItem {
  id: string;
  kind: InboxKind;
  project: string;
  from: string;
  title: string;
  detail: string;
  age: string;
  /** minutes ago, for sorting */
  minutes: number;
  unread: boolean;
  priority: 'urgent' | 'high' | 'normal';
  ref?: string;
  cost?: number;
  due?: string;
  roles: Role[];
}

export interface ActivityItem {
  id: string;
  who: string;
  text: string;
  project: string;
  at: string;
  kind: 'code' | 'agent' | 'test' | 'deploy' | 'review' | 'client' | 'security' | 'plan';
}

export interface Task {
  ref: string;
  title: string;
  project: string;
  state: 'Backlog' | 'Todo' | 'In Progress' | 'Review' | 'Test' | 'Blocked' | 'Done';
  assignee: string;
  points: number;
  due?: string;
}

export const WORKSPACE = {
  name: 'Broszio Engineering',
  plan: 'Business',
  seats: 18,
  seatsUsed: 14,
};

export const CLIENTS: Client[] = [
  {
    id: 'nwl',
    name: 'Nordwind Logistik GmbH',
    short: 'Nordwind',
    tone: 3,
    owner: 'mara',
    health: 'on-track',
    openRequests: 6,
    slaBreaches: 0,
    revenueYtd: 184_200,
    csat: 4.7,
  },
  {
    id: 'hel',
    name: 'Helio Health AG',
    short: 'Helio',
    tone: 5,
    owner: 'jonas',
    health: 'at-risk',
    openRequests: 11,
    slaBreaches: 2,
    revenueYtd: 126_900,
    csat: 4.1,
  },
  {
    id: 'aur',
    name: 'Aurum Privatbank',
    short: 'Aurum',
    tone: 4,
    owner: 'mara',
    health: 'on-track',
    openRequests: 3,
    slaBreaches: 0,
    revenueYtd: 241_500,
    csat: 4.8,
  },
];

export const PEOPLE: Person[] = [
  {
    id: 'mara',
    name: 'Mara Schulz',
    initials: 'MS',
    title: 'Engineering lead',
    tone: 1,
    kind: 'human',
    online: true,
    where: 'NWL Planning',
  },
  {
    id: 'jonas',
    name: 'Jonas Becker',
    initials: 'JB',
    title: 'Senior developer',
    tone: 2,
    kind: 'human',
    online: true,
    where: 'HEL-212 in VS Code',
  },
  {
    id: 'lea',
    name: 'Lea Wagner',
    initials: 'LW',
    title: 'Developer',
    tone: 3,
    kind: 'human',
    online: true,
    where: 'AUR Code map',
  },
  {
    id: 'tim',
    name: 'Tim Hoffmann',
    initials: 'TH',
    title: 'Developer',
    tone: 4,
    kind: 'human',
    online: false,
  },
  {
    id: 'sara',
    name: 'Sara Yilmaz',
    initials: 'SY',
    title: 'QA engineer',
    tone: 5,
    kind: 'human',
    online: true,
    where: 'HEL Test run 41',
  },
  {
    id: 'nico',
    name: 'Nico Brandt',
    initials: 'NB',
    title: 'Product designer',
    tone: 6,
    kind: 'human',
    online: false,
  },
  {
    id: 'ada',
    name: 'Ada Krüger',
    initials: 'AK',
    title: 'Workspace admin',
    tone: 1,
    kind: 'human',
    online: true,
    where: 'People',
  },
  {
    id: 'ole',
    name: 'Ole Petersen',
    initials: 'OP',
    title: 'DevOps engineer',
    tone: 2,
    kind: 'human',
    online: true,
    where: 'Releases',
  },
  {
    id: 'a-analyst',
    name: 'Analyst',
    initials: 'AN',
    title: 'Agent · requirements',
    tone: 5,
    kind: 'agent',
  },
  {
    id: 'a-planner',
    name: 'Planner',
    initials: 'PL',
    title: 'Agent · sprint planning',
    tone: 1,
    kind: 'agent',
  },
  {
    id: 'a-coder',
    name: 'Coder',
    initials: 'CO',
    title: 'Agent · implementation',
    tone: 3,
    kind: 'agent',
  },
  {
    id: 'a-reviewer',
    name: 'Reviewer',
    initials: 'RV',
    title: 'Agent · code review',
    tone: 4,
    kind: 'agent',
  },
  {
    id: 'a-tester',
    name: 'Tester',
    initials: 'TE',
    title: 'Agent · test design',
    tone: 2,
    kind: 'agent',
  },
  {
    id: 'a-security',
    name: 'Sentinel',
    initials: 'SE',
    title: 'Agent · security',
    tone: 6,
    kind: 'agent',
  },
  {
    id: 'c-kai',
    name: 'Kai Lorenz',
    initials: 'KL',
    title: 'Product owner · Nordwind',
    tone: 3,
    kind: 'client',
    clientId: 'nwl',
  },
  {
    id: 'c-ines',
    name: 'Ines Vogel',
    initials: 'IV',
    title: 'Head of digital · Helio',
    tone: 5,
    kind: 'client',
    clientId: 'hel',
  },
  {
    id: 'c-paul',
    name: 'Paul Richter',
    initials: 'PR',
    title: 'CTO · Aurum',
    tone: 4,
    kind: 'client',
    clientId: 'aur',
  },
];

export const person = (id: string): Person =>
  PEOPLE.find((p) => p.id === id) ?? {
    id,
    name: id,
    initials: '?',
    title: '',
    tone: 1,
    kind: 'human',
  };

export const client = (id: string | null): Client | undefined => CLIENTS.find((c) => c.id === id);

const phases = (active: number, doneOfActive: number): Phase[] =>
  [
    ['ideation', 'Ideation'],
    ['planning', 'Planning'],
    ['build', 'Build'],
    ['test', 'Test'],
    ['release', 'Release'],
  ].map(([key = '', label = ''], i) => ({
    key,
    label,
    done: i < active ? 100 : i === active ? doneOfActive : 0,
    state: i < active ? 'done' : i === active ? 'active' : i === active + 1 ? 'next' : 'later',
  }));

export const PROJECTS: Project[] = [
  {
    key: 'NWL',
    name: 'Fleet portal',
    clientId: 'nwl',
    lead: 'mara',
    health: 'on-track',
    healthNote: 'Sprint goal on track; 2 days ahead of the milestone plan.',
    phase: 'Build',
    sprint: {
      name: 'Sprint 14',
      day: 6,
      days: 10,
      goal: 'Dispatchers can re-route a tour live',
      done: 21,
      total: 34,
    },
    milestone: { name: 'Pilot with 40 trucks', date: '30 Oct', daysLeft: 26 },
    budget: { used: 61_400, total: 120_000, ai: 3_940 },
    quality: { tests: 412, testsTotal: 431, findings: 4, critical: 0, coverage: 81 },
    team: ['mara', 'lea', 'tim', 'sara'],
    agents: ['a-coder', 'a-reviewer', 'a-tester'],
    version: 'v1.4.0',
    phases: phases(2, 64),
    burndown: [34, 33, 30, 28, 24, 21, 13],
    ideal: [34, 30.6, 27.2, 23.8, 20.4, 17, 13.6, 10.2, 6.8, 3.4, 0],
    risks: [
      { text: 'Map provider rate limit during the pilot', level: 'medium', owner: 'lea' },
      { text: 'Driver app release depends on store review', level: 'low', owner: 'tim' },
    ],
    next: [
      { text: 'Sprint 14 review with Nordwind', date: 'Thu 9 Oct' },
      { text: 'G3 security gate', date: 'Mon 13 Oct' },
    ],
  },
  {
    key: 'HEL',
    name: 'Patient app',
    clientId: 'hel',
    lead: 'jonas',
    health: 'at-risk',
    healthNote: 'Two change requests added 13 points mid-sprint; G3 waits for a critical finding.',
    phase: 'Test',
    sprint: {
      name: 'Sprint 9',
      day: 8,
      days: 10,
      goal: 'Appointment booking passes acceptance',
      done: 18,
      total: 41,
    },
    milestone: { name: 'App store release', date: '17 Oct', daysLeft: 13 },
    budget: { used: 88_300, total: 95_000, ai: 6_120 },
    quality: { tests: 238, testsTotal: 279, findings: 9, critical: 1, coverage: 67 },
    team: ['jonas', 'sara', 'nico'],
    agents: ['a-coder', 'a-tester', 'a-security'],
    version: 'v2.0.0-rc.3',
    phases: phases(3, 52),
    burndown: [28, 28, 41, 39, 34, 30, 27, 23],
    ideal: [28, 25.2, 22.4, 19.6, 16.8, 14, 11.2, 8.4, 5.6, 2.8, 0],
    risks: [
      { text: 'Critical finding in the booking API (token in log)', level: 'high', owner: 'jonas' },
      { text: 'Budget at 93 % with 2 sprints left', level: 'high', owner: 'mara' },
      { text: 'Client UAT testers not yet assigned', level: 'medium', owner: 'sara' },
    ],
    next: [
      { text: 'Client acceptance test, round 2', date: 'Wed 8 Oct' },
      { text: 'Release v2.0.0', date: 'Fri 17 Oct' },
    ],
  },
  {
    key: 'AUR',
    name: 'Payments API',
    clientId: 'aur',
    lead: 'mara',
    health: 'on-track',
    healthNote: 'Planning approved; Planner proposed Sprint 1, waiting for your acceptance.',
    phase: 'Planning',
    sprint: {
      name: 'Sprint 1',
      day: 1,
      days: 10,
      goal: 'SEPA instant transfers end to end',
      done: 0,
      total: 29,
    },
    milestone: { name: 'Sandbox for Aurum devs', date: '14 Nov', daysLeft: 41 },
    budget: { used: 14_900, total: 210_000, ai: 820 },
    quality: { tests: 0, testsTotal: 0, findings: 0, critical: 0, coverage: 0 },
    team: ['mara', 'lea', 'ole'],
    agents: ['a-analyst', 'a-planner', 'a-security'],
    version: '—',
    phases: phases(1, 70),
    burndown: [29],
    ideal: [29, 26.1, 23.2, 20.3, 17.4, 14.5, 11.6, 8.7, 5.8, 2.9, 0],
    risks: [{ text: 'PSD2 audit evidence needed before G2', level: 'medium', owner: 'ada' }],
    next: [
      { text: 'Accept Sprint 1 plan', date: 'Today' },
      { text: 'Kick-off with Aurum', date: 'Tue 7 Oct' },
    ],
  },
  {
    key: 'PE',
    name: 'Orqiva',
    clientId: null,
    lead: 'ada',
    health: 'on-track',
    healthNote: 'Design phase D1 in review.',
    phase: 'Ideation',
    sprint: {
      name: 'Sprint 15',
      day: 2,
      days: 10,
      goal: 'Owner approves D1 shell and navigation',
      done: 5,
      total: 18,
    },
    milestone: { name: 'Gate A1: UI approved', date: '21 Nov', daysLeft: 48 },
    budget: { used: 9_800, total: 60_000, ai: 2_410 },
    quality: { tests: 381, testsTotal: 381, findings: 0, critical: 0, coverage: 88 },
    team: ['ada', 'jonas', 'nico'],
    agents: ['a-coder', 'a-reviewer'],
    version: 'v0.1.0',
    phases: phases(0, 85),
    burndown: [18, 15, 13],
    ideal: [18, 16.2, 14.4, 12.6, 10.8, 9, 7.2, 5.4, 3.6, 1.8, 0],
    risks: [],
    next: [{ text: 'D1 review with the owner', date: 'Mon 6 Oct' }],
  },
  {
    key: 'NWD',
    name: 'Driver app',
    clientId: 'nwl',
    lead: 'tim',
    health: 'late',
    healthNote: 'Store review rejected build 112 (location permission text); 4 days behind.',
    phase: 'Release',
    sprint: {
      name: 'Sprint 6',
      day: 9,
      days: 10,
      goal: 'Store approval for iOS and Android',
      done: 11,
      total: 14,
    },
    milestone: { name: 'Stores live', date: '3 Oct', daysLeft: -1 },
    budget: { used: 52_100, total: 55_000, ai: 2_980 },
    quality: { tests: 190, testsTotal: 196, findings: 2, critical: 0, coverage: 74 },
    team: ['tim', 'sara', 'nico'],
    agents: ['a-coder', 'a-tester'],
    version: 'v1.0.0',
    phases: phases(4, 80),
    burndown: [14, 13, 13, 12, 9, 8, 6, 4, 3],
    ideal: [14, 12.6, 11.2, 9.8, 8.4, 7, 5.6, 4.2, 2.8, 1.4, 0],
    risks: [{ text: 'Second store rejection would move the pilot', level: 'high', owner: 'tim' }],
    next: [{ text: 'Resubmit build 113', date: 'Today' }],
  },
];

export const project = (key: string): Project | undefined => PROJECTS.find((p) => p.key === key);

export const INBOX: InboxItem[] = [
  {
    id: 'i1',
    kind: 'approval',
    project: 'HEL',
    from: 'a-coder',
    title: 'Coder wants to run the migration 0042_booking_slots on staging',
    detail:
      'Action class: run shell on staging. Estimated cost of the remaining run €0.84. The run is paused until you decide.',
    age: '4 min',
    minutes: 4,
    unread: true,
    priority: 'urgent',
    ref: 'HEL-212',
    cost: 0.84,
    roles: ['developer', 'lead'],
  },
  {
    id: 'i2',
    kind: 'signoff',
    project: 'AUR',
    from: 'a-planner',
    title: 'Sprint 1 plan is ready: 14 stories, 29 points',
    detail:
      'Planner filled 29 of 32 points of capacity. 3 stories need an estimate from a person. Accept line by line or all at once.',
    age: '22 min',
    minutes: 22,
    unread: true,
    priority: 'high',
    ref: 'AUR Sprint 1',
    roles: ['lead', 'admin'],
  },
  {
    id: 'i3',
    kind: 'review',
    project: 'NWL',
    from: 'lea',
    title: 'Review: Live re-routing for dispatchers (#318)',
    detail: '+412 −96 in 14 files · 2 AI comments · checks passed · touches API /tours/{id}/route',
    age: '35 min',
    minutes: 35,
    unread: true,
    priority: 'high',
    ref: 'NWL-188',
    roles: ['developer', 'lead'],
  },
  {
    id: 'i4',
    kind: 'question',
    project: 'HEL',
    from: 'a-analyst',
    title: 'Analyst asks: may cancelled appointments be re-booked within 24 h?',
    detail:
      'Open question Q-17 from the interview. Two answers change the scope of HEL-230. You were named as the person who decides.',
    age: '1 h',
    minutes: 60,
    unread: true,
    priority: 'normal',
    ref: 'Q-17',
    roles: ['lead', 'client'],
  },
  {
    id: 'i5',
    kind: 'mention',
    project: 'NWL',
    from: 'sara',
    title: 'Sara mentioned you on NWL-191 Tour export to CSV',
    detail: '“@Mara the export fails above 5 000 rows in Firefox, screen recording attached.”',
    age: '1 h',
    minutes: 75,
    unread: false,
    priority: 'normal',
    ref: 'NWL-191',
    roles: ['developer', 'lead', 'tester'],
  },
  {
    id: 'i6',
    kind: 'request',
    project: 'HEL',
    from: 'c-ines',
    title: 'Change request: add SMS reminders 2 h before appointments',
    detail:
      'Estimate from Analyst: 8 points, €3 400, moves release by 2 days. Client is waiting for your quote.',
    age: '2 h',
    minutes: 130,
    unread: true,
    priority: 'high',
    ref: 'CR-9',
    roles: ['lead', 'admin'],
  },
  {
    id: 'i7',
    kind: 'test',
    project: 'NWD',
    from: 'sara',
    title: 'Assigned to you: 12 cases in run 41 (iOS 18, iPhone 15)',
    detail: 'Exploratory session “store review flow” and 11 regression cases. Due today 17:00.',
    age: '3 h',
    minutes: 180,
    unread: false,
    priority: 'high',
    due: 'Today 17:00',
    roles: ['tester', 'developer'],
  },
  {
    id: 'i8',
    kind: 'incident',
    project: 'NWL',
    from: 'ole',
    title: 'SEV-3 resolved: tour map tiles slow (p95 4.1 s)',
    detail:
      'Suspect change: deploy 1.3.9 at 09:12. Rolled back by Ole. Postmortem draft is ready for review.',
    age: '5 h',
    minutes: 300,
    unread: false,
    priority: 'normal',
    roles: ['lead', 'admin', 'developer'],
  },
  {
    id: 'i9',
    kind: 'signoff',
    project: 'HEL',
    from: 'c-ines',
    title: 'Helio approved the design of “Booking – step 3” v4',
    detail: 'Two pinned comments resolved. The design is linked to HEL-221 and HEL-224.',
    age: 'Yesterday',
    minutes: 1300,
    unread: false,
    priority: 'normal',
    roles: ['lead', 'developer'],
  },
  {
    id: 'i10',
    kind: 'approval',
    project: 'AUR',
    from: 'a-security',
    title: 'Sentinel asks to accept risk: outdated xml parser in a test tool',
    detail:
      'Not reachable from production code. Proposes acceptance for 30 days with you as approver.',
    age: 'Yesterday',
    minutes: 1500,
    unread: false,
    priority: 'normal',
    ref: 'F-77',
    roles: ['lead', 'admin'],
  },
];

export const ACTIVITY: ActivityItem[] = [
  {
    id: 'e1',
    who: 'a-coder',
    text: 'pushed 3 commits to feat/live-route (NWL-188)',
    project: 'NWL',
    at: '09:41',
    kind: 'code',
  },
  {
    id: 'e2',
    who: 'sara',
    text: 'failed step 4 of “Export tours” with a screen recording',
    project: 'NWL',
    at: '09:38',
    kind: 'test',
  },
  {
    id: 'e3',
    who: 'c-ines',
    text: 'opened change request CR-9 SMS reminders',
    project: 'HEL',
    at: '09:20',
    kind: 'client',
  },
  {
    id: 'e4',
    who: 'ole',
    text: 'rolled back staging to 1.3.8',
    project: 'NWL',
    at: '09:15',
    kind: 'deploy',
  },
  {
    id: 'e5',
    who: 'a-planner',
    text: 'proposed Sprint 1 (14 stories, 29 points)',
    project: 'AUR',
    at: '09:02',
    kind: 'plan',
  },
  {
    id: 'e6',
    who: 'a-security',
    text: 'found a critical: token written to the request log',
    project: 'HEL',
    at: '08:51',
    kind: 'security',
  },
  {
    id: 'e7',
    who: 'a-reviewer',
    text: 'left 2 comments on #318',
    project: 'NWL',
    at: '08:47',
    kind: 'review',
  },
  {
    id: 'e8',
    who: 'jonas',
    text: 'moved HEL-212 Booking slots to Review',
    project: 'HEL',
    at: '08:30',
    kind: 'plan',
  },
];

export const MY_TASKS: Task[] = [
  {
    ref: 'NWL-188',
    title: 'Live re-routing for dispatchers',
    project: 'NWL',
    state: 'Review',
    assignee: 'lea',
    points: 8,
  },
  {
    ref: 'NWL-191',
    title: 'Tour export to CSV above 5 000 rows',
    project: 'NWL',
    state: 'In Progress',
    assignee: 'lea',
    points: 3,
    due: 'Wed',
  },
  {
    ref: 'AUR-4',
    title: 'SEPA instant: idempotency keys',
    project: 'AUR',
    state: 'Todo',
    assignee: 'lea',
    points: 5,
  },
  {
    ref: 'HEL-224',
    title: 'Booking step 3 – slot picker',
    project: 'HEL',
    state: 'Blocked',
    assignee: 'lea',
    points: 5,
    due: 'Thu',
  },
  {
    ref: 'NWL-196',
    title: 'Map tiles: cache headers',
    project: 'NWL',
    state: 'Todo',
    assignee: 'lea',
    points: 2,
  },
];

export const AGENTS_LIVE = [
  {
    agent: 'a-coder',
    project: 'NWL',
    task: 'NWL-188',
    what: 'Writing tests for route recalculation',
    step: 14,
    steps: 20,
    cost: 1.92,
  },
  {
    agent: 'a-coder',
    project: 'HEL',
    task: 'HEL-212',
    what: 'Waiting for approval: run migration on staging',
    step: 9,
    steps: 12,
    cost: 2.31,
    waiting: true,
  },
  {
    agent: 'a-tester',
    project: 'NWD',
    task: 'NWD-77',
    what: 'Generating cases from acceptance criteria',
    step: 4,
    steps: 6,
    cost: 0.38,
  },
];

export const SPEND = {
  today: 47.6,
  month: 1_286.4,
  monthBudget: 2_400,
  byProject: [
    { key: 'HEL', value: 512.2 },
    { key: 'NWL', value: 398.7 },
    { key: 'NWD', value: 201.3 },
    { key: 'PE', value: 132.9 },
    { key: 'AUR', value: 41.3 },
  ],
};

export const euro = (n: number, digits = 0): string =>
  new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);

/** The project tabs, in lifecycle order, with the design step that draws each. */
// [PCODE-154 | S15 | v0.1.0] D2 drew Ideation, Planning and Canvas
export const PROJECT_TABS = [
  { key: 'overview', label: 'Overview', step: 'D1' },
  { key: 'ideation', label: 'Ideation', step: 'D2' },
  { key: 'planning', label: 'Planning', step: 'D2' },
  { key: 'canvas', label: 'Canvas', step: 'D2' },
  { key: 'documents', label: 'Documents', step: 'D3' },
  { key: 'uikit', label: 'UI kit', step: 'D3' },
  { key: 'test', label: 'Test', step: 'D3' },
  { key: 'versions', label: 'Versions', step: 'D4' },
  { key: 'security', label: 'Security', step: 'D4' },
  { key: 'codemap', label: 'Code map', step: 'D4' },
  // [PCODE-200 | S15 | v0.1.0] drawn in T16, after the gate
  { key: 'handover', label: 'Handover', step: 'T16' },
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number]['key'];
