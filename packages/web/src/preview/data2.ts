// ── [PCODE-154 | S15 | v0.1.0] D2 preview: Ideation, Planning and Canvas ──
//    Why:  the sample data behind the Ideation, Planning and Canvas designs: ideas with their sources,
//          interview, requirements and PRD versions; a sprint with a ranked backlog, an AI draft and a
//          retro; and a schedule with WBS, dependencies, baselines and resources. Task references take the
//          project's key, so every project shows the same shapes with its own name.

export type State = 'Backlog' | 'Todo' | 'In Progress' | 'Review' | 'Test' | 'Blocked' | 'Done';

export interface PTask {
  n: number;
  title: string;
  epic: string;
  state: State;
  assignee: string;
  points: number | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  type: 'story' | 'bug' | 'task' | 'spike';
  ready: boolean;
  carried?: number;
  added?: boolean;
  pr?: string;
  blockedBy?: number;
  criteria: { text: string; done: boolean }[];
  subtasks?: { text: string; done: boolean }[];
}

export const EPICS = [
  { key: 'E1', name: 'Live dispatching', tone: 1 },
  { key: 'E2', name: 'Tour data and exports', tone: 3 },
  { key: 'E3', name: 'Pilot readiness', tone: 5 },
  { key: 'E4', name: 'Platform and security', tone: 4 },
];

const ac = (...t: string[]): { text: string; done: boolean }[] =>
  t.map((text, i) => ({ text, done: i === 0 }));

export const TASKS: PTask[] = [
  {
    n: 188,
    title: 'Live re-routing for dispatchers',
    epic: 'E1',
    state: 'Review',
    assignee: 'lea',
    points: 4,
    priority: 'high',
    type: 'story',
    ready: true,
    pr: '#318',
    criteria: ac(
      'Given a tour in progress, when the dispatcher drags a stop, then the route recalculates in under 2 s',
      'Drivers see the new route within 10 s',
      'Every change is in the tour history',
    ),
    subtasks: [
      { text: 'Routing call with timeout', done: true },
      { text: 'Push to driver app', done: true },
      { text: 'History entry', done: false },
    ],
  },
  {
    n: 189,
    title: 'Traffic layer on the dispatch map',
    epic: 'E1',
    state: 'In Progress',
    assignee: 'a-coder',
    points: 3,
    priority: 'medium',
    type: 'story',
    ready: true,
    criteria: ac('Traffic shown for the visible area', 'Toggle remembered per dispatcher'),
  },
  {
    n: 190,
    title: 'ETA recalculation after a delay',
    epic: 'E1',
    state: 'Backlog',
    assignee: 'tim',
    points: 5,
    priority: 'high',
    type: 'story',
    ready: true,
    criteria: ac(
      'ETA updates when a stop is late by more than 5 min',
      'Customer notification is sent once',
    ),
  },
  {
    n: 191,
    title: 'Tour export to CSV above 5 000 rows',
    epic: 'E2',
    state: 'In Progress',
    assignee: 'lea',
    points: 2,
    priority: 'high',
    type: 'bug',
    ready: true,
    carried: 1,
    criteria: ac('Exports of 50 000 rows finish in under 20 s', 'Works in Firefox, Chrome, Edge'),
  },
  {
    n: 192,
    title: 'Daily tour report as PDF',
    epic: 'E2',
    state: 'Done',
    assignee: 'a-coder',
    points: 3,
    priority: 'medium',
    type: 'story',
    ready: true,
    criteria: ac('One page per tour', 'Logo and colours of the client'),
  },
  {
    n: 193,
    title: 'Driver hours from telematics',
    epic: 'E2',
    state: 'Blocked',
    assignee: 'tim',
    points: 2,
    priority: 'medium',
    type: 'story',
    ready: true,
    blockedBy: 199,
    criteria: ac('Hours imported every 15 min'),
  },
  {
    n: 194,
    title: 'Pilot onboarding checklist for 40 trucks',
    epic: 'E3',
    state: 'Backlog',
    assignee: 'mara',
    points: 2,
    priority: 'medium',
    type: 'task',
    ready: true,
    criteria: ac('Checklist signed by Nordwind'),
  },
  {
    n: 195,
    title: 'Load test: 400 dispatch events per second',
    epic: 'E3',
    state: 'Test',
    assignee: 'sara',
    points: 1,
    priority: 'high',
    type: 'task',
    ready: true,
    criteria: ac('p95 below 300 ms at 400 events/s'),
  },
  {
    n: 196,
    title: 'Map tiles: cache headers',
    epic: 'E4',
    state: 'Todo',
    assignee: 'lea',
    points: 2,
    priority: 'low',
    type: 'task',
    ready: true,
    added: true,
    criteria: ac('Tiles cached 24 h at the edge'),
  },
  {
    n: 197,
    title: 'Rotate the map provider key',
    epic: 'E4',
    state: 'Done',
    assignee: 'ole',
    points: 1,
    priority: 'urgent',
    type: 'task',
    ready: true,
    criteria: ac('Old key revoked'),
  },
  {
    n: 198,
    title: 'Role for read-only dispatch supervisors',
    epic: 'E4',
    state: 'Done',
    assignee: 'a-coder',
    points: 3,
    priority: 'medium',
    type: 'story',
    ready: true,
    pr: '#321',
    criteria: ac('Supervisors cannot change tours'),
  },
  {
    n: 199,
    title: 'Telematics API contract with Nordwind IT',
    epic: 'E2',
    state: 'Done',
    assignee: 'mara',
    points: 2,
    priority: 'high',
    type: 'spike',
    ready: true,
    criteria: ac('Contract signed off by Nordwind IT'),
  },
  {
    n: 209,
    title: 'Dispatch map: base layer and tour pins',
    epic: 'E1',
    state: 'Done',
    assignee: 'lea',
    points: 5,
    priority: 'high',
    type: 'story',
    ready: true,
    pr: '#301',
    criteria: ac('All tours of the day on one map'),
  },
  {
    n: 210,
    title: 'Tour list filters',
    epic: 'E1',
    state: 'Done',
    assignee: 'a-coder',
    points: 3,
    priority: 'medium',
    type: 'story',
    ready: true,
    pr: '#305',
    criteria: ac('Filter by depot, driver, state'),
  },
  {
    n: 211,
    title: 'WebSocket channel for dispatch events',
    epic: 'E1',
    state: 'Done',
    assignee: 'tim',
    points: 4,
    priority: 'high',
    type: 'task',
    ready: true,
    pr: '#309',
    criteria: ac('Reconnects without losing events'),
  },
  // backlog
  {
    n: 200,
    title: 'Geofence alerts for depots',
    epic: 'E1',
    state: 'Backlog',
    assignee: '',
    points: 5,
    priority: 'medium',
    type: 'story',
    ready: true,
    criteria: ac('Alert when a truck leaves a depot outside its window'),
  },
  {
    n: 201,
    title: 'Dispatcher shift handover notes',
    epic: 'E1',
    state: 'Backlog',
    assignee: '',
    points: 3,
    priority: 'low',
    type: 'story',
    ready: false,
    criteria: [],
  },
  {
    n: 202,
    title: 'Customer self-service tracking link',
    epic: 'E3',
    state: 'Backlog',
    assignee: '',
    points: 8,
    priority: 'high',
    type: 'story',
    ready: true,
    criteria: ac('Link valid until delivery', 'No personal data of the driver shown'),
  },
  {
    n: 203,
    title: 'Archive tours older than 2 years',
    epic: 'E2',
    state: 'Backlog',
    assignee: '',
    points: null,
    priority: 'low',
    type: 'task',
    ready: false,
    criteria: [],
  },
  {
    n: 204,
    title: 'Audit log export for Nordwind compliance',
    epic: 'E4',
    state: 'Backlog',
    assignee: '',
    points: 3,
    priority: 'medium',
    type: 'story',
    ready: true,
    criteria: ac('CSV per month'),
  },
  {
    n: 205,
    title: 'Spike: offline mode for the driver app',
    epic: 'E1',
    state: 'Backlog',
    assignee: '',
    points: 2,
    priority: 'medium',
    type: 'spike',
    ready: true,
    criteria: ac('Decision record written'),
  },
];

export const SPRINT = {
  name: 'Sprint 14',
  start: 'Mon 29 Sep',
  end: 'Fri 10 Oct',
  day: 6,
  days: 10,
  goal: 'Dispatchers can re-route a tour live',
  committed: 33,
  added: 2,
  removed: 0,
};

export const CAPACITY = [
  { who: 'mara', hours: 32, focus: 0.6, off: 'Fri 3 Oct', points: 6 },
  { who: 'lea', hours: 72, focus: 0.75, off: '', points: 16 },
  { who: 'tim', hours: 56, focus: 0.75, off: 'Mon 6 – Tue 7 Oct', points: 11 },
  { who: 'sara', hours: 64, focus: 0.7, off: '', points: 12 },
  { who: 'ole', hours: 16, focus: 0.5, off: '', points: 2 },
  { who: 'a-coder', hours: 0, focus: 1, off: 'budget ' + '€180 for the sprint', points: 14 },
  { who: 'a-tester', hours: 0, focus: 1, off: 'budget €40 for the sprint', points: 4 },
];

export const VELOCITY = [
  { sprint: 'S9', committed: 30, done: 26 },
  { sprint: 'S10', committed: 32, done: 31 },
  { sprint: 'S11', committed: 34, done: 27 },
  { sprint: 'S12', committed: 30, done: 30 },
  { sprint: 'S13', committed: 33, done: 32 },
  { sprint: 'S14', committed: 34, done: 21 },
];

/** cumulative flow: per day, points in each state (done, test/review, in progress, todo) */
export const CFD = [
  [0, 0, 6, 28],
  [2, 3, 8, 21],
  [4, 5, 9, 16],
  [6, 6, 10, 12],
  [10, 7, 9, 8],
  [13, 8, 8, 5],
  [21, 6, 5, 2],
];

export const RETRO = {
  well: [
    'Planner draft saved 40 minutes of planning',
    'Review turnaround under 4 h',
    'Nordwind joined the demo live',
  ],
  better: [
    'Map provider limits found late',
    'Two stories without acceptance criteria entered the sprint',
    'Agent runs on HEL ate 30 % of the AI budget',
  ],
  actions: [
    { text: 'Add provider limits to the definition of ready', who: 'mara', task: true },
    { text: 'Planner refuses stories without criteria', who: 'ada', task: true },
    { text: 'Daily AI budget alert at 80 %', who: 'ole', task: false },
  ],
};

export const DRAFT = [
  {
    n: 206,
    title: 'Dispatcher sees driver breaks on the timeline',
    points: 5,
    why: 'Asked by Nordwind in CR-4; fits the sprint goal',
    confidence: 0.8,
  },
  {
    n: 207,
    title: 'Re-route: undo the last change',
    points: 2,
    why: 'Gap found in NWL-188 review',
    confidence: 0.9,
  },
  {
    n: 202,
    title: 'Customer self-service tracking link',
    points: 8,
    why: 'Highest RICE in the backlog; needed before the pilot',
    confidence: 0.6,
  },
  {
    n: 205,
    title: 'Spike: offline mode for the driver app',
    points: 2,
    why: 'Risk for the pilot; small',
    confidence: 0.85,
  },
  {
    n: 208,
    title: 'Remove the old tour import screen',
    points: 1,
    why: 'Dead code found by the code map',
    confidence: 0.7,
  },
];

// ── ideation ─────────────────────────────────────────────────────────────────────────────────────────────
export type IdeaState = 'new' | 'interviewing' | 'drafting' | 'in review' | 'approved' | 'rejected';

export interface Idea {
  id: string;
  title: string;
  state: IdeaState;
  from: string;
  rice: number;
  coverage: number;
  sources: number;
  updated: string;
}

export const IDEAS: Idea[] = [
  {
    id: 'I-14',
    title: 'Customer self-service tracking',
    state: 'in review',
    from: 'c-kai',
    rice: 168,
    coverage: 92,
    sources: 4,
    updated: '2 h ago',
  },
  {
    id: 'I-15',
    title: 'Dynamic delivery windows',
    state: 'interviewing',
    from: 'c-kai',
    rice: 96,
    coverage: 58,
    sources: 3,
    updated: '20 min ago',
  },
  {
    id: 'I-16',
    title: 'CO₂ report per tour',
    state: 'drafting',
    from: 'mara',
    rice: 74,
    coverage: 81,
    sources: 2,
    updated: 'yesterday',
  },
  {
    id: 'I-17',
    title: 'Voice commands for drivers',
    state: 'new',
    from: 'tim',
    rice: 0,
    coverage: 0,
    sources: 1,
    updated: '3 days ago',
  },
  {
    id: 'I-11',
    title: 'Fuel card integration',
    state: 'approved',
    from: 'c-kai',
    rice: 140,
    coverage: 100,
    sources: 5,
    updated: '12 Sep',
  },
  {
    id: 'I-9',
    title: 'Blockchain proof of delivery',
    state: 'rejected',
    from: 'c-kai',
    rice: 12,
    coverage: 70,
    sources: 2,
    updated: '2 Sep',
  },
];

export const SOURCES = [
  {
    name: 'Nordwind – Tracking requirements v2.pdf',
    kind: 'PDF',
    size: '1.4 MB',
    pages: 18,
    extracted: 23,
    by: 'c-kai',
    status: 'read',
  },
  {
    name: 'Workshop 22 Sep – whiteboard.jpg',
    kind: 'Image',
    size: '3.1 MB',
    pages: 1,
    extracted: 7,
    by: 'mara',
    status: 'read (OCR)',
  },
  {
    name: 'Call with Nordwind customer service.m4a',
    kind: 'Audio',
    size: '41 MB',
    pages: 0,
    extracted: 11,
    by: 'mara',
    status: 'transcribed, 38 min',
  },
  {
    name: 'Competitor tracking pages.url',
    kind: 'Link',
    size: '3 pages',
    pages: 3,
    extracted: 4,
    by: 'lea',
    status: 'read',
  },
];

export const COVERAGE = [
  { area: 'Problem and goals', pct: 100 },
  { area: 'Users and roles', pct: 100 },
  { area: 'Scope and non-goals', pct: 90 },
  { area: 'Non-functional', pct: 75 },
  { area: 'Data and privacy', pct: 85 },
  { area: 'Integrations', pct: 95 },
  { area: 'Security', pct: 80 },
];

export const INTERVIEW = [
  {
    who: 'a-analyst',
    text: 'The PDF says end customers get a link per delivery. How long should the link stay valid after the delivery?',
    area: 'Data and privacy',
  },
  { who: 'c-kai', text: '24 hours after delivery, then it should show "delivered" only, no map.' },
  {
    who: 'a-analyst',
    text: 'Noted as R-12. Should the driver’s name or photo be visible to the end customer?',
    area: 'Data and privacy',
  },
  {
    who: 'mara',
    text: 'First name only. No photo – that came up in the workshop (whiteboard, top right).',
  },
  {
    who: 'a-analyst',
    text: 'Thanks, that matches the whiteboard. Last open area is load: how many tracking pages do you expect at peak, for example on a Monday morning?',
    area: 'Non-functional',
  },
];

export const REQUIREMENTS = [
  {
    id: 'R-01',
    type: 'Functional',
    text: 'End customers open a tracking page from a link in the dispatch e-mail or SMS.',
    source: 'Tracking requirements v2.pdf, p. 3',
    status: 'agreed',
  },
  {
    id: 'R-04',
    type: 'Functional',
    text: 'The page shows the ETA window and the number of stops before theirs.',
    source: 'Tracking requirements v2.pdf, p. 5',
    status: 'agreed',
  },
  {
    id: 'R-07',
    type: 'Functional',
    text: 'Customers can leave a delivery note until the truck is 2 stops away.',
    source: 'Call with customer service, 14:20',
    status: 'agreed',
  },
  {
    id: 'R-12',
    type: 'Privacy',
    text: 'The link expires 24 h after delivery; afterwards only “delivered” is shown.',
    source: 'Interview, Kai Lorenz',
    status: 'agreed',
  },
  {
    id: 'R-13',
    type: 'Privacy',
    text: 'Only the driver’s first name is shown; no photo.',
    source: 'Whiteboard 22 Sep; interview, Mara Schulz',
    status: 'agreed',
  },
  {
    id: 'R-15',
    type: 'Non-functional',
    text: 'The page loads in under 1.5 s on 3G.',
    source: 'Tracking requirements v2.pdf, p. 9',
    status: 'open',
  },
  {
    id: 'R-16',
    type: 'Non-functional',
    text: 'Peak load to be confirmed (open question Q-21).',
    source: 'Interview',
    status: 'open',
  },
];

export const QUESTIONS = [
  {
    id: 'Q-21',
    text: 'Expected peak of tracking page views per minute?',
    owner: 'c-kai',
    due: 'Tue 7 Oct',
    state: 'open',
  },
  {
    id: 'Q-19',
    text: 'May the page use the client’s own domain (track.nordwind.de)?',
    owner: 'c-kai',
    due: 'Mon 6 Oct',
    state: 'open',
  },
  {
    id: 'Q-18',
    text: 'Which languages besides German?',
    owner: 'c-kai',
    due: 'done',
    state: 'answered',
  },
];

export const RISKS2 = [
  { text: 'Location data of drivers exposed longer than needed', l: 2, i: 5 },
  { text: 'Peak load on Monday mornings unknown', l: 4, i: 3 },
  { text: 'Client domain needs DNS work by Nordwind IT', l: 3, i: 2 },
  { text: 'SMS cost higher than budgeted', l: 2, i: 2 },
];

export const PRD_VERSIONS = [
  {
    v: 'v3',
    date: 'today 09:12',
    by: 'a-analyst',
    note: 'After interview round 3: privacy rules R-12, R-13',
    state: 'in review',
  },
  {
    v: 'v2',
    date: '30 Sep',
    by: 'a-analyst',
    note: 'Audio call added; scope cut: no proof-of-delivery photos',
    state: 'superseded',
  },
  {
    v: 'v1',
    date: '26 Sep',
    by: 'a-analyst',
    note: 'First draft from the PDF',
    state: 'superseded',
  },
];

export const DECISIONS = [
  {
    id: 'D-5',
    text: 'No photo of the driver on the tracking page',
    by: 'mara',
    date: '30 Sep',
    why: 'Privacy; workshop result',
  },
  {
    id: 'D-4',
    text: 'Proof-of-delivery photos are out of scope for the first release',
    by: 'c-kai',
    date: '29 Sep',
    why: 'Cost; legal check needed',
  },
  {
    id: 'D-3',
    text: 'Links sent by SMS and e-mail, not by app push',
    by: 'c-kai',
    date: '26 Sep',
    why: 'End customers have no app',
  },
];

export const GLOSSARY = [
  ['Tour', 'One truck’s planned sequence of stops for one day'],
  ['Stop', 'One delivery or pick-up address within a tour'],
  ['ETA window', 'The 30-minute window in which the truck is expected'],
  ['Dispatcher', 'Nordwind employee who plans and changes tours'],
];

// ── canvas ───────────────────────────────────────────────────────────────────────────────────────────────
export interface GRow {
  wbs: string;
  name: string;
  /** days from project start (Mon 1 Sep) */
  start: number;
  dur: number;
  done: number;
  level: number;
  summary?: boolean;
  milestone?: boolean;
  who?: string;
  deps?: string[];
  critical?: boolean;
  baseStart?: number;
  baseDur?: number;
  commits?: number[];
}

export const GANTT: GRow[] = [
  {
    wbs: '1',
    name: 'Ideation and plan',
    start: 0,
    dur: 12,
    done: 100,
    level: 0,
    summary: true,
    baseStart: 0,
    baseDur: 10,
  },
  {
    wbs: '1.1',
    name: 'Interview and PRD',
    start: 0,
    dur: 8,
    done: 100,
    level: 1,
    who: 'a-analyst',
    critical: true,
    baseStart: 0,
    baseDur: 7,
  },
  {
    wbs: '1.2',
    name: 'G1 plan signed',
    start: 11,
    dur: 0,
    done: 100,
    level: 1,
    milestone: true,
    deps: ['1.1'],
    critical: true,
    baseStart: 9,
  },
  {
    wbs: '2',
    name: 'Live dispatching',
    start: 12,
    dur: 30,
    done: 58,
    level: 0,
    summary: true,
    baseStart: 10,
    baseDur: 28,
  },
  {
    wbs: '2.1',
    name: 'Dispatch map and tours',
    start: 12,
    dur: 10,
    done: 100,
    level: 1,
    who: 'lea',
    deps: ['1.2'],
    critical: true,
    baseStart: 10,
    baseDur: 10,
    commits: [13, 15, 16, 19, 21],
  },
  {
    wbs: '2.2',
    name: 'Live re-routing (NWL-188)',
    start: 22,
    dur: 10,
    done: 80,
    level: 1,
    who: 'lea',
    deps: ['2.1'],
    critical: true,
    baseStart: 20,
    baseDur: 8,
    commits: [23, 24, 27, 29, 31],
  },
  {
    wbs: '2.3',
    name: 'Traffic layer',
    start: 24,
    dur: 8,
    done: 45,
    level: 1,
    who: 'a-coder',
    deps: ['2.1'],
    baseStart: 22,
    baseDur: 8,
    commits: [26, 31],
  },
  {
    wbs: '2.4',
    name: 'ETA recalculation',
    start: 32,
    dur: 8,
    done: 0,
    level: 1,
    who: 'tim',
    deps: ['2.2'],
    critical: true,
    baseStart: 28,
    baseDur: 8,
  },
  {
    wbs: '3',
    name: 'Tour data and exports',
    start: 14,
    dur: 26,
    done: 52,
    level: 0,
    summary: true,
    baseStart: 14,
    baseDur: 24,
  },
  {
    wbs: '3.1',
    name: 'Daily PDF report',
    start: 14,
    dur: 6,
    done: 100,
    level: 1,
    who: 'a-coder',
    baseStart: 14,
    baseDur: 6,
    commits: [15, 17, 19],
  },
  {
    wbs: '3.2',
    name: 'CSV export at scale',
    start: 26,
    dur: 7,
    done: 60,
    level: 1,
    who: 'lea',
    baseStart: 24,
    baseDur: 5,
    commits: [28, 30],
  },
  {
    wbs: '3.3',
    name: 'Telematics contract',
    start: 20,
    dur: 12,
    done: 70,
    level: 1,
    who: 'mara',
    baseStart: 18,
    baseDur: 8,
  },
  {
    wbs: '3.4',
    name: 'Driver hours import',
    start: 32,
    dur: 8,
    done: 0,
    level: 1,
    who: 'tim',
    deps: ['3.3'],
    baseStart: 26,
    baseDur: 8,
  },
  {
    wbs: '4',
    name: 'Pilot',
    start: 38,
    dur: 22,
    done: 5,
    level: 0,
    summary: true,
    baseStart: 36,
    baseDur: 20,
  },
  {
    wbs: '4.1',
    name: 'Load test 400 events/s',
    start: 38,
    dur: 4,
    done: 40,
    level: 1,
    who: 'sara',
    deps: ['2.2'],
    baseStart: 36,
    baseDur: 4,
  },
  {
    wbs: '4.2',
    name: 'G3 tested and secure',
    start: 42,
    dur: 0,
    done: 0,
    level: 1,
    milestone: true,
    deps: ['2.4', '4.1'],
    critical: true,
    baseStart: 40,
  },
  {
    wbs: '4.3',
    name: 'Onboarding 40 trucks',
    start: 43,
    dur: 9,
    done: 0,
    level: 1,
    who: 'mara',
    deps: ['4.2'],
    critical: true,
    baseStart: 41,
    baseDur: 9,
  },
  {
    wbs: '4.4',
    name: 'Pilot with 40 trucks',
    start: 59,
    dur: 0,
    done: 0,
    level: 1,
    milestone: true,
    deps: ['4.3'],
    critical: true,
    baseStart: 56,
  },
];

/** Monday 1 September 2026 is day 0; today (Sat 4 Oct) is day 33. */
export const TODAY = 33;

export const WORKLOAD: { who: string; weeks: number[] }[] = [
  { who: 'mara', weeks: [70, 85, 110, 95, 60, 40, 90, 100] },
  { who: 'lea', weeks: [90, 100, 100, 125, 130, 80, 60, 40] },
  { who: 'tim', weeks: [60, 80, 90, 70, 115, 120, 90, 50] },
  { who: 'sara', weeks: [40, 50, 60, 80, 100, 110, 95, 70] },
  { who: 'ole', weeks: [30, 20, 30, 40, 50, 60, 40, 30] },
  { who: 'a-coder', weeks: [50, 80, 95, 100, 90, 70, 60, 40] },
  { who: 'a-tester', weeks: [10, 20, 40, 60, 80, 90, 70, 30] },
];

export const CALENDAR = [
  { day: 1, text: 'Sprint 14 review', kind: 'meeting' },
  { day: 6, text: 'Tim off', kind: 'off' },
  { day: 7, text: 'Tim off', kind: 'off' },
  { day: 8, text: 'HEL UAT round 2', kind: 'meeting' },
  { day: 9, text: 'Sprint 14 review with Nordwind', kind: 'meeting' },
  { day: 10, text: 'Sprint 14 ends', kind: 'sprint' },
  { day: 13, text: 'G3 security gate', kind: 'milestone' },
  { day: 13, text: 'Sprint 15 starts', kind: 'sprint' },
  { day: 17, text: 'HEL release v2.0.0', kind: 'milestone' },
  { day: 20, text: 'Load test', kind: 'task' },
  { day: 24, text: 'Sprint 15 ends', kind: 'sprint' },
  { day: 30, text: 'Pilot with 40 trucks', kind: 'milestone' },
];
