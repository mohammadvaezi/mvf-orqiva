// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-156 | S15 | v0.1.0] D4 preview: Versions, Security, Code map and Releases ──
//    Why:  the sample data behind the Versions, Security and Code map designs and the Releases page: pull
//          requests and versions linked to tasks, environments and flags; findings from every scanner with
//          their risk inputs, an SBOM and policies; and the code as the fingerprints describe it (features,
//          sprints, APIs, hotspots, authors) with a review queue.

// ── versions ─────────────────────────────────────────────────────────────────────────────────────────────
export const PRS = [
  {
    n: 318,
    title: 'Live re-routing for dispatchers',
    task: 'NWL-188',
    author: 'lea',
    branch: 'feat/live-route',
    checks: 'passed',
    reviews: '1 of 2',
    size: [412, 96],
    age: '1 d',
    risk: 'medium',
    ai: 2,
    stale: false,
    conflicts: false,
  },
  {
    n: 321,
    title: 'Read-only supervisor role',
    task: 'NWL-198',
    author: 'a-coder',
    branch: 'agent/nwl-198',
    checks: 'passed',
    reviews: 'approved',
    size: [148, 12],
    age: '3 h',
    risk: 'low',
    ai: 0,
    stale: false,
    conflicts: false,
  },
  {
    n: 323,
    title: 'CSV export in pages of 5 000',
    task: 'NWL-191',
    author: 'lea',
    branch: 'fix/csv-pages',
    checks: 'running',
    reviews: 'none',
    size: [96, 40],
    age: '20 min',
    risk: 'low',
    ai: 1,
    stale: false,
    conflicts: false,
  },
  {
    n: 309,
    title: 'Bump map SDK to 4.2',
    task: '—',
    author: 'a-security',
    branch: 'deps/map-sdk-4.2',
    checks: 'failed',
    reviews: 'none',
    size: [6, 6],
    age: '6 d',
    risk: 'medium',
    ai: 0,
    stale: true,
    conflicts: true,
  },
] as const;

export const VERSIONS = [
  {
    v: 'v1.4.0',
    state: 'release candidate',
    date: 'planned 13 Oct',
    tasks: 11,
    fixes: 3,
    tests: '412 / 431',
    findings: '0 critical',
    env: 'staging',
  },
  {
    v: 'v1.3.9',
    state: 'rolled back',
    date: '3 Oct',
    tasks: 2,
    fixes: 1,
    tests: '398 / 401',
    findings: '0 critical',
    env: '—',
  },
  {
    v: 'v1.3.8',
    state: 'in production',
    date: '29 Sep',
    tasks: 7,
    fixes: 2,
    tests: '398 / 401',
    findings: '0 critical',
    env: 'production',
  },
  {
    v: 'v1.3.0',
    state: 'superseded',
    date: '15 Sep',
    tasks: 19,
    fixes: 4,
    tests: '371 / 380',
    findings: '1 high (fixed)',
    env: '—',
  },
];

export const ENVIRONMENTS = [
  {
    name: 'Development',
    version: 'main @ 4c1e9a2',
    health: 'healthy',
    deployed: '12 min ago',
    by: 'a-coder',
    url: 'dev.nwl.broszio.dev',
  },
  {
    name: 'Staging',
    version: 'v1.4.0-rc.2',
    health: 'healthy',
    deployed: 'yesterday 17:20',
    by: 'ole',
    url: 'staging.nwl.broszio.dev',
  },
  {
    name: 'Pilot',
    version: 'v1.3.8',
    health: 'degraded',
    deployed: '3 Oct 09:40 (rollback)',
    by: 'ole',
    url: 'pilot.nordwind.de',
  },
  {
    name: 'Production',
    version: 'v1.3.8',
    health: 'healthy',
    deployed: '29 Sep',
    by: 'ole',
    url: 'fleet.nordwind.de',
  },
];

export const FLAGS = [
  {
    key: 'live-reroute',
    task: 'NWL-188',
    state: 'staging on · pilot 10 %',
    age: '9 d',
    stale: false,
  },
  { key: 'traffic-layer', task: 'NWL-189', state: 'off everywhere', age: '4 d', stale: false },
  {
    key: 'new-tour-import',
    task: 'NWL-140',
    state: 'on everywhere for 61 days',
    age: '61 d',
    stale: true,
  },
];

export const DORA = [
  { label: 'Deploy frequency', value: '4.2 / week', band: 'High', trend: '+0.8' },
  { label: 'Lead time for changes', value: '1.6 days', band: 'High', trend: '−0.4 d' },
  { label: 'Change failure rate', value: '8 %', band: 'Elite', trend: '+3 %' },
  { label: 'Time to restore', value: '38 min', band: 'Elite', trend: '−12 min' },
];

// ── security ─────────────────────────────────────────────────────────────────────────────────────────────
export interface Finding {
  id: string;
  title: string;
  kind: 'code' | 'dependency' | 'secret' | 'container' | 'infrastructure' | 'live app' | 'licence';
  severity: 'critical' | 'high' | 'medium' | 'low';
  cvss: number;
  epss: number;
  kev: boolean;
  reachable: boolean | null;
  exposed: boolean;
  risk: number;
  state: 'new' | 'confirmed' | 'fixing' | 'accepted' | 'fixed';
  sla: string;
  where: string;
  introducedBy: string;
  owner: string;
  isNew: boolean;
}

export const FINDINGS: Finding[] = [
  {
    id: 'F-81',
    title: 'Access token written to the request log',
    kind: 'code',
    severity: 'critical',
    cvss: 9.1,
    epss: 0,
    kev: false,
    reachable: true,
    exposed: true,
    risk: 96,
    state: 'fixing',
    sla: '1 day left',
    where: 'src/api/booking.ts:211',
    introducedBy: 'HEL-198 (Coder, 12 Sep)',
    owner: 'jonas',
    isNew: true,
  },
  {
    id: 'F-79',
    title: 'xml2js prototype pollution (CVE-2026-31144)',
    kind: 'dependency',
    severity: 'high',
    cvss: 8.1,
    epss: 0.42,
    kev: true,
    reachable: true,
    exposed: true,
    risk: 88,
    state: 'confirmed',
    sla: '4 days left',
    where: 'xml2js 0.4.23 via map-sdk',
    introducedBy: 'NWL-77 (Lea, 2 Aug)',
    owner: 'lea',
    isNew: true,
  },
  {
    id: 'F-77',
    title: 'Outdated xml parser in a test tool',
    kind: 'dependency',
    severity: 'high',
    cvss: 7.5,
    epss: 0.03,
    kev: false,
    reachable: false,
    exposed: false,
    risk: 21,
    state: 'accepted',
    sla: 'accepted until 3 Nov',
    where: 'devDependency: test-reporter',
    introducedBy: '—',
    owner: 'mara',
    isNew: false,
  },
  {
    id: 'F-74',
    title: 'Map provider key in git history',
    kind: 'secret',
    severity: 'high',
    cvss: 7.0,
    epss: 0,
    kev: false,
    reachable: null,
    exposed: true,
    risk: 64,
    state: 'fixed',
    sla: 'fixed 2 Oct, key revoked',
    where: 'commit 9f1c2e0 (old)',
    introducedBy: 'NWL-12 (Tim, July)',
    owner: 'ole',
    isNew: false,
  },
  {
    id: 'F-72',
    title: 'Container runs as root',
    kind: 'container',
    severity: 'medium',
    cvss: 5.3,
    epss: 0,
    kev: false,
    reachable: null,
    exposed: false,
    risk: 30,
    state: 'confirmed',
    sla: '21 days left',
    where: 'Dockerfile: api',
    introducedBy: 'NWL-3',
    owner: 'ole',
    isNew: false,
  },
  {
    id: 'F-70',
    title: 'Missing Content-Security-Policy on the pilot site',
    kind: 'live app',
    severity: 'medium',
    cvss: 4.7,
    epss: 0,
    kev: false,
    reachable: null,
    exposed: true,
    risk: 38,
    state: 'new',
    sla: '30 days left',
    where: 'pilot.nordwind.de',
    introducedBy: '—',
    owner: 'ole',
    isNew: true,
  },
  {
    id: 'F-68',
    title: 'GPL-3.0 package in the driver app',
    kind: 'licence',
    severity: 'medium',
    cvss: 0,
    epss: 0,
    kev: false,
    reachable: null,
    exposed: false,
    risk: 45,
    state: 'confirmed',
    sla: 'blocks release',
    where: 'react-native-signature 2.1',
    introducedBy: 'NWD-31',
    owner: 'tim',
    isNew: false,
  },
];

export const POSTURE = [62, 64, 63, 68, 71, 70, 74, 73, 77, 79, 76, 81];

export const SCANNERS = [
  { name: 'Code (SAST)', tool: 'Orqiva scan + Semgrep rules', last: '09:40', found: 2 },
  { name: 'Dependencies', tool: 'OSV database', last: '09:40', found: 2 },
  { name: 'Secrets', tool: 'Orqiva scan, incl. history', last: '09:40', found: 0 },
  { name: 'Containers', tool: 'Trivy (SARIF import)', last: 'yesterday', found: 1 },
  { name: 'Live app (DAST)', tool: 'ZAP baseline', last: 'Sun 03:00', found: 1 },
  { name: 'Licences', tool: 'Orqiva licence check', last: '09:40', found: 1 },
];

export const POLICIES = [
  { rule: 'New critical finding', effect: 'blocks merge', on: true },
  { rule: 'Known-exploited (KEV) vulnerability reachable', effect: 'blocks release', on: true },
  { rule: 'GPL, AGPL or SSPL licence', effect: 'blocks release', on: true },
  { rule: 'Live secret found', effect: 'blocks merge, revokes key', on: true },
  { rule: 'High finding past its SLA', effect: 'pages the owner', on: false },
];

export const SBOM = [
  { pkg: 'map-sdk', version: '4.1.3', licence: 'Apache-2.0', direct: true, vulns: 1 },
  { pkg: 'xml2js', version: '0.4.23', licence: 'MIT', direct: false, vulns: 1 },
  { pkg: 'react', version: '19.3.0', licence: 'MIT', direct: true, vulns: 0 },
  { pkg: 'pg', version: '8.16.0', licence: 'MIT', direct: true, vulns: 0 },
  { pkg: 'react-native-signature', version: '2.1.0', licence: 'GPL-3.0', direct: true, vulns: 0 },
];

// ── code map ─────────────────────────────────────────────────────────────────────────────────────────────
export const AREAS = [
  {
    name: 'Live dispatching',
    loc: 4200,
    sprint: 'S14',
    agent: 0.62,
    churn: 0.8,
    health: 7.9,
    tone: 1,
    files: ['live/socket.ts', 'dispatch/route.ts', 'dispatch/drawer.tsx', 'map/pin.tsx'],
  },
  {
    name: 'Tour data and exports',
    loc: 3100,
    sprint: 'S13',
    agent: 0.71,
    churn: 0.6,
    health: 6.4,
    tone: 3,
    files: ['tours/export.ts', 'tours/pdf.ts', 'telematics/import.ts'],
  },
  {
    name: 'Accounts and roles',
    loc: 1800,
    sprint: 'S11',
    agent: 0.35,
    churn: 0.2,
    health: 9.1,
    tone: 4,
    files: ['auth/roles.ts', 'auth/session.ts'],
  },
  {
    name: 'Pilot readiness',
    loc: 900,
    sprint: 'S14',
    agent: 0.4,
    churn: 0.4,
    health: 8.6,
    tone: 5,
    files: ['ops/onboarding.ts', 'ops/load.ts'],
  },
  {
    name: 'Platform',
    loc: 2600,
    sprint: 'S9',
    agent: 0.28,
    churn: 0.3,
    health: 8.2,
    tone: 2,
    files: ['server.ts', 'db/migrate.ts', 'config.ts'],
  },
  {
    name: 'No fingerprint',
    loc: 640,
    sprint: '—',
    agent: 0,
    churn: 0.1,
    health: 5.2,
    tone: 6,
    files: ['old/table.tsx', 'old/import.ts'],
  },
];

export const APIS = [
  {
    method: 'GET',
    path: '/tours',
    task: 'NWL-12',
    owner: 'lea',
    tests: 14,
    auth: 'dispatcher',
    calls: '42k/day',
  },
  {
    method: 'PATCH',
    path: '/tours/{id}/route',
    task: 'NWL-188',
    owner: 'lea',
    tests: 6,
    auth: 'dispatcher',
    calls: 'new',
  },
  {
    method: 'GET',
    path: '/tours/export',
    task: 'NWL-191',
    owner: 'lea',
    tests: 4,
    auth: 'dispatcher',
    calls: '300/day',
  },
  {
    method: 'GET',
    path: '/drivers/{id}/hours',
    task: 'NWL-193',
    owner: 'tim',
    tests: 0,
    auth: 'supervisor',
    calls: '—',
  },
  {
    method: 'WS',
    path: 'tour.rerouted',
    task: 'NWL-188',
    owner: 'lea',
    tests: 3,
    auth: 'driver token',
    calls: 'new',
  },
  {
    method: 'POST',
    path: '/import/legacy',
    task: '— (no fingerprint)',
    owner: '?',
    tests: 0,
    auth: 'none',
    calls: '0 in 60 d',
  },
];

export const HOTSPOTS = [
  {
    file: 'src/dispatch/route.ts',
    churn: 38,
    complexity: 41,
    health: 5.8,
    authors: 3,
    agentShare: 0.7,
  },
  {
    file: 'src/tours/export.ts',
    churn: 22,
    complexity: 33,
    health: 6.1,
    authors: 2,
    agentShare: 0.8,
  },
  {
    file: 'src/live/socket.ts',
    churn: 19,
    complexity: 18,
    health: 8.3,
    authors: 2,
    agentShare: 0.5,
  },
  { file: 'src/old/table.tsx', churn: 1, complexity: 52, health: 3.9, authors: 1, agentShare: 0 },
];

export const REVIEW_QUEUE = [
  {
    pr: 318,
    title: 'Live re-routing for dispatchers',
    reviewer: 'mara',
    wait: '1 d 2 h',
    sla: 'over',
    risk: 'API change, hotspot',
    checklist: 'API · migration',
  },
  {
    pr: 323,
    title: 'CSV export in pages of 5 000',
    reviewer: 'lea',
    wait: '20 min',
    sla: 'ok',
    risk: 'small',
    checklist: 'default',
  },
  {
    pr: 321,
    title: 'Read-only supervisor role',
    reviewer: 'a-reviewer',
    wait: '3 h',
    sla: 'ok',
    risk: 'security-relevant',
    checklist: 'security',
  },
];

export const DIFF = [
  {
    n: 84,
    old: '  const res = await routing.recalc(tour);',
    neu: '  const res = await routing.recalc(tour, { timeoutMs: 2000 });',
    kind: 'change' as const,
  },
  {
    n: 85,
    old: '',
    neu: '  // [NWL-188 | S14 | v1.4.0] Live re-routing: fall back to the last route on timeout',
    kind: 'add' as const,
  },
  { n: 86, old: '', neu: '  if (!res.ok) return lastKnownRoute(tour);', kind: 'add' as const },
  {
    n: 87,
    old: '  socket.broadcast(tour.id, res.route);',
    neu: "  socket.broadcast(tour.id, { type: 'tour.rerouted', route: res.route, version: tour.version + 1 });",
    kind: 'change' as const,
  },
];
