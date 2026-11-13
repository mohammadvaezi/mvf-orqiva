<!-- [PCODE-278 | S15 | v0.1.0] T28.7 T28 exit check, docs and sprint close -->
<!-- [PCODE-286 | S15 | v0.1.0] T29.8 T29 exit check, docs and sprint close -->
<!-- [PCODE-298 | S15 | v0.1.0] T30.11 T30 exit check, docs and sprint close -->
<!-- [PCODE-312 | S15 | v0.1.0] T31.10 T31 exit check, docs and sprint close -->
<!-- [PCODE-326 | S15 | v0.1.0] T32.9 T32 exit check, docs and sprint close -->
<!-- [PCODE-335 | S15 | v0.1.0] T33.5 T33 exit check, docs and sprint close -->
<!-- [PCODE-265 | S15 | v0.1.0] T27.7 T27 exit check, docs and sprint close -->
<!-- [PCODE-258 | S15 | v0.1.0] T26.7 T26 exit check, docs and sprint close -->
<!-- [PCODE-251 | S15 | v0.1.0] T25.6 T25 exit check, docs and sprint close -->
<!-- [PCODE-232 | S15 | v0.1.0] Replan: version 1 complete before the mobile app (feature audit, new sprint plan) -->
<!-- [PCODE-233 | S15 | v0.1.0] Version 1 plan: record the owner decisions and adjust the sprints -->

# Plan to version 1: complete, tested, refined; then mobile

**Decision (owner, 11 Oct 2026).** The mobile app pauses after T22. First, version 1 of the product
must be complete: every feature of [the spec](command-center-spec.md) built and working. Then the order
is:

1. test the whole product;
2. fix the UX issues the tests find;
3. update the features from real use and feedback;
4. release version 1.0.

Only after that does the mobile app continue: its approvals, push, lock-screen status and the store
release (the old T23 and T24).

The starting point is [v1-audit.md](v1-audit.md), the gap list per section from 11 Oct 2026.

## The order, and why

1. **Foundations first.** Email, and making stored settings act, come before new features. Many
   sections depend on them: invitations, digests, budget warnings, agent triggers, role checks.
2. **Then the sections, by how often people use them.** The daily work comes first: planning, canvas,
   tasks, documents, then review and test. The specialist areas follow.
3. **Cross-cutting last in the build.** Search, homes, integrations, languages and accessibility sweep
   over everything already built.
4. **Every sprint ends with a working product.** Each sprint keeps its tests green and its screens
   checked, as now. Nothing is left as a mockup.

## Phase 1: build version 1 (T23–T35)

| Sprint | Theme                                                                                                                                                                 | Content (from the audit)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T23    | **Communication inside the app, and email** (done 11 Oct 2026; magic-link portal invitations moved to T34, replies by email and doc and run links in messages to T35) | Conversations in Orqiva itself, so a team needs no Slack or Teams: channels per workspace, project and client, direct and group messages, threads, mentions, reactions, files, read state, search, unread counts, live in the web app and VS Code; tasks, docs and runs linked into messages; a message becomes a task. Email as one more channel: our own SMTP sender (no dependency, STARTTLS, a queue with retries, a test-mail page), tested against a local test server; the real mail server is connected later. Password reset, invitation mails, magic-link portal invitations with MFA, email notifications and digests, expiring-token mails, client status updates and replies by email work once a server is configured, and fall back to in-app messages and links without one. |
| T24    | **AI providers and reading files** (done 11 Oct 2026)                                                                                                                 | One provider layer for Anthropic, OpenAI, Azure OpenAI, Google Gemini, Amazon Bedrock and xAI Grok: keys per workspace and project, models and prices, fallbacks, usage and cost recorded the same way. Text and audio from files through these models: PDF, DOCX, images (OCR) and audio (transcripts), with the provider chosen per workspace. Used by ideation intake, documents, test evidence and requests.                                                                                                                                                                                                                                                                                                                                                                             |
| T25    | **Make stored settings act** (done 11 Oct 2026; project leads as project admins and budget warnings at 50/80/100 % moved to T35)                                      | Agent triggers (schedule, assignment, label, mention, CI failure, webhook). Agent file, branch and network scopes enforced, with trace redaction. Custom roles, role conditions and project roles enforced. Budget and anomaly alerts. Watch notifications for docs. Stale-flag and stale-idea reminders. Profile screen (skills, capacity, time zone, hours, manager, cost rate). GDPR export and erasure. A version check on task edits.                                                                                                                                                                                                                                                                                                                                                   |
| T26    | **Planning** (done 11 Oct 2026; a web filter for custom fields and setting WIP limits on the board moved to T37)                                                      | Hours and T-shirt sizes, async planning poker, AI estimates from similar tasks, estimate vs actual. Capacity with absences, holidays, focus factor and agents. The Planner proposes new stories and estimates. Relates and duplicates links, WIP limits, scheduling warnings. Definition of done, a triage inbox, templates, recurring tasks. Keyboard keys, bulk edit, undo, shared views, item history screen. Moves on branch, PR and merge; bug SLAs. Burnup, cumulative flow, control chart. Initiatives, custom types and fields.                                                                                                                                                                                                                                                      |
| T27    | **Canvas** (done 12 Oct 2026; splits in MS Project XML and a drawn whiteboard moved to T37)                                                                           | An interactive Gantt: drag, resize, link, shift-drag, split, zoom to month and year, colour rules, outline levels, constraint types, an auto/manual switch. A grid with fill down, paste from Excel, formulas, indent and outdent. Timeline, mind map and portfolio views. Agents as resources and a heat map. Scenario diff per task. Commits and PRs on the bars. Export (MS Project XML and CSV in and out, PDF, PNG, iCal, share link).                                                                                                                                                                                                                                                                                                                                                  |
| T28    | **Ideation and the PRD** (done 12 Oct 2026; ideas from incoming email moved to T35)                                                                                   | Intake from PDF, DOCX, images, audio and links (reading through the T24 provider layer). Coverage-steered interview and question notifications. Stories as Given/When/Then, a personas tab. PRD diff, citations per statement, templates, MD, PDF and DOCX export. Named approvers, the in-review and superseded states, reopen on edit through the shared approvals block. Promote to an epic with stories. Estimates with confidence. The client takes part in ideation and e-signs.                                                                                                                                                                                                                                                                                                       |
| T29    | **Documents** (done 12 Oct 2026; Notion databases and Confluence XML not read)                                                                                        | A block editor (Mermaid, math, callouts, embeds of designs, Gantt, live task lists and code). Live co-editing (our own merge of concurrent edits). Mentions, watch notifications, named versions and a visual diff. Search in the screen and in Cmd-K. Drag to reorder, files in the tree, paste to upload, image annotation, read analytics. Import from Markdown, Confluence and Notion exports; export to PDF, MD and HTML. Per-task knowledge scopes, checked citations, README import.                                                                                                                                                                                                                                                                                                  |
| T30    | **UI kit and design** (done 12 Oct 2026; a real Figma account and Figma webhooks in T39; screenshots and page audits run by CI)                                       | Brand pages. More themes and modes. iOS and Android token export and export as a pull request. W3C import. Component usage counted from the code, and a live preview. Generated asset sizes and a download portal. Handoff specs. Overlay compare, client pins. Accessibility checks (focus order, target size, alt text), a lint for non-token values, visual regression. The agent rule (generated UI uses the kit). Figma two-way sync built now and tested against recorded Figma API answers; connected to a real Figma account at the end (T39).                                                                                                                                                                                                                                       |
| T31    | **Code review and Versions** (done 14 Oct 2026; tested against recorded host answers, Bitbucket not included)                                                         | A PR review queue, a side-by-side diff with overlays, AI comments on lines to accept or dismiss, code review in VS Code. GitLab and Azure Repos. Branches, tags and webhook backfill. Conflicts, stacked PRs, merge queue. Commit statuses that enforce merge policies. Close tasks on merge, revert detection. Versions from commits and per path. Environment config diff. Code map by feature, sprint and version, architecture graph, change coupling, bus factor. MCP tools for the code map.                                                                                                                                                                                                                                                                                           |
| T32    | **Test and security** (done 15 Oct 2026; Firefox build not run, IaC/container/DAST scanners not built)                                                                | Shared steps, parameters, BDD, assignment and workload, Cypress and Allure import, defects in the trace, leakage and burndown, a release gate on tests, keyboard entry, auto-reopen, data masking, AI triage and impacted tests. The bug-capture browser extension (Chrome and Firefox), in version 1. Security: Git-history secrets, web SARIF upload, CVE alerts against shipped versions, EPSS and known-exploited feeds, VEX, posture per version, upgrade and AI fix PRs, leak scans of commits, traces and logs.                                                                                                                                                                                                                                                                       |
| T33    | **Agents and costs** (done 15 Oct 2026; sandboxes are files, not containers; stdio MCP servers not supported)                                                         | Playground (rerun, compare, A/B). Quality: evals, judge scores, annotations, outcomes. Nested traces with latency and links to commits. A sandbox per run and a bot Git identity. Cache and reasoning tokens, the daily FX rate, cost estimates before a run, chargeback, unit costs. Rate limits. MCP servers per agent. Provider-specific limits and health checks (the providers themselves come in T24).                                                                                                                                                                                                                                                                                                                                                                                 |
| T34    | **Clients, incidents, time** (done 15 Oct 2026; idle time only noticed in the browser; DATEV revenue batch only)                                                      | A portal home with health, milestone, release and budget. The embeddable feedback widget. Votes, duplicate merge, NPS. Media in UAT, sign-off per release. Deliverable links and demo recordings. Meeting notes into tasks. The team's client health, revenue, activity and resources. Automatic alerts from probes and deploys, Sentry and Prometheus adapters, status pages per environment, update templates, AI postmortems, runbooks. Time: hour budgets and alerts, DATEV export, reports by person, sprint and task, idle detection and reminders, correction reasons.                                                                                                                                                                                                                |
| T35    | **Cross-cutting** (done 15 Oct 2026; server-written texts stay English; own language picker for members in T37)                                                       | Cmd-K over everything with a shortcut sheet. Homes for developers and testers, with widgets. Integrations hub: Slack and Teams as optional bridges to the in-app channels (never required), Sentry, calendar, email-in, CI. Templates library. Settings inheritance in the screen. A web system-health page with backup, restore and upgrade wizards. Offline beyond tasks. Activity polish (autocomplete, columns, group-by, drag-zoom, heat map). Policies for approvals, budgets and data. **German UI** (a translation layer and German texts). **WCAG 2.2 AA** audit and fixes. Plan contents enforced. The open review items (imports, SAML logout, cluster rate limits). From T25: project leads as admins of their project, budget warnings at 50, 80 and 100 %.                     |

## Phase 2: test the whole product (T36)

Done 15 Oct 2026: report and defects in `docs/reviews/v1-test-report.md` (tasks PCODE-412 to PCODE-436).

- **End-to-end journeys** for every role (owner, lead, developer, tester, designer, client, admin), run
  in a real browser against a real server. These are our own CDP-driven tests, which can run in CI.
- **A click-through of every screen** in light and dark mode, at desktop and phone width, with the
  errors and empty states.
- **Load and scale:** the activity targets (10 000 events per second, facets under 1 s), the command
  center with 100 projects, and live latency.
- **Security:** the authorization matrix over every route again, our own scan, and the external pen test
  if the owner books it.
- **Accessibility:** keyboard-only and screen-reader passes.

The output is one list of defects and UX issues, each as a task.

## Phase 3: fix the UX (T37)

Done 16 Oct 2026: what changed and the measured results in `docs/reviews/v1-test-report.md` (After T37).

- Every defect and UX issue from T36, by severity.
- A consistency pass over the design system: spacing, density, wording, icons.
- Empty states, error messages, loading states.
- First-run onboarding: a new workspace knows what to do next.

## Phase 4: feedback, then version 1.0 (T38–T39)

- **T38:** real use. Our own team runs Orqiva on itself for everything, not only tasks. Design partners
  install it if the owner arranges them. Feedback goes into Orqiva as ideas and requests.
- **T39:** feature updates from the feedback. The release checklist of [launch.md](../launch.md). Then
  **version 1.0**.

## Phase 5: mobile (T40–T41, formerly T23–T24)

- **T40:** approvals and proposal sign-off on the phone, push, iOS Live Activities and Android ongoing
  notifications.
- **T41:** the App Store and Google Play release, MDM for Enterprise.

T21 and T22 are built and stay in the repository, and the checks keep the app building.

## Decisions (owner, 11 Oct 2026)

1. **Mail server: out of scope for now.** The sender is built and tested against a local test server.
   Our own tracker and customers connect a real server later, at the latest before version 1.0 (T39).
   Without one, everything that would send mail uses in-app messages and copyable links.
2. **Text and audio through LLMs.** OCR, document text and audio transcripts come from the AI providers
   (Gemini, OpenAI, Grok and the others that support it), not from a local engine.
3. **Figma: build it now, connect it at the end.** Built and tested against recorded API answers; the
   owner connects a real Figma account in T39.
4. **AI providers:** Google Gemini, OpenAI, Azure OpenAI and Amazon Bedrock, next to Anthropic. xAI Grok
   is added for reading text and audio (T24).
5. **Communication lives inside the app.** Orqiva has its own channels, messages and threads (T23).
   Slack and Teams are optional bridges, never required (T35).
6. **The bug-capture browser extension is in version 1** (T32).

Still open, with a default until the owner decides:

7. **German texts:** I write them in T35, and the owner or a reviewer checks them during real use (T38).
8. **Phone and SMS paging:** left out. On-call pages through push, in-app and email.
9. **Live co-editing in documents:** kept in version 1 (T29).

## How it is tracked

- **In the tracker:** each sprint is loaded into Orqiva when the one before it ends, as now. Only T23 is
  loaded once the owner approves this plan.
- **Progress:** <!-- [PCODE-238 | S15 | v0.1.0] T23.5 Communication exit check, docs and sprint close --> T23 is done (11 Oct 2026); its status and what moved are in `.orqiva/roadmap.md`. <!-- [PCODE-243 | S15 | v0.1.0] T24.4 AI providers exit check, docs and sprint close --> T24 is done (11 Oct 2026); tested against recorded provider answers, real keys are the owner's step.
- **Roadmap:** the sprint table in `.orqiva/roadmap.md` follows this page.
- **Dates:** set by the owner. The sprints are units of work; they are not two-week periods.
