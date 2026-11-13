// ── [PCODE-155 | S15 | v0.1.0] D3 preview: Documents, UI kit and Test ──
//    Why:  the sample data behind the Documents, UI kit and Test designs: a project wiki with folders,
//          owners, review dates and what the agents may read; a design system with tokens, components,
//          mockups under review and assets with their licences; and test runs across browsers and devices
//          with evidence, defects, coverage and flaky tests.

// ── documents ────────────────────────────────────────────────────────────────────────────────────────────
export interface DocNode {
  id: string;
  title: string;
  kind: 'folder' | 'page' | 'file';
  parent: string | null;
  status?: 'draft' | 'approved' | 'verified' | 'stale';
  owner?: string;
  agent?: boolean;
  shared?: boolean;
  generated?: boolean;
}

export const DOCS: DocNode[] = [
  { id: 'f-overview', title: 'Overview', kind: 'folder', parent: null },
  {
    id: 'p-home',
    title: 'Fleet portal – start here',
    kind: 'page',
    parent: 'f-overview',
    status: 'verified',
    owner: 'mara',
  },
  {
    id: 'p-glossary',
    title: 'Glossary',
    kind: 'page',
    parent: 'f-overview',
    status: 'verified',
    owner: 'a-analyst',
    agent: true,
  },
  { id: 'f-arch', title: 'Architecture', kind: 'folder', parent: null },
  {
    id: 'p-arch',
    title: 'System overview',
    kind: 'page',
    parent: 'f-arch',
    status: 'approved',
    owner: 'lea',
  },
  {
    id: 'p-adr7',
    title: 'ADR-007 Live routing via WebSocket',
    kind: 'page',
    parent: 'f-arch',
    status: 'approved',
    owner: 'lea',
  },
  {
    id: 'p-adr8',
    title: 'ADR-008 Map provider and rate limits',
    kind: 'page',
    parent: 'f-arch',
    status: 'draft',
    owner: 'tim',
  },
  { id: 'f-run', title: 'Runbooks', kind: 'folder', parent: null },
  {
    id: 'p-run1',
    title: 'Map provider outage',
    kind: 'page',
    parent: 'f-run',
    status: 'verified',
    owner: 'ole',
  },
  {
    id: 'p-run2',
    title: 'Rollback a deploy',
    kind: 'page',
    parent: 'f-run',
    status: 'stale',
    owner: 'ole',
  },
  { id: 'f-api', title: 'API reference', kind: 'folder', parent: null },
  {
    id: 'p-api1',
    title: 'Tours API (from code)',
    kind: 'page',
    parent: 'f-api',
    status: 'verified',
    owner: 'a-coder',
    generated: true,
  },
  {
    id: 'p-api2',
    title: 'Dispatch events (from code)',
    kind: 'page',
    parent: 'f-api',
    status: 'verified',
    owner: 'a-coder',
    generated: true,
  },
  { id: 'f-meet', title: 'Meeting notes', kind: 'folder', parent: null },
  {
    id: 'p-m1',
    title: '2026-09-22 Workshop with Nordwind',
    kind: 'page',
    parent: 'f-meet',
    status: 'approved',
    owner: 'mara',
    shared: true,
  },
  {
    id: 'p-m2',
    title: '2026-10-02 Sprint 14 review',
    kind: 'page',
    parent: 'f-meet',
    status: 'draft',
    owner: 'a-analyst',
    agent: true,
    shared: true,
  },
  { id: 'f-client', title: 'Shared with Nordwind', kind: 'folder', parent: null },
  {
    id: 'd-contract',
    title: 'Statement of work v2.pdf',
    kind: 'file',
    parent: 'f-client',
    shared: true,
  },
  { id: 'd-wb', title: 'Workshop whiteboard.jpg', kind: 'file', parent: 'f-client', shared: true },
];

export const AGENT_ACCESS: { agent: string; scope: Record<string, boolean>; reads: number }[] = [
  {
    agent: 'a-coder',
    scope: {
      'f-overview': true,
      'f-arch': true,
      'f-run': false,
      'f-api': true,
      'f-meet': false,
      'f-client': false,
    },
    reads: 41,
  },
  {
    agent: 'a-reviewer',
    scope: {
      'f-overview': true,
      'f-arch': true,
      'f-run': false,
      'f-api': true,
      'f-meet': false,
      'f-client': false,
    },
    reads: 18,
  },
  {
    agent: 'a-analyst',
    scope: {
      'f-overview': true,
      'f-arch': true,
      'f-run': false,
      'f-api': false,
      'f-meet': true,
      'f-client': true,
    },
    reads: 27,
  },
  {
    agent: 'a-tester',
    scope: {
      'f-overview': true,
      'f-arch': false,
      'f-run': false,
      'f-api': true,
      'f-meet': false,
      'f-client': false,
    },
    reads: 9,
  },
  {
    agent: 'a-security',
    scope: {
      'f-overview': true,
      'f-arch': true,
      'f-run': true,
      'f-api': true,
      'f-meet': false,
      'f-client': false,
    },
    reads: 6,
  },
];

export const READ_LOG = [
  {
    agent: 'a-coder',
    page: 'ADR-007 Live routing via WebSocket',
    why: 'NWL-188, deciding the reconnect strategy',
    cited: '§3 Reconnects',
    at: '09:31',
  },
  {
    agent: 'a-reviewer',
    page: 'System overview',
    why: 'Review of #318',
    cited: '§2 Layers',
    at: '08:46',
  },
  {
    agent: 'a-coder',
    page: 'Tours API (from code)',
    why: 'NWL-191, export endpoint',
    cited: 'GET /tours/export',
    at: 'yesterday',
  },
];

export const DOC_COMMENTS = [
  {
    who: 'tim',
    quote: 'every 15 seconds',
    text: 'Is 15 s enough for the pilot? Nordwind asked for 10.',
    replies: 1,
    resolved: false,
  },
  {
    who: 'a-reviewer',
    quote: 'exponential backoff',
    text: 'The code uses a fixed 2 s delay (src/live/socket.ts:88). Either the ADR or the code is out of date.',
    replies: 0,
    resolved: false,
  },
  {
    who: 'mara',
    quote: 'Status: approved',
    text: 'Approved in the architecture review on 24 Sep.',
    replies: 0,
    resolved: true,
  },
];

export const DOC_VERSIONS = [
  { v: 'v4', who: 'lea', when: 'today 08:12', note: 'Reconnect section after the load test' },
  { v: 'v3', who: 'a-coder', when: '30 Sep', note: 'Event names synced from the code' },
  { v: 'v2', who: 'lea', when: '24 Sep', note: 'Approved in architecture review' },
  { v: 'v1', who: 'lea', when: '19 Sep', note: 'First draft' },
];

export const TEMPLATES = [
  {
    name: 'Architecture decision (ADR)',
    icon: 'flag',
    hint: 'Context, decision, consequences, status',
  },
  { name: 'RFC', icon: 'request', hint: 'Problem, proposal, alternatives, open questions' },
  { name: 'Runbook', icon: 'incident', hint: 'Symptoms, checks, steps, rollback, contacts' },
  {
    name: 'Postmortem',
    icon: 'documents',
    hint: 'Timeline, impact, causes, actions (become tasks)',
  },
  { name: 'Meeting notes', icon: 'people', hint: 'Agenda, notes, decisions, action items' },
  { name: 'API document', icon: 'codemap', hint: 'Generated from OpenAPI, kept in sync' },
] as const;

// ── ui kit ───────────────────────────────────────────────────────────────────────────────────────────────
export const TOKENS: { name: string; light: string; dark: string; use: string; group: string }[] = [
  {
    name: 'color.primary',
    light: '#4B3FCE',
    dark: '#9D93FF',
    use: 'Buttons, links, focus',
    group: 'Colour',
  },
  {
    name: 'color.accent',
    light: '#16C79A',
    dark: '#16C79A',
    use: 'Live states, success accents',
    group: 'Colour',
  },
  {
    name: 'color.surface',
    light: '#FFFFFF',
    dark: '#16152E',
    use: 'Cards, panels',
    group: 'Colour',
  },
  { name: 'color.text', light: '#23224A', dark: '#ECEBFA', use: 'Body text', group: 'Colour' },
  {
    name: 'color.text-2',
    light: '#7F7E9C',
    dark: '#A9A8C6',
    use: 'Secondary text',
    group: 'Colour',
  },
  {
    name: 'color.danger',
    light: '#EF4444',
    dark: '#F87171',
    use: 'Errors, critical',
    group: 'Colour',
  },
  {
    name: 'color.warning',
    light: '#F59E0B',
    dark: '#FBBF24',
    use: 'At risk, due soon',
    group: 'Colour',
  },
  { name: 'space.2', light: '8px', dark: '8px', use: 'Inside controls', group: 'Spacing' },
  { name: 'space.4', light: '16px', dark: '16px', use: 'Card padding', group: 'Spacing' },
  { name: 'radius.md', light: '10px', dark: '10px', use: 'Cards', group: 'Shape' },
  {
    name: 'font.body',
    light: '13.5px / 1.45',
    dark: '13.5px / 1.45',
    use: 'Body text',
    group: 'Type',
  },
  {
    name: 'font.title',
    light: '22px / 650',
    dark: '22px / 650',
    use: 'Page titles',
    group: 'Type',
  },
];

export const COMPONENTS = [
  {
    name: 'Button',
    status: 'in code',
    variants: 4,
    usage: 312,
    figma: true,
    a11y: 100,
    path: 'src/ui/button.tsx',
  },
  {
    name: 'Chip',
    status: 'in code',
    variants: 7,
    usage: 188,
    figma: true,
    a11y: 96,
    path: 'src/ui/chip.tsx',
  },
  {
    name: 'Tour map pin',
    status: 'in code',
    variants: 3,
    usage: 14,
    figma: true,
    a11y: 82,
    path: 'src/map/pin.tsx',
  },
  {
    name: 'Stop timeline',
    status: 'design only',
    variants: 2,
    usage: 0,
    figma: true,
    a11y: 0,
    path: '—',
  },
  {
    name: 'Dispatch drawer',
    status: 'in code',
    variants: 1,
    usage: 3,
    figma: false,
    a11y: 91,
    path: 'src/dispatch/drawer.tsx',
  },
  {
    name: 'Legacy table',
    status: 'deprecated',
    variants: 1,
    usage: 9,
    figma: false,
    a11y: 64,
    path: 'src/old/table.tsx',
  },
];

export const MOCKUPS = [
  {
    id: 'm1',
    name: 'Re-route a tour',
    version: 'v4',
    state: 'approved',
    by: 'nico',
    task: 'NWL-188',
    changedAfterDev: false,
  },
  {
    id: 'm2',
    name: 'Customer tracking page',
    version: 'v2',
    state: 'in review',
    by: 'nico',
    task: 'NWL-202',
    changedAfterDev: false,
  },
  {
    id: 'm3',
    name: 'Tour export dialog',
    version: 'v3',
    state: 'approved',
    by: 'nico',
    task: 'NWL-191',
    changedAfterDev: true,
  },
  {
    id: 'm4',
    name: 'Driver hours panel',
    version: 'v1',
    state: 'draft',
    by: 'nico',
    task: 'NWL-193',
    changedAfterDev: false,
  },
];

export const PINS = [
  {
    x: 72,
    y: 28,
    who: 'c-kai',
    text: 'Can the ETA be bigger? Dispatchers read it from 2 m away.',
    resolved: false,
  },
  {
    x: 30,
    y: 62,
    who: 'lea',
    text: 'This list needs a loading state for 400+ stops.',
    resolved: false,
  },
  { x: 84, y: 76, who: 'mara', text: 'Undo should be here, see NWL-207.', resolved: true },
];

export const ASSETS = [
  {
    name: 'Nordwind logo (primary)',
    kind: 'Logo',
    formats: 'SVG · PNG · PDF',
    rights: 'Client-owned, use in the portal',
    expires: '—',
    tone: 'success',
  },
  {
    name: 'Truck icons set',
    kind: 'Icons',
    formats: 'SVG sprite · 48 icons',
    rights: 'MIT licence',
    expires: '—',
    tone: 'success',
  },
  {
    name: 'Depot photo Hamburg',
    kind: 'Image',
    formats: 'JPG 4000×2667',
    rights: 'Stock licence, web only',
    expires: '31 Dec 2026',
    tone: 'warning',
  },
  {
    name: 'Inter font',
    kind: 'Font',
    formats: 'WOFF2',
    rights: 'SIL Open Font License',
    expires: '—',
    tone: 'success',
  },
  {
    name: 'Map style “Nordwind light”',
    kind: 'Map style',
    formats: 'JSON',
    rights: 'Provider terms, max 100k loads/month',
    expires: 'contract 2027',
    tone: 'info',
  },
];

export const CONTRAST = [
  { pair: 'text on surface', ratio: 13.9, aa: true, aaa: true },
  { pair: 'text-2 on surface', ratio: 4.6, aa: true, aaa: false },
  { pair: 'primary on surface', ratio: 7.1, aa: true, aaa: true },
  { pair: 'warning on surface (chip text)', ratio: 3.1, aa: false, aaa: false },
];

export const HARDCODED = [
  { file: 'src/map/pin.tsx', line: 41, value: '#FF6600', suggest: 'color.warning' },
  { file: 'src/dispatch/drawer.tsx', line: 112, value: 'padding: 14px', suggest: 'space.4 (16px)' },
  { file: 'src/old/table.tsx', line: 8, value: 'font-size: 12.5px', suggest: 'font.small' },
];

// ── test ─────────────────────────────────────────────────────────────────────────────────────────────────
export type Result = 'passed' | 'failed' | 'blocked' | 'skipped' | 'untested' | 'retest';

export const CONFIGS = [
  'Chrome · Windows',
  'Firefox · Windows',
  'Edge · Windows',
  'Safari · macOS',
  'Safari · iOS 18',
  'Chrome · Android 14',
];

export const MATRIX: Result[][] = [
  ['passed', 'failed', 'passed', 'passed', 'untested', 'untested'],
  ['passed', 'passed', 'passed', 'passed', 'passed', 'blocked'],
  ['passed', 'passed', 'passed', 'retest', 'untested', 'untested'],
  ['passed', 'passed', 'passed', 'passed', 'passed', 'passed'],
];

export interface Case {
  id: string;
  title: string;
  suite: string;
  type: 'steps' | 'bdd' | 'exploratory';
  auto: 'manual' | 'automated' | 'both';
  req: string;
  version: number;
  last: Result;
  flaky?: number;
  steps: { action: string; expected: string }[];
}

export const CASES: Case[] = [
  {
    id: 'C-412',
    title: 'Export 50 000 tours to CSV',
    suite: 'Exports',
    type: 'steps',
    auto: 'manual',
    req: 'NWL-191',
    version: 3,
    last: 'failed',
    steps: [
      { action: 'Open Tours, filter September, 50 000 rows', expected: 'Row count shows 50 000' },
      { action: 'Choose Export → CSV', expected: 'Dialog shows the estimated size' },
      { action: 'Confirm the export', expected: 'Progress bar appears, page stays usable' },
      { action: 'Wait for the download', expected: 'File arrives in under 20 s, 50 001 lines' },
      { action: 'Open the file in Excel', expected: 'Umlauts and dates are correct' },
    ],
  },
  {
    id: 'C-388',
    title: 'Re-route a tour by dragging a stop',
    suite: 'Live dispatching',
    type: 'bdd',
    auto: 'both',
    req: 'NWL-188',
    version: 2,
    last: 'passed',
    steps: [
      { action: 'Given a tour in progress with 12 stops', expected: '' },
      { action: 'When the dispatcher drags stop 7 before stop 4', expected: '' },
      { action: 'Then the route recalculates in under 2 s', expected: 'New ETA for every stop' },
    ],
  },
  {
    id: 'C-391',
    title: 'Driver sees the new route within 10 s',
    suite: 'Live dispatching',
    type: 'steps',
    auto: 'automated',
    req: 'NWL-188',
    version: 1,
    last: 'passed',
    flaky: 0.18,
    steps: [],
  },
  {
    id: 'C-402',
    title: 'Daily PDF report has the client logo',
    suite: 'Exports',
    type: 'steps',
    auto: 'automated',
    req: 'NWL-192',
    version: 1,
    last: 'passed',
    steps: [],
  },
  {
    id: 'C-420',
    title: 'Exploratory: export under a slow network',
    suite: 'Exports',
    type: 'exploratory',
    auto: 'manual',
    req: 'NWL-191',
    version: 1,
    last: 'untested',
    steps: [],
  },
  {
    id: 'C-377',
    title: 'Supervisor cannot change a tour',
    suite: 'Roles',
    type: 'steps',
    auto: 'automated',
    req: 'NWL-198',
    version: 2,
    last: 'passed',
    flaky: 0.07,
    steps: [],
  },
];

export const DEFECTS = [
  {
    id: 'NWL-213',
    title: 'CSV export stops at 5 000 rows in Firefox',
    severity: 'high',
    from: 'C-412 step 4',
    who: 'sara',
    state: 'Todo',
    ai: 'product bug · same cause as NWL-191',
  },
  {
    id: 'NWL-214',
    title: 'Android 14: map does not load on the test device',
    severity: 'medium',
    from: 'Run 88 · Chrome Android',
    who: 'sara',
    state: 'Todo',
    ai: 'environment · test device on old WebView',
  },
  {
    id: 'NWL-215',
    title: 'Re-route ETA off by 1 min after midnight',
    severity: 'low',
    from: 'C-388 automated',
    who: 'a-tester',
    state: 'Backlog',
    ai: 'product bug · time zone',
  },
];

export const FLAKY = [
  {
    id: 'C-391',
    title: 'Driver sees the new route within 10 s',
    rate: 18,
    runs: 'PPFPPPFPPF',
    quarantined: true,
  },
  {
    id: 'C-377',
    title: 'Supervisor cannot change a tour',
    rate: 7,
    runs: 'PPPPFPPPPP',
    quarantined: false,
  },
  { id: 'C-366', title: 'Tour list sorts by ETA', rate: 4, runs: 'PPPPPPPFPP', quarantined: false },
];

export const COVERAGE_REQ = [
  { req: 'NWL-188 Live re-routing', cases: 6, passed: 5, auto: 4 },
  { req: 'NWL-191 CSV export at scale', cases: 4, passed: 1, auto: 1 },
  { req: 'NWL-192 Daily PDF report', cases: 3, passed: 3, auto: 3 },
  { req: 'NWL-195 Load test', cases: 2, passed: 1, auto: 2 },
  { req: 'NWL-198 Supervisor role', cases: 3, passed: 3, auto: 2 },
  { req: 'NWL-202 Tracking link', cases: 0, passed: 0, auto: 0 },
];
