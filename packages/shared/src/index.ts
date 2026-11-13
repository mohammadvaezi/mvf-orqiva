// ── [PCODE-347 | S15 | v0.1.0] T35.1b Homes for developers and testers with widgets the person chooses ──
// ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
// ── [PCODE-331 | S15 | v0.1.0] T33.3b Evals: saved cases with checks, eval runs per model or prompt version, pass rates over time ──
// ── [PCODE-330 | S15 | v0.1.0] T33.3a Run quality: annotations, judge scores, outcomes ──
// ── [PCODE-328 | S15 | v0.1.0] T33.1b Cost estimate before a run, chargeback per client and cost centre, unit costs ──
// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-324 | S15 | v0.1.0] T32.8a Fix pull requests for findings: dependency upgrades and AI fixes ──
// ── [PCODE-323 | S15 | v0.1.0] T32.7b VEX statements and the security posture per version ──
// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
// ── [PCODE-319 | S15 | v0.1.0] T32.5a Bug capture on the server: a report with page, device, console, network and actions becomes a bug ──
// ── [PCODE-318 | S15 | v0.1.0] T32.4b Masking of personal data in test results and the test-data vault ──
// ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
// ── [PCODE-313 | S15 | v0.1.0] T32.1 Test repository: shared steps, parameters in the screen, structured BDD ──
// ── [PCODE-309 | S15 | v0.1.0] T31.8b Architecture graph, change coupling and bus factor on the code map ──
// ── [PCODE-308 | S15 | v0.1.0] T31.8a Code map by feature, sprint and version, and its time-lapse ──
// ── [PCODE-307 | S15 | v0.1.0] T31.7 Environment config diff: variables, secrets, settings, flags and versions side by side ──
// ── [PCODE-306 | S15 | v0.1.0] T31.6 Versions from commits: conventional commits, tags and components per path ──
// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
// ── [PCODE-285 | S15 | v0.1.0] T29.7 Documents import (Markdown, Notion, Confluence) and export (Markdown, HTML, PDF, ZIP) ──
// ── [PCODE-282 | S15 | v0.1.0] T29.4 Live co-editing of documents with our own three-way merge ──
// ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
// ── [PCODE-279 | S15 | v0.1.0] T29.1 Document blocks: callouts, math and Mermaid diagrams rendered by our own code ──
// ── [PCODE-276 | S15 | v0.1.0] T28.5 Idea estimates: size, confidence range from estimate vs actual, basis from similar past tasks ──
// ── [PCODE-275 | S15 | v0.1.0] T28.4 PRD: templates per idea kind, citations per statement, version diff, MD, PDF and Word export ──
// ── [PCODE-274 | S15 | v0.1.0] T28.3 Stories with Given/When/Then and personas; value/effort matrix, evidence library, compare ──
// ── [PCODE-263 | S15 | v0.1.0] T27.5 Plan files: MS Project XML and CSV export and import, iCal of the plan ──
// ── [PCODE-195 | S15 | v0.1.0] B8.3 CLI parity: inbox, approvals, comments, time, agents and ideas from the terminal, offline queue ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
// ── [PCODE-187 | S15 | v0.1.0] B7.3 Time live: timer from the active task, weekly timesheets with approval and lock, rates, absences, reports per client ──
// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
// ── [PCODE-162 | S15 | v0.1.0] B1.1 Live shell server: inbox, notification rules, settings inheritance, shell summary ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
// ── [PCODE-124 | S15 | v0.1.0] Generate proposals with an estimate from the interview, with versions ──
// ── [PCODE-131 | S15 | v0.1.0] Add environments and the secrets vault ──
// ── [PCODE-139 | S15 | v0.1.0] Add security findings with SARIF import, tasks for findings and the security gate ──
// ── [PCODE-143 | S15 | v0.1.0] Map compliance controls for ISO 27001, SOC 2, GDPR and the EU CRA to live evidence ──
// ── [PCODE-148 | S15 | v0.1.0] Add signed licence keys with seats, features and expiry ──
//    Why:  the one place every package reads the product's identity and protocol version from.

/** The product name as users see it. */
export const PRODUCT_NAME = 'Orqiva';

/** The platform version; every package of one release carries the same one. */
export const PLATFORM_VERSION = '0.1.0';

/**
 * Version of the wire protocol between the server and its clients (web, VS Code, CLI, mobile).
 * Raised on any breaking change, so a client can refuse a server it does not understand.
 */
export const PROTOCOL_VERSION = 1;

// [PCODE-89 | S15 | v0.1.0] the activity event envelope every client reads
export * from './events.js';

// [PCODE-95 | S15 | v0.1.0] the live protocol between server and clients
export * from './live.js';

// [PCODE-103 | S15 | v0.1.0] fingerprint rules, the same for every tool
export * from './fingerprint.js';

// [PCODE-105 | S15 | v0.1.0] the live client of the web app and the VS Code extension
export * from './liveclient.js';

// [PCODE-113 | S15 | v0.1.0] activity events as sentences, for every client
export * from './activitytext.js';

// [PCODE-117 | S15 | v0.1.0] lifecycle definitions and state
export * from './lifecycle.js';

// [PCODE-124 | S15 | v0.1.0] proposals: shape, checks and the computed estimate
export * from './proposal.js';

// [PCODE-131 | S15 | v0.1.0] deploy targets, their settings and secret names
export * from './environments.js';

// [PCODE-139 | S15 | v0.1.0] security findings and SARIF
export * from './findings.js';

// [PCODE-143 | S15 | v0.1.0] compliance frameworks, controls and evidence sources
export * from './compliance.js';

// [PCODE-148 | S15 | v0.1.0] licences: format, plans and what they allow
export * from './licence.js';
// [PCODE-219 | S15 | v0.1.0] the offers: prices, seat ranges and contents of the plans
export * from './pricing.js';

// [PCODE-151 | S15 | v0.1.0] who a comment mentions
export * from './mentions.js';

// [PCODE-162 | S15 | v0.1.0] settings and their inheritance
export * from './settings.js';
// [PCODE-165 | S15 | v0.1.0] the scheduling engine
export * from './schedule.js';
// [PCODE-169 | S15 | v0.1.0] documents and the UI kit
export * from './docs.js';
// [PCODE-175 | S15 | v0.1.0] test and version rules
export * from './quality.js';
export * from './testdesign.js'; // [PCODE-313 | S15 | v0.1.0]
export * from './testquality.js'; // [PCODE-315 | S15 | v0.1.0]
export * from './testimpact.js'; // [PCODE-317 | S15 | v0.1.0]
export * from './testdata.js'; // [PCODE-318 | S15 | v0.1.0]
export * from './bugreport.js'; // [PCODE-319 | S15 | v0.1.0]
export * from './vulnfeeds.js'; // [PCODE-322 | S15 | v0.1.0]
export * from './vex.js'; // [PCODE-323 | S15 | v0.1.0]
export * from './fixes.js'; // [PCODE-324 | S15 | v0.1.0]
// [PCODE-176 | S15 | v0.1.0] security posture and code map rules
export * from './posture.js';
// [PCODE-180 | S15 | v0.1.0] agent rules, money and forecast
export * from './agents.js';
// [PCODE-181 | S15 | v0.1.0] access tokens, IP allow-list, spend anomalies
export * from './tokens.js';
// [PCODE-182 | S15 | v0.1.0] roles and what they may do
export * from './people.js';
// [PCODE-183 | S15 | v0.1.0] the activity query language
export * from './activityquery.js';
// [PCODE-184 | S15 | v0.1.0] insights: median, weeks, workdays, load
export * from './insights.js';
// [PCODE-185 | S15 | v0.1.0] client requests: numbers, steps, response times
export * from './clientrequests.js';
// [PCODE-187 | S15 | v0.1.0] time: rates, weeks, hours, timers, absences
export * from './time.js';
// [PCODE-188 | S15 | v0.1.0] on-call rotations, severity, error budgets
export * from './oncall.js';
// [PCODE-192 | S15 | v0.1.0] PRODENGINE_* variables still work
export * from './legacyenv.js';
// [PCODE-195 | S15 | v0.1.0] how an agent's steps are worded everywhere
export * from './agentsteps.js';
// [PCODE-197 | S15 | v0.1.0] documentation built from the code, and drift
export * from './codedocs.js';
// [PCODE-199 | S15 | v0.1.0] what a project needs before it hands over
export * from './handover.js';
// [PCODE-203 | S15 | v0.1.0] release trains across projects
export * from './trains.js';
// [PCODE-205 | S15 | v0.1.0] changelogs
export * from './changelog.js';
// [PCODE-209 | S15 | v0.1.0] portfolio health and heatmap
export * from './portfolio.js';
// [PCODE-224 | S15 | v0.1.0] phone sign-in by pairing code, and the QR code that carries it
export * from './pairing.js';
export * from './qr.js';
// [PCODE-225 | S15 | v0.1.0] the phone's live feed and its offline cache
export * from './feed.js';
// [PCODE-234 | S15 | v0.1.0] conversations inside the app
export * from './messages.js';
// [PCODE-246 | S15 | v0.1.0] agent triggers: schedules and mentions
export * from './triggers.js';
// [PCODE-247 | S15 | v0.1.0] agent scopes: files, branches, hosts
export * from './scope.js';
// [PCODE-247 | S15 | v0.1.0] secrets cleaned out of traces
export * from './redact.js';
// [PCODE-252 | S15 | v0.1.0] estimates: units, poker, similar tasks
export * from './estimate.js';
// [PCODE-253 | S15 | v0.1.0] capacity from profiles, absences and holidays
export * from './capacity.js';
// [PCODE-254 | S15 | v0.1.0] links, repeats, definitions
export * from './flow.js';
// [PCODE-255 | S15 | v0.1.0] bug fix times and Git moves
export * from './sla.js';
// [PCODE-256 | S15 | v0.1.0] states over time and flow statistics
export * from './flowstats.js';
// [PCODE-257 | S15 | v0.1.0] custom fields
export * from './custom.js';
// [PCODE-263 | S15 | v0.1.0] plan files: MS Project XML, CSV, iCal
export * from './planfiles.js';
// [PCODE-274 | S15 | v0.1.0] user stories, scenarios and Gherkin
export * from './stories.js';
// [PCODE-275 | S15 | v0.1.0] the PRD: templates, citations, diff, Markdown
export * from './prd.js';
// [PCODE-276 | S15 | v0.1.0] an idea's size and range
export * from './ideaestimate.js';
// [PCODE-279 | S15 | v0.1.0] math and diagrams in pages
export * from './texmath.js';
export * from './mermaid.js';
// [PCODE-281 | S15 | v0.1.0] embeds in pages
export * from './embeds.js';
// [PCODE-282 | S15 | v0.1.0] three-way merge for live editing
export * from './merge3.js';
// [PCODE-285 | S15 | v0.1.0] import and export of pages
export * from './htmlmd.js';
export * from './mdhtml.js';
// [PCODE-287 | S15 | v0.1.0] colours and tokens for iOS and Android, W3C import
export * from './designtokens.js';
// [PCODE-289 | S15 | v0.1.0] brand book from the tokens
export * from './brand.js';
// [PCODE-290 | S15 | v0.1.0] the kit in the code: usage, lint, agent rule
export * from './kitscan.js';
// [PCODE-291 | S15 | v0.1.0] component previews
export * from './kitpreview.js';
// [PCODE-292 | S15 | v0.1.0] handoff specs
export * from './handoff.js';
// [PCODE-293 | S15 | v0.1.0] generated asset sizes
export * from './assetsizes.js';
// [PCODE-296 | S15 | v0.1.0] accessibility checks
export * from './a11y.js';
// [PCODE-297 | S15 | v0.1.0] Figma two-way sync
export * from './figmasync.js';
// [PCODE-300 | S15 | v0.1.0] closing words and reverts
export * from './gitwork.js';
// [PCODE-302 | S15 | v0.1.0] pull request review: patches, side by side, fingerprints, risk
export * from './review.js';
// [PCODE-304 | S15 | v0.1.0] merge policies and stacks
export * from './mergepolicy.js';
// [PCODE-306 | S15 | v0.1.0] versions from conventional commits, per path
export * from './commitversions.js';
// [PCODE-307 | S15 | v0.1.0] two environments' configuration side by side
export * from './envdiff.js';
// [PCODE-308 | S15 | v0.1.0] the code map by feature, sprint and version, and its time-lapse
export * from './codework.js';
// [PCODE-309 | S15 | v0.1.0] architecture graph, change coupling, bus factor
export * from './codearch.js';
// [PCODE-327 | S15 | v0.1.0] cache and reasoning tokens priced, the ECB's daily rate
export * from './usage.js';
// [PCODE-328 | S15 | v0.1.0] run estimates, chargeback and unit costs
export * from './chargeback.js';
// [PCODE-330 | S15 | v0.1.0] run quality: tags, the judge's rubric, outcomes
export * from './runquality.js';
// [PCODE-331 | S15 | v0.1.0] eval checks and results
export * from './evals.js';
// [PCODE-341 | S15 | v0.1.0] incident update templates
export * from './updates.js';
export * from './runbooks.js'; // [PCODE-342 | S15 | v0.1.0]
export * from './datev.js'; // [PCODE-343 | S15 | v0.1.0]
export * from './timeidle.js';
export * from './homewidgets.js'; // [PCODE-347 | S15 | v0.1.0]
export * from './emailin.js'; // [PCODE-348 | S15 | v0.1.0]
export * from './bridges.js'; // [PCODE-349 | S15 | v0.1.0]
export * from './templatelibrary.js'; // [PCODE-350 | S15 | v0.1.0]
export * from './policies.js'; // [PCODE-352 | S15 | v0.1.0]
export * from './systemhealth.js'; // [PCODE-353 | S15 | v0.1.0]
export * from './activityviews.js'; // [PCODE-355 | S15 | v0.1.0] // [PCODE-344 | S15 | v0.1.0]
