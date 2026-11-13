// ── [PCODE-200 | S15 | v0.1.0] T16.4 Handover screens: design preview, team Handover tab, portal Handover section with signature ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-153 | S15 | v0.1.0] D1 preview: design system v2, shell, Cmd-K, Home, Inbox, project overview ──
//    Why:  every link of the preview leads somewhere. A section that a later design step draws shows
//          what it will hold, taken from docs/strategy/command-center-spec.md, so the owner can review
//          the navigation as a whole now and the content step by step.
import type { PIconName } from './picons.js';

export interface Upcoming {
  title: string;
  icon: PIconName;
  step: string;
  summary: string;
  highlights: string[];
}

export const SECTIONS: Record<string, Upcoming> = {
  projects: {
    title: 'Projects',
    icon: 'projects',
    step: 'D1',
    summary: 'All projects of all clients: health, phase, sprint, budget and quality in one list.',
    highlights: [],
  },
  agents: {
    title: 'Agents',
    icon: 'agents',
    step: 'D5',
    summary: 'Every agent under full control, with its cost per project in euro.',
    highlights: [
      'Versioned definition: model and fallbacks, prompt version, tools and MCP servers, file scopes, network allow-list',
      'Autonomy levels and approval rules per action: write, shell, push, merge, deploy, spend',
      'Budgets per run, day, project and agent with soft and hard caps; cost estimate before a run',
      'Traces: nested timeline of model and tool calls with tokens, latency and cost',
      'Evals, leaderboard, cost per merged PR, waste from failed runs',
      'Kill switch per run, per agent and "pause all"; schedules and triggers',
    ],
  },
  activity: {
    title: 'Activity',
    icon: 'activity',
    step: 'D5',
    summary: 'Everything that happens, at any volume, in the view that answers the question.',
    highlights: [
      'Inbox of what needs you next to the full firehose',
      'Facets with live counts and a query language with autocomplete',
      'Histogram you drag to zoom, heat map, live tail with pause',
      'Group by actor, object, project or time; collapse repeats',
      'One object’s full story across tasks, commits, runs and deploys',
      'Saved views, export of any query, stream to a SIEM',
    ],
  },
  people: {
    title: 'People',
    icon: 'people',
    step: 'D5',
    summary: 'Users, teams, clients and agents as principals, with roles and governance.',
    highlights: [
      'Roles, custom roles and conditions; project roles override workspace roles',
      'SSO (OIDC, SAML), SCIM, MFA policy per role, sessions per device',
      'Offboarding wizard that hands over tasks, agents and tokens',
      'Access reviews, stale users, “why can X see Y” checker',
      'Profiles with skills, capacity, time zone, holidays and cost rate',
    ],
  },
  tokens: {
    title: 'Tokens and costs',
    icon: 'tokens',
    step: 'D5',
    summary:
      'AI token spend in euro with budgets and forecasts, and every access token with its policy.',
    highlights: [
      'Usage by person, agent, project, model and task; token types stacked',
      'Budgets, month-end forecast, burn rate, anomaly alerts',
      'Provider keys per workspace or project; versioned price tables',
      'Personal tokens, service accounts, API and runner tokens with scopes',
      'Expiry, rotation, IP allow-lists, last use, leak detection with auto-revoke',
    ],
  },
  releases: {
    title: 'Releases and environments',
    icon: 'releases',
    step: 'D4',
    summary: 'Go or no-go per version, what runs where, and how fast the department delivers.',
    highlights: [
      'Release trains, freeze windows, release contents (tasks, tests, findings)',
      'Environments with what is deployed where and the diff between them',
      'Promotions with approval, rollback, feature flags',
      'DORA: deploy frequency, lead time, change failure rate, recovery time',
    ],
  },
  insights: {
    title: 'Insights',
    icon: 'insights',
    step: 'D5',
    summary: 'Engineering metrics across projects and clients.',
    highlights: [
      'Flow: cycle time, throughput, work in progress, carry-over',
      'Quality: escaped defects, flaky tests, findings by age',
      'AI effectiveness: agent vs human throughput, rework, cost per point',
      'Estimates vs actuals, capacity vs load per team',
    ],
  },
  clients: {
    title: 'Clients',
    icon: 'clients',
    step: 'D6',
    summary: 'Each client and the portal they work in with you: interactive and complete.',
    highlights: [
      'Client organisations with roles: sponsor, approver, product owner, tester, requester',
      'Portal: project health, what waits for them, live roadmap, releases',
      'Requests with screenshots, voice and screen recording; SLA timers',
      'Change requests with cost and schedule impact before approval',
      'Acceptance tests and sign-off; design approval with pinned comments',
      'Budget burn, invoices, quotes, meetings, satisfaction ratings',
      '“View as client” so the team sees exactly what the client sees',
    ],
  },
  incidents: {
    title: 'Incidents and on-call',
    icon: 'incidents',
    step: 'D6',
    summary:
      'From the first alert to the postmortem, linked to the deploy and code that caused it.',
    highlights: [
      'Alerts grouped and deduplicated; rotations and escalation',
      'Suspect changes from deploys and fingerprinted code; rollback button',
      'Status pages per environment and per client',
      'AI-drafted postmortem; actions become tasks; MTTA, MTTR, SLOs',
    ],
  },
  time: {
    title: 'Time',
    icon: 'time',
    step: 'D6',
    summary: 'Time from the IDE and the web, next to AI cost on the same task.',
    highlights: [
      'Timer that follows orq start and orq done; manual entries and reminders',
      'Weekly timesheets with approval and locked periods',
      'Rates per person, role, client and project; budgets with alerts',
      'Reports and exports that feed client invoices',
    ],
  },
  settings: {
    title: 'Settings',
    icon: 'settings',
    step: 'D5',
    summary: 'Workspace, integrations, policies, notifications, billing and appearance.',
    highlights: [
      'Settings that inherit from workspace to team, project and person',
      'Integrations hub: Git hosts, CI, Slack or Teams, email, calendar, Figma, Sentry',
      'Policies with a dry run; templates library',
      'System health, backup, restore and upgrade',
    ],
  },
};

export const TABS: Record<string, Upcoming> = {
  // [PCODE-200 | S15 | v0.1.0]
  handover: {
    title: 'Handover',
    icon: 'approval',
    step: 'T16',
    summary: 'A complete pack for the client: documents, release, tests and acceptance, signed.',
    highlights: [
      'Checks that say what the pack still lacks',
      'The team checklist for what only people can confirm',
      'Frozen, numbered packs with PDF',
      'The client accepts with a signature in the portal',
    ],
  },
  ideation: {
    title: 'Ideation',
    icon: 'ideation',
    step: 'D2',
    summary: 'Documents in, an AI interview, and a signed requirements document out.',
    highlights: [
      'Upload PDF, Word, images, audio; also from the IDE',
      'Interview one question at a time with coverage per area',
      'Requirements, open questions, assumptions, risks, personas, out-of-scope, glossary',
      'Prioritisation (RICE, MoSCoW, WSJF) and estimate with a confidence range',
      'Versioned PRD that cites its sources; e-signature',
    ],
  },
  planning: {
    title: 'Planning',
    icon: 'planning',
    step: 'D2',
    summary: 'Sprints with backlog and deliverables drafted by AI and fully editable by people.',
    highlights: [
      'AI draft accepted line by line; then full create, edit, delete',
      'Capacity of people and agents; sprint goal and scope snapshot',
      'Velocity, burndown, cumulative flow; carry-over counter',
      'Dependencies, WIP limits, retro whose actions become tasks',
    ],
  },
  canvas: {
    title: 'Canvas',
    icon: 'canvas',
    step: 'D2',
    summary: 'MS Project-grade views, connected to the IDE.',
    highlights: [
      'Gantt with dependencies, critical path and baselines',
      'Grid with inline edit, workload, calendar, board, mind map',
      'Commits and PRs as real progress on the bars',
      'Scenarios; MS Project XML, PDF and iCal export',
    ],
  },
  documents: {
    title: 'Documents',
    icon: 'documents',
    step: 'D3',
    summary: 'The project’s wiki, files and artifacts, and the knowledge its agents may use.',
    highlights: [
      'Page tree, block editor, templates, versions with diff',
      'Inline comments, live co-editing, backlinks',
      'Which pages each agent may read, with citations and a read log',
      'Owners and review dates; docs built from the code',
    ],
  },
  uikit: {
    title: 'UI kit',
    icon: 'uikit',
    step: 'D3',
    summary: 'Design tokens, components, mockups, assets and brand in one place.',
    highlights: [
      'Tokens exported to code as a pull request',
      'Figma sync; components with their code status',
      'Mockup review with pinned comments and approval',
      'Assets with usage rights; accessibility checks',
    ],
  },
  test: {
    title: 'Test',
    icon: 'test',
    step: 'D3',
    summary: 'Testers, developers, clients and agents testing together.',
    highlights: [
      'Plans, runs and a device and browser matrix',
      'Evidence as images, video, documents and voice notes',
      'One-click bug capture with console and network',
      'Flaky tests, coverage per requirement, sign-off',
    ],
  },
  versions: {
    title: 'Versions',
    icon: 'versions',
    step: 'D4',
    summary: 'Branches, pull requests, versions and releases linked to the work.',
    highlights: [
      'PRs with checks, reviews, size; merge queue',
      'Semantic versions and release notes for people and for clients',
      'Backports: is the fix in 1.4.x?',
      'DORA metrics per project',
    ],
  },
  security: {
    title: 'Security',
    icon: 'security',
    step: 'D4',
    summary: 'A command center for every kind of security check.',
    highlights: [
      'Code, dependencies, secrets, containers, live app, licences',
      'One risk score from CVSS, exploitation data and reachability',
      'Triage with SLAs; accepted risks that expire',
      'SBOM per version; gates that block only new issues',
    ],
  },
  codemap: {
    title: 'Code map',
    icon: 'codemap',
    step: 'D4',
    summary: 'Which sprint, feature and API lives where in the code, from the fingerprints.',
    highlights: [
      'Treemap by feature, sprint or version; sprint time-lapse',
      'API inventory with owner, creating task and tests',
      'Hotspots, ownership, agent vs human share',
      'Review queue with AI comments and overlays',
    ],
  },
};
