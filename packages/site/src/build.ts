// ── [PCODE-450 | S15 | v0.1.0] Landing page: background loops were frozen; media URLs carry their content hash ──
// ── [PCODE-448 | S15 | v0.1.0] Orqiva logo on the public site ──
// ── [PCODE-443 | S15 | v0.1.0] Cinematic landing page for the public site ──
// ── [PCODE-364 | S15 | v0.1.0] T35.8 T35 exit check, docs and sprint close ──
// ── [PCODE-345 | S15 | v0.1.0] T34.4 T34 exit check, docs and sprint close ──
// ── [PCODE-335 | S15 | v0.1.0] T33.5 T33 exit check, docs and sprint close ──
// ── [PCODE-326 | S15 | v0.1.0] T32.9 T32 exit check, docs and sprint close ──
// ── [PCODE-312 | S15 | v0.1.0] T31.10 T31 exit check, docs and sprint close ──
// ── [PCODE-298 | S15 | v0.1.0] T30.11 T30 exit check, docs and sprint close ──
// ── [PCODE-278 | S15 | v0.1.0] T28.7 T28 exit check, docs and sprint close ──
// ── [PCODE-265 | S15 | v0.1.0] T27.7 T27 exit check, docs and sprint close ──
// ── [PCODE-258 | S15 | v0.1.0] T26.7 T26 exit check, docs and sprint close ──
// ── [PCODE-251 | S15 | v0.1.0] T25.6 T25 exit check, docs and sprint close ──
// ── [PCODE-218 | S15 | v0.1.0] T20.1 Public docs site built from the repository (own Markdown renderer, CLI and API reference, link check) ──
//    Why:  the site is a list of pages (PAGES): Markdown files of the repository, or pages generated from the
//          code. Building renders each one into the frame and checks every link inside the site: a link to
//          a Markdown file that is not a page, to a page that does not exist, or to an anchor that is not on
//          the target page is an error, and the build fails instead of shipping a dead link.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { landingPage } from './landing.js';
import { LANDING_STYLE } from './landingStyle.js';
import { hrefOf, page, STYLE, type NavEntry } from './layout.js';
import { LOGO_SVG } from './logo.js';
import { renderMarkdown, type Heading } from './markdown.js';
import { PRICING_STYLE, pricingPage } from './pricing.js';
import { apiPage, cliPage } from './reference.js';

// [PCODE-443 | S15 | v0.1.0] the landing page is a page of its own frame
export type Source = { md: string } | { generated: 'cli' | 'api' | 'pricing' | 'landing' };

export interface PageDef extends NavEntry {
  description: string;
  source: Source;
}

/** The site, in navigation order. Markdown paths are relative to the repository root. */
export const PAGES: PageDef[] = [
  // [PCODE-443 | S15 | v0.1.0] the front door; the docs start at the overview
  {
    slug: 'index',
    title: 'Home',
    section: 'Start',
    description: 'Orqiva: idea to release, on your own machines.',
    source: { generated: 'landing' },
  },
  {
    slug: 'overview',
    title: 'Overview',
    section: 'Start',
    description: 'Orqiva, the self-hosted engineering command center.',
    source: { md: 'docs/site/index.md' },
  },
  {
    slug: 'getting-started',
    title: 'Getting started',
    section: 'Start',
    description: 'From a machine with Docker to your first sprint in about an hour.',
    source: { md: 'docs/getting-started.md' },
  },
  // [PCODE-219 | S15 | v0.1.0]
  {
    slug: 'pricing',
    title: 'Pricing',
    section: 'Start',
    description: 'Plans and prices of Orqiva, self-hosted.',
    source: { generated: 'pricing' },
  },
  {
    slug: 'install',
    title: 'Install with Docker',
    section: 'Install and run',
    description: 'Install, upgrade and configure the Orqiva server with Docker Compose.',
    source: { md: 'docs/install-server.md' },
  },
  {
    slug: 'kubernetes',
    title: 'Kubernetes (Helm)',
    section: 'Install and run',
    description: 'Several server nodes on Kubernetes with the Helm chart.',
    source: { md: 'docs/install-kubernetes.md' },
  },
  {
    slug: 'offline-and-backups',
    title: 'Offline install and backups',
    section: 'Install and run',
    description: 'Install without internet from a checked bundle; checked backups and restore.',
    source: { md: 'docs/offline-and-backups.md' },
  },
  // [PCODE-227 | S15 | v0.1.0]
  {
    slug: 'mobile',
    title: 'Phone app',
    section: 'Install and run',
    description: 'The live feed of a workspace on iOS and Android: sign-in, offline, signing out.',
    source: { md: 'docs/mobile.md' },
  },
  // [PCODE-238 | S15 | v0.1.0] T23.5 Communication exit check, docs and sprint close
  {
    slug: 'messages',
    title: 'Messages',
    section: 'Use Orqiva',
    description:
      'Channels, direct messages and threads for the team and its clients, inside Orqiva.',
    source: { md: 'docs/messages.md' },
  },
  // [PCODE-243 | S15 | v0.1.0]
  {
    slug: 'ai-providers',
    title: 'AI providers and files',
    section: 'Use Orqiva',
    description:
      'Anthropic, OpenAI, Azure OpenAI, Gemini, Bedrock and Grok: connections, fallbacks, prices and reading files.',
    source: { md: 'docs/ai-providers.md' },
  },
  // [PCODE-278 | S15 | v0.1.0] ideation and the PRD
  {
    slug: 'ideation',
    title: 'Ideation and the PRD',
    section: 'Use Orqiva',
    description:
      'Sources and links, the interview by coverage, stories and personas, the matrix and evidence, the PRD with citations, versions and exports, estimates, review by named approvers and promotion to an epic.',
    source: { md: 'docs/ideation.md' },
  },
  // [PCODE-345 | S15 | v0.1.0] clients, incidents and time
  {
    slug: 'clients-incidents-time',
    title: 'Clients, incidents and time',
    section: 'Use Orqiva',
    description:
      'The client portal with its home, releases, votes, NPS and feedback widget, sign-in by link; incidents from probes, deploys, Sentry and Alertmanager, runbooks, update templates, public status pages and postmortems by the DevOps agent; time with idle detection, reminders, corrections with a reason, breakdowns, hour budgets and the DATEV export.',
    source: { md: 'docs/clients-incidents-time.md' },
  },
  // [PCODE-364 | S15 | v0.1.0] finding, homes, integrations, templates, policies, health, language, plans
  {
    slug: 'working-across-orqiva',
    title: 'Working across Orqiva',
    section: 'Use Orqiva',
    description:
      'Cmd-K and keys, homes with widgets, Slack and Teams bridges, email in, the calendar link and CI runs, the templates library, settings with project leads, policies with a dry run, system health, offline, activity, German, accessibility and what each plan holds.',
    source: { md: 'docs/working-across-orqiva.md' },
  },
  // [PCODE-335 | S15 | v0.1.0] trying, judging and paying for agents
  {
    slug: 'agent-workbench',
    title: 'Trying, judging and paying for agents',
    section: 'Use Orqiva',
    description:
      'The playground with reruns, comparisons and experiments, evals with checks and a judge, quality marks and outcomes, nested traces, a sandbox per run with pull requests by a bot identity, MCP servers per agent, cache-aware costs in euro, estimates, chargeback, limits and provider health.',
    source: { md: 'docs/agent-workbench.md' },
  },
  // [PCODE-326 | S15 | v0.1.0] test management and security scanning
  {
    slug: 'testing',
    title: 'Test management',
    section: 'Use Orqiva',
    description:
      'Shared steps, parameters and Gherkin, runs with testers, keys and timers, AI triage, sign-off and the release gate, imports from Playwright, Cypress, Allure and JUnit, leakage and burndown, masking, test data and the bug-capture extension.',
    source: { md: 'docs/testing.md' },
  },
  {
    slug: 'security-scanning',
    title: 'Security scanning',
    section: 'Use Orqiva',
    description:
      'Secrets in files and history, dependencies and SARIF from any scanner, leaks in commits, logs and traces, EPSS and known-exploited feeds, alerts for shipped versions, VEX per version and fix pull requests.',
    source: { md: 'docs/security-scanning.md' },
  },
  // [PCODE-312 | S15 | v0.1.0] code review and versions
  {
    slug: 'code-review',
    title: 'Code review and versions',
    section: 'Use Orqiva',
    description:
      'GitHub, Gitea, GitLab and Azure Repos with their history, the review queue and line comments, merge policies and the merge queue, versions from commits, environment config, the code map and its architecture, review in VS Code and MCP tools.',
    source: { md: 'docs/code-review.md' },
  },
  // [PCODE-298 | S15 | v0.1.0] the UI kit and design
  {
    slug: 'ui-kit',
    title: 'UI kit and design',
    section: 'Use Orqiva',
    description:
      'Tokens with themes and aliases, Figma sync, exports and pull requests, the brand book, components and their use in the code, mockup review and handoff, asset sizes and the download portal, visual and accessibility checks.',
    source: { md: 'docs/ui-kit.md' },
  },
  // [PCODE-286 | S15 | v0.1.0] documents
  {
    slug: 'documents',
    title: 'Documents',
    section: 'Use Orqiva',
    description:
      'The wiki: blocks with callouts, math, diagrams and live embeds, editing together, versions and diffs, mentions, search, files and readers, pages for one task, import from Markdown, Notion and Confluence, export as Markdown, HTML, PDF and ZIP.',
    source: { md: 'docs/documents.md' },
  },
  // [PCODE-265 | S15 | v0.1.0] the Canvas complete
  {
    slug: 'canvas',
    title: 'Canvas',
    section: 'Use Orqiva',
    description:
      'The interactive Gantt, constraints and splits, the grid as a spreadsheet, timeline, mind map, workload, portfolio, scenarios, files in and out, pictures and share links.',
    source: { md: 'docs/canvas.md' },
  },
  // [PCODE-258 | S15 | v0.1.0] planning complete
  {
    slug: 'planning',
    title: 'Planning',
    section: 'Use Orqiva',
    description:
      'Initiatives, types and fields, estimates and poker, capacity, the Planner, flow, keys, Git moves and the charts.',
    source: { md: 'docs/planning.md' },
  },
  // [PCODE-251 | S15 | v0.1.0] what T25 made act
  {
    slug: 'agent-automation',
    title: 'Agents that start by themselves',
    section: 'Use Orqiva',
    description:
      'Triggers (assignment, label, mention, CI, schedule, webhook), scopes for files, branches and hosts, clean traces.',
    source: { md: 'docs/agent-automation.md' },
  },
  {
    slug: 'roles-and-access',
    title: 'Roles and access',
    section: 'Use Orqiva',
    description:
      'Custom roles with conditions, roles per project, the access check, and safe edits of one task.',
    source: { md: 'docs/roles-and-access.md' },
  },
  {
    slug: 'alerts',
    title: 'Alerts and reminders',
    section: 'Use Orqiva',
    description:
      'Budget and spend alerts, watched pages, and reminders of stale flags and quiet ideas.',
    source: { md: 'docs/alerts.md' },
  },
  {
    slug: 'profiles-and-privacy',
    title: 'Profiles and personal data',
    section: 'Use Orqiva',
    description: 'Work profiles, the download of your data, and erasing someone who left.',
    source: { md: 'docs/profiles-and-privacy.md' },
  },
  // [PCODE-221 | S15 | v0.1.0] moving from another tool
  {
    slug: 'migrate',
    title: 'Overview',
    section: 'Move to Orqiva',
    description: 'Bring your backlog from Jira, Linear or Plane, with its numbers.',
    source: { md: 'docs/migrate/overview.md' },
  },
  {
    slug: 'migrate-jira',
    title: 'From Jira',
    section: 'Move to Orqiva',
    description: 'Move a Jira project to Orqiva from a CSV export.',
    source: { md: 'docs/migrate/jira.md' },
  },
  {
    slug: 'migrate-linear',
    title: 'From Linear',
    section: 'Move to Orqiva',
    description: 'Move Linear teams to Orqiva from a CSV export.',
    source: { md: 'docs/migrate/linear.md' },
  },
  {
    slug: 'migrate-plane',
    title: 'From Plane',
    section: 'Move to Orqiva',
    description: 'Move a Plane project to Orqiva with comments and history.',
    source: { md: 'docs/migrate/plane.md' },
  },
  {
    slug: 'cli',
    title: 'Command line',
    section: 'Reference',
    description: 'Every command of orq.',
    source: { generated: 'cli' },
  },
  {
    slug: 'api',
    title: 'REST API',
    section: 'Reference',
    description: 'Every operation of the Orqiva REST API.',
    source: { generated: 'api' },
  },
  {
    slug: 'security',
    title: 'Security',
    section: 'Trust',
    description: 'How Orqiva protects your data, and how it was checked.',
    source: { md: 'docs/site/security.md' },
  },
  {
    slug: 'licences',
    title: 'Licences and ownership',
    section: 'Trust',
    description: 'What Orqiva is made of and under which licences.',
    source: { md: 'docs/policy/licences.md' },
  },
];

export interface BuildInput {
  /** the repository root */
  root: string;
  out: string;
  version: string;
  cliHelp: string;
  openapi: Record<string, unknown>;
  /** [PCODE-219 | S15 | v0.1.0] the vendor's buy page; without it the pricing page has no buy buttons */
  buyUrl?: string;
  /** [PCODE-443 | S15 | v0.1.0] the landing page's bundled script and its footage (name → bytes) */
  landing?: { script: string; media: ReadonlyMap<string, Buffer> };
  pages?: PageDef[];
  read?: (path: string) => string;
}

// ── [PCODE-443 | S15 | v0.1.0] Cinematic landing page for the public site ──
/** The links and anchors of a page written as HTML, for the same check the Markdown pages get. */
function htmlLinks(
  html: string,
  from: string,
): { links: { href: string; from: string }[]; ids: Heading[] } {
  const links: { href: string; from: string }[] = [];
  for (const m of html.matchAll(/\shref="([^"]+)"/g)) {
    const href = m[1] ?? '';
    if (/^[\w-]+\.html(#[\w-]+)?$/.test(href) || href.startsWith('#')) links.push({ href, from });
  }
  const ids = [...html.matchAll(/\sid="([\w-]+)"/g)].map((m) => ({
    level: 2,
    id: m[1] ?? '',
    text: '',
  }));
  return { links, ids };
}

const hashOf = (content: string): string =>
  createHash('sha256').update(content).digest('hex').slice(0, 12);

export interface BuildResult {
  pages: string[];
  errors: string[];
  bytes: number;
}

interface Built {
  def: PageDef;
  body: string;
  headings: Heading[];
  links: { href: string; from: string }[];
  /** [PCODE-443 | S15 | v0.1.0] the body is the whole document, not framed */
  whole?: boolean;
}

export function buildSite(input: BuildInput): BuildResult {
  const pages = input.pages ?? PAGES;
  const read = input.read ?? ((p: string) => readFileSync(join(input.root, p), 'utf8'));
  const errors: string[] = [];
  const bySource = new Map<string, string>();
  for (const p of pages) if ('md' in p.source) bySource.set(p.source.md, p.slug);

  const landingScript = input.landing?.script ?? '';
  const landingMedia = input.landing?.media ?? new Map<string, Buffer>();
  const built: Built[] = pages.map((def) => {
    const links: { href: string; from: string }[] = [];
    if ('generated' in def.source) {
      const g = def.source.generated;
      // [PCODE-443 | S15 | v0.1.0] a whole document; its links are checked like every other page's
      if (g === 'landing') {
        const html = landingPage({
          version: input.version,
          media: new Set(landingMedia.keys()),
          // [PCODE-450 | S15 | v0.1.0] media URLs named by their content
          mediaHash: (file) => {
            const data = landingMedia.get(file);
            return data ? createHash('sha256').update(data).digest('hex').slice(0, 10) : undefined;
          },
          scriptHref: 'landing.js?v=' + hashOf(landingScript),
          styleHref: 'landing.css?v=' + hashOf(LANDING_STYLE),
        });
        const r = htmlLinks(html, def.slug);
        return { def, body: html, headings: r.ids, links: r.links, whole: true };
      }
      const r =
        g === 'cli'
          ? cliPage(input.cliHelp)
          : g === 'pricing'
            ? pricingPage(input.buyUrl)
            : apiPage(input.openapi);
      return { def, ...r, links };
    }
    const file = def.source.md;
    let text: string;
    try {
      text = read(file);
    } catch {
      errors.push(def.slug + ': the page ' + file + ' is missing');
      return { def, body: '', headings: [], links };
    }
    const r = renderMarkdown(text, (href) => {
      if (/^(https?:|mailto:)/i.test(href)) return href;
      const [path = '', hash] = href.split('#');
      if (!path) {
        links.push({ href: '#' + (hash ?? ''), from: def.slug });
        return href;
      }
      // a generated page is linked by its URL (cli.html); the check below makes sure it exists
      if (/^[\w-]+\.html$/.test(path)) {
        links.push({ href, from: def.slug });
        return href;
      }
      // a link between Markdown files of the repository becomes a link between pages
      const target = posix.normalize(posix.join(posix.dirname(file), path));
      const slug = bySource.get(target);
      // a file of the repository (LICENSE, a JSON policy) is not on the site: its name stays, as text
      if (!slug && !target.endsWith('.md')) return undefined;
      if (!slug) {
        errors.push(def.slug + ': links to ' + href + ', which is not a page of the site');
        return undefined;
      }
      const to = hrefOf(slug) + (hash ? '#' + hash : '');
      links.push({ href: to, from: def.slug });
      return to;
    });
    return { def, body: r.html, headings: r.headings, links };
  });

  // every link inside the site lands on a page, and on an anchor that exists there
  const anchors = new Map(built.map((b) => [b.def.slug, new Set(b.headings.map((h) => h.id))]));
  for (const b of built)
    for (const l of b.links) {
      const [path = '', hash] = l.href.split('#');
      const slug = path === '' ? b.def.slug : path.replace(/\.html$/, '');
      const ids = anchors.get(slug);
      if (!ids) errors.push(l.from + ': links to ' + l.href + ', which does not exist');
      else if (hash && !ids.has(hash))
        errors.push(l.from + ': links to ' + l.href + ', but that page has no heading #' + hash);
    }

  rmSync(input.out, { recursive: true, force: true });
  mkdirSync(input.out, { recursive: true });
  let bytes = 0;
  const write = (name: string, content: string | Buffer): void => {
    const path = join(input.out, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    bytes += Buffer.byteLength(content);
  };
  const nav: NavEntry[] = pages.map(({ slug, title, section }) => ({ slug, title, section }));
  for (const b of built)
    write(
      b.def.slug + '.html',
      b.whole
        ? b.body
        : page({
            slug: b.def.slug,
            title: b.def.title,
            description: b.def.description,
            body: b.body,
            headings: b.headings,
            nav,
            version: input.version,
          }),
    );
  write('site.css', STYLE + PRICING_STYLE);
  // [PCODE-443 | S15 | v0.1.0] the landing page's own stylesheet, script and footage
  if (built.some((b) => b.whole)) {
    write('landing.css', LANDING_STYLE);
    if (landingScript) write('landing.js', landingScript);
    else errors.push('index: the landing script is missing (run node build-client.mjs)');
    for (const [name, data] of landingMedia) write('media/' + name, data);
  }
  // [PCODE-448 | S15 | v0.1.0] the Orqiva mark, in the pages and as the favicon
  write('logo.svg', LOGO_SVG);
  write('favicon.svg', LOGO_SVG);
  write('openapi.json', JSON.stringify(input.openapi));
  return { pages: built.map((b) => b.def.slug), errors, bytes };
}
