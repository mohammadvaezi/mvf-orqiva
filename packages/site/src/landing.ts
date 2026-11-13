// ── [PCODE-452 | S15 | v0.1.0] Landing page: cinematic arrival of the 3D mark, framed and timed ──
// ── [PCODE-451 | S15 | v0.1.0] Landing page: steady server-room loop, 3D Orqiva mark in the finale ──
// ── [PCODE-450 | S15 | v0.1.0] Landing page: background loops were frozen; media URLs carry their content hash ──
// ── [PCODE-449 | S15 | v0.1.0] Landing page: the product tour as real video of Orqiva in use ──
// ── [PCODE-448 | S15 | v0.1.0] Orqiva logo on the public site ──
// ── [PCODE-445 | S15 | v0.1.0] Landing page: fly through the real product, warmer sections ──
// ── [PCODE-444 | S15 | v0.1.0] Landing page: smooth on integrated GPUs, footage and feature visuals ──
// ── [PCODE-443 | S15 | v0.1.0] Cinematic landing page for the public site ──
//    Why:  the site's front door. It shows the product itself: a tour through Orqiva's real screens (the
//          web app's /preview with sample data, captured into media/screen-*.webp), one chapter per stage
//          from idea to release, with cards lifted off each screen that point at what matters. Then it
//          answers what stops people from installing: where it runs, how long it takes, what it costs.
//          Every claim comes from the docs this site is built from; the plan facts come from the shared
//          OFFERS. Without JavaScript, and on phones, each chapter shows its screen inline; the script
//          (client/deck.ts) turns the screens into a 3D deck the camera moves through.
import { OFFERS, PRICING_DRAFT, priceLabel, type Offer } from '@orqiva/shared';
import { escapeHtml } from './markdown.js';

export interface LandingInput {
  version: string;
  /** the files in packages/site/media that exist (pictures and footage are optional) */
  media: ReadonlySet<string>;
  /** [PCODE-450 | S15 | v0.1.0] a media file's content hash, so a changed file gets a new URL */
  mediaHash?: (file: string) => string | undefined;
  /** the landing script and stylesheet names, with their content hash */
  scriptHref: string;
  styleHref: string;
}

const free = OFFERS.find((o) => o.plan === 'free');
const freeSeats = free?.maxSeats ?? null;
/** "Free for up to 5 people", from the offer itself. */
export const FREE_LINE =
  (freeSeats ? 'Free for up to ' + String(freeSeats) + ' people' : 'Free to install') +
  ' · no licence key · no time limit';

const esc = escapeHtml;

const cta = (track: string, label = 'Install free', extra = ''): string =>
  '<a class="btn btn--primary' +
  extra +
  '" href="getting-started.html" data-track="' +
  track +
  '">' +
  esc(label) +
  '<span class="btn__arrow" aria-hidden="true">→</span></a>';

// ── [PCODE-445 | S15 | v0.1.0] the tour: one real screen per chapter, with cards lifted off it ──

/** A card lifted off a screen: where it floats (a class), and its HTML in the app's own style. */
interface Pop {
  at: string;
  html: string;
}

interface Stop {
  /** chapter id, also the anchor */
  id: string;
  /** label on the progress rail */
  rail: string;
  /** media/screen-<screen>.webp */
  screen: string;
  /** what the screen shows, for people who cannot see it */
  alt: string;
  /** media/<backdrop>.webp behind the screen */
  backdrop: string;
  pops: Pop[];
}

const tag = (tone: string, text: string): string =>
  '<span class="tag tag--' + tone + '">' + esc(text) + '</span>';
const bar = (pct: number, tone = 'primary'): string =>
  '<span class="meter"><span class="meter__fill meter__fill--' +
  tone +
  ' meter--' +
  String(pct) +
  '"></span></span>';

const STOPS: Stop[] = [
  {
    id: 'top',
    rail: 'Overview',
    screen: 'home',
    alt: 'Orqiva home: five projects with sprint and budget status, nine decisions waiting, AI spend this month and the agents working now.',
    backdrop: 'hero',
    pops: [
      {
        at: 'pop--tr',
        html:
          '<p class="pop__k">AI spend this month</p><p class="pop__big">1.286 €</p><p class="pop__s">of 2.400 € budget · forecast 2.210 €</p>' +
          bar(54),
      },
      {
        at: 'pop--bl',
        html:
          '<p class="pop__row"><span class="dot dot--amber"></span><b>Coder</b> HEL-212' +
          tag('amber', 'Waiting') +
          '</p><p class="pop__s">Waiting for approval: run migration on staging</p>',
      },
    ],
  },
  {
    id: 'idea',
    rail: 'Ideation',
    screen: 'ideation',
    alt: 'The ideation interview: the Analyst agent asks about data and privacy, a person answers, and a coverage panel shows 89 percent of the areas covered.',
    backdrop: 'feature-idea',
    pops: [
      {
        at: 'pop--tr',
        html: '<p class="pop__k">Coverage</p><p class="pop__big">89 %</p><p class="pop__s">The interview ends when every area is covered.</p>',
      },
      {
        at: 'pop--bl',
        html:
          '<p class="pop__row"><span class="bot"></span><b>Analyst</b>' +
          tag('violet', 'Data and privacy') +
          '</p><p class="pop__s">How long should the link stay valid after the delivery?</p>',
      },
    ],
  },
  {
    id: 'work',
    rail: 'Plan',
    screen: 'canvas',
    alt: 'The Gantt chart of a project: tasks with owners, the critical path in coral, the baseline, commits from fingerprints as dots, and today’s line.',
    backdrop: 'feature-work',
    pops: [
      {
        at: 'pop--tr',
        html: '<p class="pop__row"><span class="dot dot--coral"></span><b>Critical path</b></p><p class="pop__s">2.2 Live re-routing · 4 days late against the baseline</p>',
      },
      {
        at: 'pop--bl',
        html: '<p class="pop__row"><span class="dot dot--teal"></span><b>Commits on the plan</b></p><p class="pop__s">Every commit with a task fingerprint shows on its bar.</p>',
      },
    ],
  },
  {
    id: 'agents',
    rail: 'Agents',
    screen: 'agents',
    alt: 'The agent fleet: Coder, Reviewer, Tester, Analyst, Planner and Sentinel, each with its model, how far it may act, its budget, runs and success rate, and the person accountable.',
    backdrop: 'feature-agents',
    pops: [
      {
        at: 'pop--approve',
        html:
          '<div class="approve" data-approve-card><p class="pop__row"><span class="shield"></span><b>Coder wants to run the migration 0042_booking_slots on staging</b></p>' +
          '<p class="pop__s">HEL · Coder · 4 min ago ' +
          tag('coral', 'Urgent') +
          tag('violet', '0,84 €') +
          '</p><p class="approve__actions js-only"><button type="button" class="btn btn--approve" data-approve data-track="demo_approve">Approve</button>' +
          '<button type="button" class="btn btn--quiet" data-hold data-track="demo_hold">Not now</button></p>' +
          '<p class="approve__done" data-approved hidden><span class="dot dot--teal"></span>Approved by you. Coder continues, and the step is in the trace.</p></div>',
      },
      {
        at: 'pop--tr',
        html:
          '<p class="pop__row"><span class="bot bot--teal"></span><b>Coder</b>' +
          tag('violet', 'Acts, asks first') +
          '</p><p class="pop__s">612 € of 900 € this month · 84 % succeed</p>' +
          bar(68),
      },
    ],
  },
  {
    id: 'tests',
    rail: 'Tests',
    screen: 'test',
    alt: 'Test run 88: 17 of 24 cases passed across six browsers and devices, a failed case with its steps, and the evidence: a recording, console errors and the failed network request.',
    backdrop: 'feature-tests',
    pops: [
      {
        at: 'pop--tr',
        html:
          '<p class="pop__k">Run 88 · exports and dispatch</p><p class="pop__big">17 / 24</p><p class="pop__s">passed · sign-off by the testers</p>' +
          bar(71, 'teal'),
      },
      {
        at: 'pop--bl',
        html:
          '<p class="pop__row">' +
          tag('coral', 'failed') +
          '<b>C-412 on Firefox</b></p><p class="pop__s">Recording 0:42 · 3 console errors · traced to requirement NWL-191</p>',
      },
    ],
  },
  {
    id: 'security',
    rail: 'Security',
    screen: 'security',
    alt: 'Security findings ordered by risk: an access token in a log, a known-exploited dependency with risk 88, a key in git history; the selected finding shows CVSS, exploit likelihood and its path.',
    backdrop: 'feature-security',
    pops: [
      {
        at: 'pop--tr',
        html:
          '<p class="pop__row"><span class="risk">88</span><b>xml2js prototype pollution</b></p><p class="pop__s">' +
          tag('coral', 'KEV') +
          tag('amber', 'reachable') +
          tag('violet', 'exposed') +
          '</p>',
      },
      {
        at: 'pop--bl',
        html: '<p class="pop__row"><span class="bot"></span><b>Fix with Sentinel</b></p><p class="pop__s">Introduced by NWL-77, found from the fingerprint on that code.</p>',
      },
    ],
  },
  {
    id: 'release',
    rail: 'Release',
    screen: 'releases',
    alt: 'Releases and environments: delivery metrics, the next release of each project with its go or no-go count, and the October release train, frozen for fixes only.',
    backdrop: 'feature-release',
    pops: [
      {
        at: 'pop--tr',
        html:
          '<p class="pop__k">Train “October”</p><p class="pop__row">' +
          tag('amber', 'frozen: fixes only') +
          '</p><p class="pop__s">NWL 1.4.0 · 14 / 14 tasks · go</p>',
      },
      {
        at: 'pop--bl',
        html: '<p class="pop__row"><span class="dot dot--coral"></span><b>HEL rc.3 blocked by F-81</b></p><p class="pop__s">A finding holds the release until it is fixed.</p>',
      },
    ],
  },
  {
    id: 'command',
    rail: 'Command center',
    screen: 'command',
    alt: 'The command center: every project with its health and current work, alerts from monitoring, the latest changes, a risk heatmap, and a replay slider for the last 24 hours.',
    backdrop: 'owned',
    pops: [
      {
        at: 'pop--tr',
        html:
          '<p class="pop__row">' +
          tag('coral', '1 critical') +
          tag('amber', '2 at risk') +
          tag('violet', '4 agents at work') +
          '</p><p class="pop__s">Every project, live for everyone</p>',
      },
      {
        at: 'pop--bl',
        html: '<p class="pop__row"><span class="play"></span><b>Replay</b> 17:00 → now</p><p class="pop__s">Scrub back through the last 24 hours.</p>',
      },
    ],
  },
];

interface Chapter {
  id: string;
  n: string;
  kicker: string;
  title: string;
  text: string;
  links: [string, string][];
}

/** The chapter text, one per stop after the hero, in the same order as STOPS. */
const CHAPTERS: Chapter[] = [
  {
    id: 'idea',
    n: '01',
    kicker: 'Idea → plan',
    title: 'Plans you can defend.',
    text: 'An Analyst agent interviews the people who know, area by area, until every area is covered. Each answer becomes a requirement, a question or a decision. The PRD cites its sources, named approvers sign it off, and it becomes an epic with tasks and acceptance criteria.',
    links: [
      ['ideation.html', 'Ideation and the PRD'],
      ['planning.html', 'Planning'],
    ],
  },
  {
    id: 'work',
    n: '02',
    kicker: 'Plan and work',
    title: 'Everyone sees the same plan, live.',
    text: 'Sprints, boards, capacity and time tracking, and the interactive Gantt with its critical path and baseline. Changes appear for everyone at once, and every commit with a task fingerprint shows up on the plan.',
    links: [
      ['planning.html', 'Planning'],
      ['canvas.html', 'Canvas'],
    ],
  },
  {
    id: 'agents',
    n: '03',
    kicker: 'Agents',
    title: 'Agents do the work. A person holds the key.',
    text: 'Agents work on tasks with your own model key: Anthropic, OpenAI, Azure OpenAI, Gemini, Bedrock or Grok. Each run gets its own sandbox and opens pull requests under a bot identity. Every step that matters waits for a person, and every step is recorded. Try it: the Coder is waiting for you.',
    links: [
      ['agent-workbench.html', 'Trying and judging agents'],
      ['ai-providers.html', 'AI providers'],
    ],
  },
  {
    id: 'tests',
    n: '04',
    kicker: 'Tests',
    title: 'Every result knows which requirement it proves.',
    text: 'Test runs stream in from CI as TAP or JUnit, or are imported from Playwright, Cypress and Allure. Each result is traced to its task and requirement, failures carry their evidence, and the release gate waits for sign-off.',
    links: [['testing.html', 'Test management']],
  },
  {
    id: 'security',
    n: '05',
    kicker: 'Security and evidence',
    title: 'The riskiest finding is always at the top.',
    text: 'Secrets in files and in history, dependency findings with EPSS and known-exploited feeds, and SARIF from any scanner, ordered by real risk. Compliance evidence is collected as the work happens, not typed in later.',
    links: [['security-scanning.html', 'Security scanning']],
  },
  {
    id: 'release',
    n: '06',
    kicker: 'Release',
    title: 'Ship with the receipts.',
    text: 'Release trains across projects, promotions with approval, rollback and changelogs. A finding can hold a release until it is fixed, and clients follow along in their own portal.',
    links: [['clients-incidents-time.html', 'Clients, incidents and time']],
  },
  {
    id: 'command',
    n: '07',
    kicker: 'Command center',
    title: 'Every project, live. Yesterday on replay.',
    text: 'Health, risks, alerts and agents across the whole portfolio, live for everyone. Scrub back through the last 24 hours to see what changed, and when.',
    links: [['working-across-orqiva.html', 'Working across Orqiva']],
  },
];

const shotImg = (s: Stop, cls: string, eager: boolean): string =>
  '<img class="' +
  cls +
  '" src="media/screen-' +
  s.screen +
  '.webp" alt="' +
  esc(s.alt) +
  '" width="2000" height="1250" decoding="async"' +
  (eager ? ' fetchpriority="high"' : ' loading="lazy"') +
  '>';

// ── [PCODE-444 | S15 | v0.1.0] footage behind a section ──
/**
 * A section's background: the still when there is one, and the loop on top when it was generated
 * (a 1280×720 WebM that starts on the still's frame and loops without a seam).
 */
function film(has: (f: string) => boolean, name: string): string {
  if (!has(name + '.webp')) return '';
  return (
    '<div class="film" aria-hidden="true"><img class="film__poster" src="media/' +
    name +
    '.webp" alt="" width="1920" height="1086" loading="lazy" decoding="async">' +
    (has(name + '.webm')
      ? '<video class="film__video" data-film="media/' +
        name +
        '.webm" muted loop playsinline preload="none"></video>'
      : '') +
    '</div>'
  );
}

// ── [PCODE-445 | S15 | v0.1.0] the sections below the tour ──

const steps: [string, string, string][] = [
  ['5 min', 'Check the machine', 'Every line should start with ok. The check changes nothing.'],
  ['10 min', 'Install', 'It prints the address. Open it and create the first account.'],
  [
    '10 min',
    'Your team and first project',
    'Invite people, create a project, connect an AI provider.',
  ],
  ['', 'Your first sprint', 'Plan it, work it, close it. About an hour after you started.'],
];

/** The terminal: the real output lines of `orq install --check` and `orq install` (packages/cli). */
const TERMINAL: [string, string][] = [
  ['cmd', 'node orq.mjs install --check'],
  ['ok', 'ok    Docker: running, version 27.3.1'],
  ['ok', 'ok    Docker Compose: version 2.29.7'],
  ['ok', 'ok    Install folder: /home/you/orqiva (new install)'],
  ['ok', 'ok    Disk: 48.2 GB free'],
  ['ok', 'ok    Server: nothing answers on port 8080 (free to use)'],
  ['cmd', 'node orq.mjs install --public-url https://orqiva.your-company.example'],
  ['out', 'Waiting for Orqiva to answer (migrations run on first start)…'],
  [
    'done',
    'Orqiva is running at https://orqiva.your-company.example . Open it and create the first account.',
  ],
];

const questions: [string, string][] = [
  [
    'Does our code or data leave our network?',
    'No. Orqiva runs on your machines and nothing is sent to us. Agents call the AI provider you connect, with your key, and you choose which one.',
  ],
  [
    'Which AI models can the agents use?',
    'Anthropic, OpenAI, Azure OpenAI, Gemini, Bedrock and Grok, with fallbacks between them. Costs are shown per run.',
  ],
  [
    'What does it need to run?',
    'Docker with the Compose plugin or Docker Desktop, Node.js 22, 2 CPU cores, 2 GB of memory and 10 GB of disk. Linux, Windows or macOS.',
  ],
  [
    'What happens when a licence expires?',
    'Nothing is deleted. The free plan’s limits apply until a new key is installed.',
  ],
  [
    'Can we bring our backlog?',
    'Yes. The importers for Jira, Linear and Plane keep your issue numbers; from Plane, comments and history come along.',
  ],
];

const seatsOf = (o: Offer): string =>
  o.plan === 'free'
    ? 'Up to ' + String(o.maxSeats) + ' people'
    : o.maxSeats === null
      ? String(o.minSeats) + '+ people'
      : String(o.minSeats) + '–' + String(o.maxSeats) + ' people';

const planCard = (o: Offer): string =>
  '<li class="plan' +
  (o.plan === 'free' ? ' plan--free' : '') +
  '">' +
  (o.plan === 'free' ? '<span class="plan__ribbon">Start here</span>' : '') +
  '<h3 class="plan__name">' +
  esc(o.name) +
  '</h3><p class="plan__price">' +
  esc(priceLabel(o)) +
  (o.pricePerSeatMonth !== null ? '<small> per person/month</small>' : '') +
  '</p><p class="plan__who">' +
  esc(o.audience) +
  ' · ' +
  esc(seatsOf(o)) +
  '</p><ul class="plan__list">' +
  o.includes.map((x) => '<li>' + esc(x) + '</li>').join('') +
  '</ul>' +
  (o.plan === 'free'
    ? cta('plans_install', 'Install free', ' btn--block')
    : '<a class="btn btn--ghost btn--block" href="pricing.html" data-track="plans_compare">See ' +
      esc(o.name) +
      '</a>') +
  '</li>';

export function landingPage(input: LandingInput): string {
  const has = (f: string): boolean => input.media.has(f);
  const ogImage = has('og.jpg');
  const description =
    'Orqiva is a self-hosted engineering command center: the plan, the work, the tests, the security findings, the evidence and the release in one place, on your own machines. People and AI agents work side by side.';
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Orqiva',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Linux, Windows, macOS (Docker)',
    softwareVersion: input.version,
    description,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', description: FREE_LINE },
  };

  const stops = STOPS.filter((s) => has('screen-' + s.screen + '.webp'));
  // ── [PCODE-449 | S15 | v0.1.0] the product in use: a recorded clip over the screen, loaded on demand ──
  const clip = (s: Stop, cls: string): string =>
    has('clip-' + s.screen + '.webm')
      ? '<video class="' +
        cls +
        '" data-clip="media/clip-' +
        s.screen +
        '.webm" muted loop playsinline preload="none" aria-hidden="true"></video>'
      : '';
  const stopOf = (id: string): Stop | undefined => stops.find((s) => s.id === id);

  // the deck: every screen in one 3D rig, its cards floating in front of it
  const deck = stops
    .map(
      (s, i) =>
        '<figure class="shot" data-shot="' +
        String(i) +
        '"><div class="shot__frame">' +
        shotImg(s, 'shot__img', i === 0) +
        clip(s, 'shot__video') +
        '<span class="shot__dim"></span></div>' +
        s.pops.map((p) => '<div class="pop ' + p.at + '">' + p.html + '</div>').join('') +
        '</figure>',
    )
    .join('');

  const backdrops = stops
    .filter((s) => has(s.backdrop + '.webp'))
    .map(
      (s) =>
        '<img class="tour__bg" data-bg="' +
        String(stops.indexOf(s)) +
        '" src="media/' +
        s.backdrop +
        '.webp" alt="" width="1920" height="1086" loading="lazy" decoding="async">',
    )
    .join('');

  const rail = stops
    .map(
      (s, i) =>
        '<li><a class="rail__stop" href="#' +
        s.id +
        '" data-rail="' +
        String(i) +
        '" data-track="rail_jump"><span class="rail__dot"></span><span class="rail__label">' +
        esc(s.rail) +
        '</span></a></li>',
    )
    .join('');

  const approveHtml = STOPS.flatMap((s) => s.pops).find((p) => p.at === 'pop--approve')?.html;
  const chapters = CHAPTERS.map((c) => {
    const s = stopOf(c.id);
    const i = s ? stops.indexOf(s) : -1;
    return (
      '<section class="chapter" id="' +
      c.id +
      '" data-chapter="' +
      String(i) +
      '" aria-labelledby="' +
      c.id +
      '-h"><div class="chapter__text">' +
      '<p class="kicker"><span class="kicker__n">' +
      c.n +
      '</span>' +
      esc(c.kicker) +
      '</p><h2 id="' +
      c.id +
      '-h">' +
      esc(c.title) +
      '</h2><p>' +
      esc(c.text) +
      '</p>' +
      // [PCODE-445 | S15 | v0.1.0] phones have no deck: the approval card sits in the chapter itself
      (c.id === 'agents' && approveHtml
        ? '<div class="pop chapter__demo">' + approveHtml + '</div>'
        : '') +
      '<p class="chapter__links">' +
      c.links
        .map(
          ([href, label]) =>
            '<a href="' + href + '" data-track="chapter_doc">' + esc(label) + '</a>',
        )
        .join('') +
      '</p></div>' +
      (s
        ? '<figure class="chapter__shot">' +
          shotImg(s, 'chapter__img', false) +
          clip(s, 'chapter__video') +
          '</figure>'
        : '') +
      '</section>'
    );
  }).join('');

  const hero = stops[0];
  const footage = film(has, 'owned');

  const body = [
    '<a class="skip" href="#main">Skip to the content</a>',
    // [PCODE-448 | S15 | v0.1.0] the Orqiva mark in the bar and the footer
    '<header class="bar" data-bar><a class="bar__brand" href="index.html" aria-label="Orqiva home"><img class="mark" src="logo.svg" alt="" width="30" height="30">Orqiva</a>' +
      '<nav class="bar__nav" aria-label="Main"><a href="#idea">Product</a><a href="#owned">Security</a><a href="#plans">Pricing</a><a href="overview.html">Docs</a></nav>' +
      '<a class="btn btn--primary btn--small" href="getting-started.html" data-track="nav_install">Install free</a></header>',
    '<main id="main">',

    '<div class="tour" data-tour>',
    '<div class="tour__sticky">' +
      '<div class="tour__bgs" aria-hidden="true">' +
      backdrops +
      '</div><div class="tour__aurora" aria-hidden="true"></div>' +
      '<div class="tour__scene" data-scene><div class="tour__rig" data-rig>' +
      deck +
      '</div></div>' +
      (stops.length > 1
        ? '<nav class="rail" aria-label="Product tour"><span class="rail__track"><span class="rail__fill" data-rail-fill></span></span><ol>' +
          rail +
          '</ol></nav>'
        : '') +
      // [PCODE-449 | S15 | v0.1.0] moving screens can always be paused (WCAG 2.2.2)
      (stops.some((s) => has('clip-' + s.screen + '.webm'))
        ? '<button type="button" class="motion js-only" data-motion aria-pressed="false" data-track="motion_toggle"><span class="motion__icon" aria-hidden="true"></span><span data-motion-label>Pause the screens</span></button>'
        : '') +
      '<p class="tour__note">Screens from Orqiva with sample data</p>' +
      '</div>',
    '<div class="tour__chapters">',
    '<section class="hero chapter" id="top" data-chapter="0" aria-labelledby="hero-h"><div class="chapter__text">' +
      '<p class="eyebrow"><span class="eyebrow__dot"></span>Self-hosted engineering command center</p>' +
      '<h1 id="hero-h">From idea to release,<br><span class="h1__band">in one place you own.</span></h1>' +
      '<p class="hero__lead">Orqiva keeps the plan, the work, the tests, the security findings, the evidence and the release in one place, running on your own servers. People and AI agents work side by side, and a person approves every step that matters.</p>' +
      '<p class="hero__actions">' +
      cta('hero_install') +
      '<a class="btn btn--ghost" href="#idea" data-track="hero_tour">Take the tour</a></p>' +
      '<p class="hero__fine">' +
      esc(FREE_LINE) +
      ' · about an hour from Docker to your first sprint</p></div>' +
      (hero
        ? '<figure class="chapter__shot">' +
          shotImg(hero, 'chapter__img', true) +
          clip(hero, 'chapter__video') +
          '</figure>'
        : '') +
      '</section>',
    chapters,
    '</div></div>',

    '<section class="band band--owned' +
      (footage ? ' has-film' : '') +
      '" id="owned" aria-labelledby="owned-h">' +
      footage +
      '<div class="band__inner"><p class="kicker"><span class="kicker__n">⌂</span>Your machines</p>' +
      '<h2 id="owned-h">All of it stays inside your walls.</h2>' +
      '<p class="band__lead">Orqiva runs on one Docker host, a Kubernetes cluster, or a site without internet. Your code and your data never leave them. It is our own code, on Node.js and PostgreSQL, and no third-party licence terms stand between you and running it.</p>' +
      '<dl class="facts">' +
      '<div><dt>1</dt><dd>third-party runtime library in the server: the PostgreSQL driver</dd></div>' +
      '<div><dt>Every</dt><dd>API route is called without a session and from another workspace, on every change. None may answer with data.</dd></div>' +
      '<div><dt>2×</dt><dd>every request is checked against membership and role, then again by PostgreSQL row-level security</dd></div>' +
      '<div><dt>0</dt><dd>default passwords. Each install gets generated database passwords.</dd></div>' +
      '</dl>' +
      '<p class="band__note">Single sign-on with OpenID Connect and SAML 2.0, SCIM 2.0 provisioning, two-step sign-in, and a strict Content Security Policy.</p>' +
      '<p class="chapter__links"><a href="install.html" data-track="section_doc">Docker</a><a href="kubernetes.html" data-track="section_doc">Kubernetes</a><a href="offline-and-backups.html" data-track="section_doc">Without internet</a><a href="security.html" data-track="section_doc">How your data is protected</a><a href="licences.html" data-track="section_doc">Licences</a></p>' +
      '</div></section>',

    '<section class="band band--start" id="first-hour" aria-labelledby="start-h"><div class="band__glow" aria-hidden="true"></div><div class="band__inner split">' +
      '<div class="split__text"><p class="kicker"><span class="kicker__n">⏱</span>The first hour</p>' +
      '<h2 id="start-h">Your first sprint is about an hour away.</h2>' +
      '<ol class="steps">' +
      steps
        .map(
          ([time, title, text], i) =>
            '<li class="step"><span class="step__n">' +
            String(i + 1) +
            '</span><div><h3>' +
            esc(title) +
            (time ? '<span class="step__time">' + esc(time) + '</span>' : '') +
            '</h3><p>' +
            esc(text) +
            '</p></div></li>',
        )
        .join('') +
      '</ol>' +
      '<p class="band__note">You need Docker, Node.js 22, 2 CPU cores, 2 GB of memory and 10 GB of disk. <code>orq.mjs</code> is the whole command line in one file.</p>' +
      '<p class="hero__actions">' +
      cta('start_install', 'Follow the guide') +
      '<a class="btn btn--ghost" href="migrate.html" data-track="start_migrate">Moving from Jira, Linear or Plane</a></p></div>' +
      '<figure class="term" data-term><div class="term__bar"><span></span><span></span><span></span><b>orqiva — install</b>' +
      '<button type="button" class="term__copy js-only" data-copy="node orq.mjs install --check" data-track="copy_command">Copy the first command</button></div>' +
      '<pre class="term__body">' +
      TERMINAL.map(
        ([kind, line]) =>
          '<span class="term__line term__line--' +
          kind +
          '">' +
          (kind === 'cmd' ? '<span class="term__ps">$ </span>' : '') +
          esc(line) +
          '</span>',
      ).join('') +
      '</pre><figcaption>The real output of <code>orq install</code>; versions and paths are examples.</figcaption></figure>' +
      '</div></section>',

    '<section class="band band--plans" id="plans" aria-labelledby="plans-h"><div class="band__glow band__glow--warm" aria-hidden="true"></div><div class="band__inner">' +
      '<div class="center"><p class="kicker kicker--center"><span class="kicker__n">€</span>Plans</p>' +
      '<h2 id="plans-h">Start free. Pay when the team grows.</h2>' +
      '<p class="band__lead">One price for every install type, per person and month, billed yearly. AI agents use your own model key, so model costs stay between you and your provider.</p></div>' +
      '<ul class="plans">' +
      OFFERS.map(planCard).join('') +
      '</ul>' +
      '<p class="band__note center">' +
      (PRICING_DRAFT ? 'These prices are a draft and not final yet. ' : '') +
      '<a href="pricing.html" data-track="section_pricing">Compare the plans</a></p>' +
      '</div></section>',

    '<section class="band band--faq" id="questions" aria-labelledby="faq-h"><div class="band__inner split split--faq">' +
      '<div class="split__text"><h2 id="faq-h">Questions before you install</h2>' +
      '<p class="band__lead">Still deciding? Everything waiting for a person lands in one inbox, like this one.</p>' +
      (has('screen-inbox.webp')
        ? '<figure class="faq__shot"><img src="media/screen-inbox.webp" alt="The Orqiva inbox: decisions, reviews, questions from agents and mentions, each with its project and how urgent it is." width="2000" height="1250" loading="lazy" decoding="async"><figcaption>Sample data</figcaption></figure>'
        : '') +
      '</div><div class="faqs">' +
      questions
        .map(
          ([q, a]) =>
            '<details class="faq" data-track-open="faq_open"><summary>' +
            esc(q) +
            '</summary><p>' +
            esc(a) +
            '</p></details>',
        )
        .join('') +
      '</div></div></section>',

    // [PCODE-451 | S15 | v0.1.0] the finale: the Orqiva mark in 3D (client/mark3d.ts) and the name
    '<section class="finale" id="start" aria-labelledby="finale-h">' +
      '<div class="finale__light" aria-hidden="true"></div>' +
      '<div class="finale__inner"><div class="mark3d" data-mark3d aria-hidden="true">' +
      '<img class="mark3d__still" src="logo.svg" alt="" width="240" height="240">' +
      '<canvas class="mark3d__canvas" data-mark3d-canvas></canvas></div>' +
      '<p class="wordmark" aria-label="Orqiva">' +
      ['O', 'r', 'q', 'i', 'v', 'a']
        .map(
          (ch, i) =>
            '<span aria-hidden="true" class="wordmark__l wordmark__l--' +
            String(i) +
            '">' +
            ch +
            '</span>',
        )
        .join('') +
      '</p>' +
      '<h2 id="finale-h">Start on your own machine today.</h2>' +
      // [PCODE-452 | S15 | v0.1.0] the line fades in after the name
      '<p class="finale__line">' +
      esc(FREE_LINE) +
      '.</p><p class="hero__actions hero__actions--center">' +
      cta('final_install', 'Install free', ' btn--large') +
      '<a class="btn btn--ghost" href="overview.html" data-track="final_docs">Read the docs</a></p></div></section>',
    '</main>',
    '<footer class="foot2"><div class="foot2__inner"><span class="bar__brand"><img class="mark" src="logo.svg" alt="" width="30" height="30">Orqiva</span>' +
      '<nav aria-label="Footer"><a href="overview.html">Overview</a><a href="getting-started.html">Getting started</a><a href="pricing.html">Pricing</a><a href="security.html">Security</a><a href="licences.html">Licences</a><a href="cli.html">CLI</a><a href="api.html">API</a></nav>' +
      '<span class="foot2__ver">v' +
      esc(input.version) +
      ' · self-hosted engineering command center</span></div></footer>',
  ].join('\n');

  const page =
    [
      '<!doctype html>',
      '<html lang="en" class="no-js">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>Orqiva · Idea to release, on your own machines</title>',
      '<meta name="description" content="' + esc(description) + '">',
      '<meta name="theme-color" content="#0c0b1d">',
      '<meta property="og:type" content="website">',
      '<meta property="og:title" content="Orqiva · Idea to release, on your own machines">',
      '<meta property="og:description" content="' + esc(description) + '">',
      ogImage ? '<meta property="og:image" content="media/og.jpg">' : '',
      '<meta name="twitter:card" content="' + (ogImage ? 'summary_large_image' : 'summary') + '">',
      '<link rel="icon" href="favicon.svg" type="image/svg+xml">',
      hero ? '<link rel="preload" as="image" href="media/screen-' + hero.screen + '.webp">' : '',
      '<link rel="stylesheet" href="' + esc(input.styleHref) + '">',
      '<script type="module" src="' + esc(input.scriptHref) + '"></script>',
      // structured data is not executed, so a strict script-src does not block it
      '<script type="application/ld+json">' +
        JSON.stringify(ld).replace(/</g, '\\u003c') +
        '</script>',
      '</head>',
      '<body class="landing">',
      body,
      '</body>',
      '</html>',
      '',
    ]
      .filter((l) => l !== '')
      .join('\n') + '\n';
  // [PCODE-450 | S15 | v0.1.0] every media URL carries its file's content hash: media are cached for a
  // week, and a re-encoded clip must never be served from a visitor's cache
  const hashOf = input.mediaHash;
  return hashOf
    ? page.replace(/"media\/([\w.-]+)"/g, (m, file: string) => {
        const h = hashOf(file);
        return h ? '"media/' + file + '?v=' + h + '"' : m;
      })
    : page;
}
