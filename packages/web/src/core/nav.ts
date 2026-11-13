// ── [PCODE-353 | S15 | v0.1.0] T35.4a System health page with backup, restore and upgrade wizards ──
// ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
// ── [PCODE-350 | S15 | v0.1.0] T35.3a Templates library for projects, PRDs, sprints and agents ──
// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
// ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
// ── [PCODE-213 | S15 | v0.1.0] T19.2 SCIM 2.0 provisioning (users, role groups, suspend on deactivate) and identity settings (SAML, SCIM tokens) ──
// ── [PCODE-210 | S15 | v0.1.0] T18.2 Command center screen: lanes with people and agents, heatmap, alerts, 24 h replay slider (design preview and live) ──
// ── [PCODE-200 | S15 | v0.1.0] T16.4 Handover screens: design preview, team Handover tab, portal Handover section with signature ──
// ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
// ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
// ── [PCODE-172 | S15 | v0.1.0] B3.5 UI kit live in the web app: tokens with export, components, mockups with pins and approval, assets, contrast checks ──
// ── [PCODE-171 | S15 | v0.1.0] B3.4 Documents live in the web app: page tree, Markdown pages with editor, versions and diff, comments, templates, knowledge, health ──
// ── [PCODE-167 | S15 | v0.1.0] B2.3 Canvas live in the web app: Gantt with critical path and dependencies, baselines, scenarios, grid, workload and levelling, calendar ──
// ── [PCODE-166 | S15 | v0.1.0] B2.2 Planning live in the web app: sprint header, board, backlog, Planner draft, capacity, reports, retro ──
// ── [PCODE-164 | S15 | v0.1.0] B1.3 The v2 shell live in the web app: Home per role, Inbox, Clients, portal mode, settings ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
// ── [PCODE-90 | S15 | v0.1.0] Build the web app shell with login and the ported design system ──
//    Why:  three screens do not need a routing library: the path lives in history, links push it, the back
//          button pops it. Our own, so the frontend stays as small as the backend.
import { useEffect, useState } from 'react';

// [PCODE-115 | S15 | v0.1.0] 'invite': an invitation link, open signed in or not
// [PCODE-219 | S15 | v0.1.0] 'buy': the public purchase pages, signed in or not
// [PCODE-237 | S15 | v0.1.0] 'forgot' and 'reset': a new password, signed out
// [PCODE-339 | S15 | v0.1.0] 'linkask' and 'link': a client contact's sign-in by email link
export type Screen =
  'login' | 'signup' | 'home' | 'invite' | 'buy' | 'forgot' | 'reset' | 'linkask' | 'link';

export function screenOf(path: string): Screen {
  if (path === '/signup') return 'signup';
  if (path === '/login') return 'login';
  if (path.startsWith('/invite/')) return 'invite';
  if (path === '/forgot') return 'forgot';
  if (path.startsWith('/reset/')) return 'reset';
  if (path === '/sign-in/email') return 'linkask';
  if (path === '/sign-in/link') return 'link';
  if (path === '/buy' || path === '/buy/done') return 'buy';
  return 'home';
}

// ── [PCODE-97 | S15 | v0.1.0] Show projects, item lists and item detail live in the web app ──
// ── [PCODE-118 | S15 | v0.1.0] Show and drive the lifecycle in the web app: stepper, stages, gate checklist and sign-off ──
// ── [PCODE-115 | S15 | v0.1.0] Add settings and user management: profile, password, tokens, members, invitations, project settings ──
// ── [PCODE-119 | S15 | v0.1.0] Add workspace lifecycle templates with an editor ──
// ── [PCODE-108 | S15 | v0.1.0] Integrate Git hosts: GitHub and Gitea webhooks, commits and PRs on items, live ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
// ── [PCODE-149 | S15 | v0.1.0] Bill through Stripe without its SDK: checkout, webhooks, licences ──
// ── [PCODE-146 | S15 | v0.1.0] Show compliance, evidence packs and reviews in the web app ──
// ── [PCODE-142 | S15 | v0.1.0] Show security findings in the web app with Security agent triage ──
// ── [PCODE-138 | S15 | v0.1.0] Show tests, coverage and live runs in the web app ──
// ── [PCODE-134 | S15 | v0.1.0] Show environments, secrets and live deploys in the web app ──
// ── [PCODE-126 | S15 | v0.1.0] Show ideas, the interview, proposals and signing in the web app ──
// ── [PCODE-122 | S15 | v0.1.0] Show agents in the web app: agents page, ask from a task, live run view, approvals, card badge ──
// [PCODE-108 | S15 | v0.1.0] 'git': the project's connected repositories
// [PCODE-113 | S15 | v0.1.0] a project opens on its overview; its list moved to /list; settings has its page
export type ProjectViewKind =
  // [PCODE-126 | S15 | v0.1.0] 'ideas': the project's ideas inbox
  // [PCODE-134 | S15 | v0.1.0] 'environments': where it runs and its deploys
  | 'overview'
  | 'lifecycle'
  | 'ideas'
  | 'list'
  | 'board'
  | 'backlog'
  | 'git'
  | 'environments'
  | 'tests' // [PCODE-138 | S15 | v0.1.0]
  | 'security' // [PCODE-142 | S15 | v0.1.0]
  | 'compliance' // [PCODE-146 | S15 | v0.1.0]
  | 'planning' // [PCODE-166 | S15 | v0.1.0] the Planning tab of the approved design
  | 'canvas' // [PCODE-167 | S15 | v0.1.0] the Canvas tab: Gantt, grid, workload, calendar
  | 'documents' // [PCODE-171 | S15 | v0.1.0] the wiki and the agents' knowledge
  | 'uikit' // [PCODE-172 | S15 | v0.1.0] tokens, components, mockups, assets
  | 'versions' // [PCODE-178 | S15 | v0.1.0] pull requests, releases, flags, DORA
  | 'codemap' // [PCODE-179 | S15 | v0.1.0] treemap, hotspots, APIs, hygiene
  | 'handover' // [PCODE-200 | S15 | v0.1.0] checks, team checklist, packs sent to the client
  | 'settings';
export const SETTINGS_SECTIONS = [
  'profile',
  'tokens',
  'appearance',
  'workspace',
  'members',
  'lifecycle', // [PCODE-119 | S15 | v0.1.0]
  'ai', // [PCODE-122 | S15 | v0.1.0] the model provider for agents
  'billing', // [PCODE-149 | S15 | v0.1.0] plan, licence and invoices
  'notifications', // [PCODE-151 | S15 | v0.1.0] Web Push on this device, and what to be told
  'identity', // [PCODE-213 | S15 | v0.1.0] SAML single sign-on and SCIM provisioning
  'phone', // [PCODE-224 | S15 | v0.1.0] signing in on a phone with a pairing code
  'integrations', // [PCODE-348 | S15 | v0.1.0]
  'library', // [PCODE-350 | S15 | v0.1.0]
  'policies', // [PCODE-352 | S15 | v0.1.0]
  'system', // [PCODE-353 | S15 | v0.1.0]
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export type AppRoute =
  | { kind: 'home' }
  | { kind: 'my-work' }
  | { kind: 'projects' }
  | { kind: 'activity' }
  | { kind: 'settings'; section: SettingsSection }
  | { kind: 'project'; id: string; view: ProjectViewKind }
  | { kind: 'item'; id: string }
  // [PCODE-122 | S15 | v0.1.0] the workspace's agents, and one run of an agent
  | { kind: 'agents' }
  | { kind: 'run'; id: string }
  // [PCODE-126 | S15 | v0.1.0] one idea: interview, proposal, signature
  | { kind: 'idea'; id: string }
  // [PCODE-134 | S15 | v0.1.0] one deploy, live
  | { kind: 'deploy'; id: string }
  // [PCODE-138 | S15 | v0.1.0] one test run, live
  | { kind: 'test-run'; id: string }
  // [PCODE-142 | S15 | v0.1.0] one security finding
  | { kind: 'finding'; id: string }
  // [PCODE-164 | S15 | v0.1.0] the inbox, the clients, and the sections later steps of phase B bring
  | { kind: 'inbox' }
  // [PCODE-235 | S15 | v0.1.0] conversations: the list, or one conversation
  | { kind: 'messages'; id: string | null }
  // [PCODE-210 | S15 | v0.1.0] every project, live
  | { kind: 'command' }
  | { kind: 'clients' }
  // [PCODE-185 | S15 | v0.1.0] a client's requests: the portal's and the team's view
  | { kind: 'requests'; id: string | null }
  // [PCODE-186 | S15 | v0.1.0] a section of the client portal (a page of Documents has an id)
  | { kind: 'portal'; section: string; id: string | null }
  | { kind: 'later'; section: LaterSection };

/** [PCODE-164 | S15 | v0.1.0] Sections of the approved map that later steps make live. */
export const LATER_SECTIONS = [
  'releases',
  'incidents',
  'time',
  'insights',
  'tokens',
  'people',
] as const;
export type LaterSection = (typeof LATER_SECTIONS)[number];

const ID = '([0-9a-f-]{36})';

/** The signed-in screens: home, my work, projects and their pages, items, activity, settings. */
export function appRoute(path: string): AppRoute {
  const clean = path.split('?')[0]?.replace(/\/+$/, '') || '/';
  if (clean === '/') return { kind: 'home' };
  if (clean === '/my-work') return { kind: 'my-work' };
  if (clean === '/projects') return { kind: 'projects' };
  if (clean === '/activity') return { kind: 'activity' };
  if (clean === '/agents') return { kind: 'agents' };
  // [PCODE-164 | S15 | v0.1.0]
  if (clean === '/inbox') return { kind: 'inbox' };
  // [PCODE-235 | S15 | v0.1.0]
  if (clean === '/messages') return { kind: 'messages', id: null };
  const conversation = new RegExp('^/messages/' + ID + '$', 'i').exec(clean);
  if (conversation?.[1]) return { kind: 'messages', id: conversation[1] };
  if (clean === '/command') return { kind: 'command' }; // [PCODE-210 | S15 | v0.1.0]
  if (clean === '/clients') return { kind: 'clients' };
  if (clean === '/requests') return { kind: 'requests', id: null }; // [PCODE-185 | S15 | v0.1.0]
  const later = LATER_SECTIONS.find((s) => clean === '/' + s);
  if (later) return { kind: 'later', section: later };
  const settings = /^\/settings(?:\/([a-z]+))?$/.exec(clean);
  if (settings) {
    const section = (settings[1] ?? 'profile') as SettingsSection;
    return { kind: 'settings', section: SETTINGS_SECTIONS.includes(section) ? section : 'profile' };
  }
  const project = new RegExp(
    '^/projects/' +
      ID +
      '(?:/(lifecycle|ideas|list|board|backlog|git|environments|tests|security|compliance|planning|canvas|documents|uikit|versions|codemap|handover|settings))?$',
    'i',
  ).exec(clean);
  if (project?.[1]) {
    return {
      kind: 'project',
      id: project[1],
      view: (project[2] as ProjectViewKind | undefined) ?? 'overview',
    };
  }
  const item = new RegExp('^/items/' + ID + '$', 'i').exec(clean);
  if (item?.[1]) return { kind: 'item', id: item[1] };
  const run = new RegExp('^/runs/' + ID + '$', 'i').exec(clean);
  if (run?.[1]) return { kind: 'run', id: run[1] };
  const idea = new RegExp('^/ideas/' + ID + '$', 'i').exec(clean);
  if (idea?.[1]) return { kind: 'idea', id: idea[1] };
  const deploy = new RegExp('^/deploys/' + ID + '$', 'i').exec(clean);
  if (deploy?.[1]) return { kind: 'deploy', id: deploy[1] };
  const testRun = new RegExp('^/test-runs/' + ID + '$', 'i').exec(clean);
  if (testRun?.[1]) return { kind: 'test-run', id: testRun[1] };
  const finding = new RegExp('^/findings/' + ID + '$', 'i').exec(clean);
  if (finding?.[1]) return { kind: 'finding', id: finding[1] };
  const request = new RegExp('^/requests/' + ID + '$', 'i').exec(clean); // [PCODE-185 | S15 | v0.1.0]
  if (request?.[1]) return { kind: 'requests', id: request[1] };
  // [PCODE-186 | S15 | v0.1.0]
  const portalDoc = new RegExp('^/portal/documents/' + ID + '$', 'i').exec(clean);
  if (portalDoc?.[1]) return { kind: 'portal', section: 'documents', id: portalDoc[1] };
  const portal =
    // [PCODE-293 | S15 | v0.1.0] assets
    /^\/portal\/(roadmap|acceptance|approvals|releases|documents|assets|handover|billing|meetings|status)$/.exec(
      clean,
    );
  if (portal?.[1]) return { kind: 'portal', section: portal[1], id: null };
  return { kind: 'home' };
}

/** The address of a project page. */
export const projectPath = (id: string, view: ProjectViewKind = 'overview'): string =>
  '/projects/' + id + (view === 'overview' ? '' : '/' + view);

export function navigate(path: string): void {
  // [PCODE-100 | S15 | v0.1.0] paths may carry a query (filters): compare the whole address
  if (window.location.pathname + window.location.search !== path)
    window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** [PCODE-100 | S15 | v0.1.0] Replaces the query of the current address (filters), without a new history entry. */
export function replaceSearch(search: string): void {
  const next = window.location.pathname + (search ? '?' + search : '');
  window.history.replaceState(null, '', next);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** [PCODE-100 | S15 | v0.1.0] The query of the current address, kept in step with history. */
export function useSearch(): string {
  const [search, setSearch] = useState(() => window.location.search.replace(/^\?/, ''));
  useEffect(() => {
    const on = (): void => {
      setSearch(window.location.search.replace(/^\?/, ''));
    };
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('popstate', on);
    };
  }, []);
  return search;
}

export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const on = (): void => {
      setPath(window.location.pathname);
    };
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('popstate', on);
    };
  }, []);
  return path;
}
