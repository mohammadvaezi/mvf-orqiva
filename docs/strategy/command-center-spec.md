<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- [PCODE-152 | S15 | v0.1.0] Replan: feature specification and design-first roadmap for the command center -->

# Orqiva command center: feature specification and design-first plan

_Written 4 Oct 2026 after the owner's review of the platform. Status: **features approved by the owner
on 4 Oct 2026 (section 8)**; the UI is approved at gate A1.
Backend and database work waits until the owner approves the UI (the clickable mockup, phase D below)._

## 1. What changes

The owner's verdict: the design is good but far from the goal. Orqiva is **not a project manager**.
It is the command center of a programming department, in which project management is one part. Work
on new backend features stops. The whole platform is designed first, every feature included, as a
clickable mockup. Backend and database work resumes only after the owner approves both the features
and the UI.

Research method: for every section, the most complete products in the world (October 2026) were
compared. The tables below hold their must-have features plus the small details that make the
difference. **Today** says what Orqiva already has: ✅ built, ◐ partly built, ○ new.

<!-- [PCODE-232 | S15 | v0.1.0] Replan: version 1 complete before the mobile app (feature audit, new sprint plan) -->

> The **Today** column dates from 4 Oct 2026 and is out of date. What is really built and what is missing,
> per row, is in [v1-audit.md](v1-audit.md) (11 Oct 2026); the plan to close the gaps is [v1-plan.md](v1-plan.md).

## 2. The map of the platform

Top level (left navigation):

| #   | Section                                 | Asked for by owner | Purpose                                                                                               |
| --- | --------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| 1   | **Home**                                | proposed           | Per-role cockpit: what needs me, my projects' health, agents running, spend today                     |
| 2   | **Inbox**                               | proposed           | Everything that waits for me: approvals, reviews, mentions, agent questions, sign-offs                |
| 3   | **Projects**                            | ✔                  | The nine project phases below, plus an overview per project and a portfolio across projects           |
| 4   | **Agents**                              | ✔                  | Every agent fully controlled; runs, traces, evals, cost per project in EUR                            |
| 5   | **Activity**                            | ✔                  | All events at any volume: inbox vs firehose, facets, histogram, live tail, export                     |
| 6   | **People** (user management)            | ✔                  | Users, teams, roles, SSO/SCIM, access reviews, offboarding, agents as principals                      |
| 7   | **Tokens and costs** (token management) | ✔                  | AI token usage, budgets and forecasts; access tokens, keys and their policies                         |
| 8   | **Releases and environments**           | proposed           | Go/no-go per version, what runs where, deploys, rollbacks, DORA metrics                               |
| 9   | **Insights**                            | proposed           | Engineering metrics across projects: flow, DORA, quality, AI effectiveness                            |
| 10  | **Clients**                             | decided 4 Oct      | Client organisations and their portal: requests, approvals, acceptance tests, budgets, invoices (4.5) |
| 11  | **Incidents and on-call**               | decided 4 Oct      | Alerts, rotations, incidents linked to deploys and code, postmortems, status pages (4.6)              |
| 12  | **Time**                                | decided 4 Oct      | Time tracking from the IDE and web, timesheets, rates, budgets, billing (4.7)                         |
| 13  | **Settings**                            | exists             | Workspace, integrations, policies, billing, appearance, notifications                                 |

Inside a project (tabs, in lifecycle order): **Overview · Ideation · Planning · Canvas · Documents ·
UI kit · Test · Versions · Security · Code map**. Releases, environments and compliance appear inside a
project too, as filtered views of the top-level sections.

Every screen works the same in the web app and in the IDE, and for many projects, developers and
clients at once (4.8).

## 3. Project sections

### 3.1 Ideation

_References: Jira Product Discovery, Productboard, Aha! Ideas, ChatPRD._

| Feature        | Details                                                                                                                                                                                                               | Today               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Intake         | Upload PDF, DOCX, MD, images (OCR), audio and transcripts, links; from web, IDE, CLI, email                                                                                                                           | ◐ text only         |
| AI interview   | One question at a time; coverage score per area (problem, users, scope, non-goals, non-functional, data, integrations, security); hand a question to a named stakeholder; resumable in web or IDE                     | ◐                   |
| Extraction     | Requirements with IDs, open questions (owner, due), assumptions ("validate how"), risks (likelihood × impact), constraints, personas, user stories with Given/When/Then, success metrics, out-of-scope list, glossary | ◐                   |
| Prioritisation | RICE, ICE, MoSCoW, WSJF, value/effort matrix; several scorers, spread shown                                                                                                                                           | ○                   |
| Estimate       | Points or T-shirt with a confidence range and the similar past tasks it is based on                                                                                                                                   | ◐                   |
| PRD            | Versioned, diff between versions, every statement cites the source passage; templates per idea type; export MD/PDF/DOCX                                                                                               | ◐ proposal versions |
| Approval       | Named approvers, states draft → in review → approved → superseded; editing reopens approval; e-signature                                                                                                              | ✅                  |
| Promote        | One click to epic and stories with traceability both ways                                                                                                                                                             | ✅                  |
| Small details  | Evidence library (customer quotes, count of requests), decision log (ADR), rejected-with-reason archive, duplicate merge, stale-idea nudge, side-by-side compare                                                      | ○                   |

### 3.2 Planning

_References: Jira with Advanced Planning, Linear, Azure DevOps Boards, Shortcut._

| Feature        | Details                                                                                                                                                                      | Today |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Hierarchy      | Initiative → epic → story → sub-task, milestones; custom item types and fields                                                                                               | ◐     |
| AI sprint plan | Stories, deliverables and estimates proposed as a draft that people accept or reject line by line; then full create/edit/delete                                              | ◐     |
| Estimation     | Points, hours or sizes; async planning poker; AI suggestion from similar tasks; estimate vs actual                                                                           | ◐     |
| Capacity       | People and agents; holidays, focus factor; agent budgets count as capacity                                                                                                   | ◐     |
| Sprint         | Goal with pass/fail at the end; scope snapshot at start; mid-sprint additions flagged; carry-over with "carried N times"                                                     | ◐     |
| Charts         | Velocity, burndown, burnup, cumulative flow, cycle and lead time, control chart                                                                                              | ◐     |
| Flow           | Dependencies (blocks, relates, duplicates) with scheduling warnings; WIP limits; swimlanes; quick filters                                                                    | ○     |
| Backlog        | Drag ranking, definition of ready and of done, triage inbox, templates, recurring tasks                                                                                      | ◐     |
| Rituals        | Sprint review report and demo list; retro board whose actions become next-sprint tasks                                                                                       | ○     |
| Small details  | Keyboard-first (C, E, A, L, Cmd-K), bulk edit, undo, field history, saved shared views, roll-up progress, auto-move on branch/PR/merge, SLA timers on bugs, scenario sandbox | ◐     |

### 3.3 Canvas (project management views, connected to the IDE)

_References: MS Project, Smartsheet, ClickUp, Monday.com._

| Feature       | Details                                                                                                                                                                  | Today         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Views         | Gantt, timeline, board, table, calendar, workload, list, mind map, whiteboard, portfolio: one dataset                                                                    | ◐ board, list |
| Gantt         | Dependencies FS/SS/FF/SF with lead and lag; auto vs manual scheduling; constraints; working calendars; summary tasks; milestones; % complete                             | ○             |
| Critical path | Highlighted, with float per task                                                                                                                                         | ○             |
| Baselines     | Several saved baselines; variance overlay; slipped dates marked                                                                                                          | ○             |
| Resources     | Workload heat map, over-allocation warnings, levelling with preview; agents as resources                                                                                 | ○             |
| Grid          | Inline edit, fill down, paste from Excel, formulas and roll-ups, WBS codes, indent and outdent                                                                           | ○             |
| Scenarios     | Branch the plan, compare with live, merge                                                                                                                                | ○             |
| IDE link      | Commits and PRs show as actual progress on bars; fingerprints show which code a bar produced                                                                             | ○             |
| Export        | MS Project XML and CSV in/out, PDF/PNG with page fitting, iCal, read-only share link                                                                                     | ○             |
| Small details | Zoom day → year, today line, weekend shading, drag to link, shift-drag moves successors, split tasks, colour rules, collapse to outline level, accessible table fallback | ○             |

### 3.4 Documents (project wiki and AI knowledge)

_References: Confluence, Notion, GitBook, Coda._

| Feature       | Details                                                                                                                                                        | Today        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Structure     | Page tree, drag to reorder, folders for files, images and artifacts                                                                                            | ○            |
| Editor        | Block editor (Markdown compatible): tables, code, Mermaid diagrams, math, callouts, embeds (designs, Gantt, live task lists, code from the repo)               | ○            |
| Templates     | ADR, RFC, runbook, postmortem, meeting notes, API doc                                                                                                          | ○            |
| Versions      | Full history, visual diff, restore, named versions                                                                                                             | ○            |
| Collaboration | Live co-editing, page and inline comments, mentions, watch                                                                                                     | ○            |
| Search        | Full text and semantic, OCR in images and PDFs, filters                                                                                                        | ◐ items only |
| AI knowledge  | Per agent or task: which pages, folders or tags it may use; answers cite the exact passage; every read is logged                                               | ○            |
| Trust         | Owner and "review by" date, stale flag, agent-written pages marked until a person approves                                                                     | ○            |
| From code     | Docs built from the repo (README, OpenAPI), warning when the code drifts                                                                                       | ○            |
| Small details | Backlinks, link-rot check, paste screenshot to upload, image annotation, page lock, read analytics, import from Confluence/Notion/Markdown, export PDF/MD/HTML | ○            |

### 3.5 UI kit (design, branding, mockups)

_References: Figma Dev Mode with Code Connect and MCP, Zeroheight, Supernova, Storybook, Frontify._

| Feature       | Details                                                                                                                        | Today      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Design tokens | W3C token format, themes and modes; export to CSS, Tailwind, TS, iOS, Android as a pull request                                | ○          |
| Figma         | Two-way sync of variables and styles; frames imported with a link back; design context offered to agents                       | ○          |
| Components    | Inventory with status (design only, in code, deprecated), props, live preview, usage count in the code                         | ○          |
| Assets        | Logos, icons, images, fonts with usage rights, licence and expiry; generated sizes; download portal                            | ○          |
| Brand         | Guideline pages: colour, type, voice, logo use, do and don't                                                                   | ○          |
| Review        | Pinned comments on mockups, version compare (side by side, overlay), approval states                                           | ○          |
| Handoff       | Spacing, tokens used, states, breakpoints, assets to export; design linked to tasks; "design changed after work started" alert | ○          |
| Checks        | Contrast, focus order, target size, alt text; code lint for colours and sizes that are not tokens; visual regression           | ◐ own lint |
| Agent rule    | Generated UI must use the kit's tokens and components                                                                          | ○          |

### 3.6 Test (collaboration with testers)

_References: TestRail, Xray, Qase, Testmo; bug capture Jam.dev, Marker.io._

| Feature        | Details                                                                                                                                                                                             | Today        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Repository     | Suites, cases (steps with expected results, BDD, exploratory charters), shared steps, parameters                                                                                                    | ◐            |
| Plans and runs | Configuration matrix (browser, OS, device, locale); result per step; assignment and workload                                                                                                        | ◐            |
| Evidence       | Images, video, documents and voice notes; voice transcribed; all indexed for the AI                                                                                                                 | ○            |
| Bug capture    | Browser extension: screen recording, console, network, device data, last actions; one click files a linked defect                                                                                   | ○            |
| Exploratory    | Timed sessions with notes and findings                                                                                                                                                              | ○            |
| Automation     | JUnit, TAP, Playwright, Cypress, Allure results mapped onto cases                                                                                                                                   | ◐ JUnit, TAP |
| Traceability   | Requirement ↔ case ↔ run ↔ defect ↔ code; coverage per task, sprint, version                                                                                                                        | ◐            |
| Quality        | Flaky detection and quarantine, run comparison, defect leakage, milestone burndown                                                                                                                  | ○            |
| Sign-off       | Named approver, frozen snapshot, acts as the release quality gate                                                                                                                                   | ◐ gate       |
| AI             | Cases from requirements and code diffs; failure triage (product, test, environment, flaky); impacted tests first                                                                                    | ◐            |
| Small details  | Case versions pinned in runs, keyboard result entry, timers, blocked-by-defect reopens itself, masking of personal data in screenshots, test-data vault, upload from phone, read-only client report | ○            |

### 3.7 Versions (Git and release management)

_References: GitHub, GitLab, Graphite, Release Please._

| Feature       | Details                                                                                                                    | Today           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Providers     | GitHub, GitLab, Gitea, Azure Repos: branches, PRs, commits, tags in one view                                               | ◐ GitHub, Gitea |
| PR status     | Checks, reviews, conflicts, size, stale; stacked PRs; merge queue                                                          | ◐               |
| Linking       | Task from branch, message and fingerprints; warn on PRs without a task or touching another task's code                     | ◐               |
| Versions      | Semantic versions from commits; changelog plus customer release notes (AI); monorepo per-path versions                     | ○               |
| Releases      | Release trains, freeze windows, backports ("is the fix in 1.4.x?"), hotfix flow, release contents (tasks, tests, findings) | ○               |
| Environments  | What is deployed where, diff between environments, promotions with approval, rollback                                      | ◐               |
| Flags         | Feature flags tied to tasks, stale-flag reminder                                                                           | ○               |
| Metrics       | DORA: deploy frequency, lead time, change failure rate, recovery time; PR cycle-time breakdown                             | ○               |
| Small details | Revert detection, signed commits and provenance, breaking API change detection, auto-close on merge, webhook backfill      | ○               |

### 3.8 Security center

_References: GitHub Advanced Security, Snyk, Aikido, DefectDojo with Dependency-Track._

| Feature       | Details                                                                                                                                                                                                          | Today                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Scanners      | Code (SAST), dependencies, secrets incl. history, infrastructure code, containers, live app (DAST), licences; import SARIF, CycloneDX, SPDX                                                                      | ◐ own scanner, SARIF |
| SBOM          | Per version, diff between versions; "which shipped versions are affected" by a new CVE                                                                                                                           | ○                    |
| Priority      | CVSS + EPSS + known-exploited list + reachability + exposure → one risk score                                                                                                                                    | ◐ CVSS               |
| Workflow      | New → confirmed → fixing → verified, false positive, accepted risk with approver and expiry; SLAs by severity                                                                                                    | ◐                    |
| Gates         | Policies block merge or release on new criticals, banned licences, live secrets; only new issues gate                                                                                                            | ◐ gate               |
| Fixes         | Upgrade PRs, AI fix PRs, assign a finding to an agent; campaigns across projects                                                                                                                                 | ◐ tasks              |
| Posture       | Score per project and version; trends, time to fix, SLA breaches; VEX statements                                                                                                                                 | ○                    |
| Small details | Live check whether a leaked key still works, transitive path to a vulnerable package, finding → fingerprint → task that introduced it, expiring ignore rules, malicious-package feed, compliance evidence export | ◐                    |

### 3.9 Code map and code review

_References: Sourcegraph, CodeScene, Backstage, CodeRabbit, Graphite._

| Feature         | Details                                                                                                                                           | Today                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Fingerprint map | Treemap by feature, sprint or version; sprint time-lapse; "everything PCODE-12 touched"                                                           | ◐ index, trace graph |
| Architecture    | Modules and their dependencies; layering violations                                                                                               | ○                    |
| API inventory   | Endpoints, events, tables: owner, creating task, tests that hit it, auth status                                                                   | ◐ OpenAPI            |
| Ownership       | Owners, real authorship, agent vs human share per area                                                                                            | ○                    |
| Hotspots        | Churn × complexity, code health, change coupling, bus-factor risk                                                                                 | ○                    |
| Review queue    | Assignment, SLA timers, checklists per change type (API, migration, security), risk-ordered                                                       | ◐ reviews            |
| AI review       | Comments anchored to lines; accept or dismiss                                                                                                     | ◐ Reviewer agent     |
| Diff            | Side by side, moved-code detection, overlays for coverage, findings and test results                                                              | ○                    |
| Hygiene         | Code without fingerprint, fingerprints of closed or missing tasks, drift when another task edits a block                                          | ◐ scan               |
| Small details   | "Why does this exist" panel per block (task, decisions); search syntax `sprint:S15 feature:auth type:endpoint`; map offered to agents through MCP | ○                    |

## 4. Platform sections

### 4.1 Agents

_References: Langfuse, LangSmith, Portkey, GitHub Copilot coding agent, Devin, Factory._

| Feature       | Details                                                                                                                                                                                                     | Today    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Definition    | Versioned: model and fallback chain, temperature, max tokens, prompt version, tools and MCP servers per method, file and path scopes, repos and branches, network allow-list                                | ◐        |
| Autonomy      | Suggest → act with approval → act in scope → autonomous; approval rules per action class (write, shell, push, merge, deploy, spend, external call)                                                          | ◐        |
| Budgets       | Per run, day, project, agent; soft warn and hard stop; alerts at 50/80/100 %; loop and retry guard; cost estimate before a run                                                                              | ◐        |
| Cost          | Input, output, cache write, cache read, reasoning tokens, tool fees; versioned price table per model; USD with daily rate to EUR; charge to project, team, task, epic; waste (failed runs) shown separately | ◐        |
| Traces        | Nested timeline of model calls, tool calls, sub-agents with latency, tokens, cost; linked to task, commit, PR                                                                                               | ◐ steps  |
| Quality       | Evals, judge scores, human annotation, outcome scores (tests passed, merged, reverted); leaderboard: cost per merged PR, revert rate                                                                        | ○        |
| Playground    | Rerun a step with another prompt or model; compare; A/B by traffic split                                                                                                                                    | ○        |
| Control       | Kill switch per run, per agent and global ("pause all"); concurrency limit and queue; rate limits                                                                                                           | ◐ cancel |
| Triggers      | Schedule, webhook, label or assignment, PR comment, CI failure, mention                                                                                                                                     | ○        |
| Safety        | Sandbox per run, secrets injected never shown, redaction in traces, bot identity for audit and git authorship, accountable human owner                                                                      | ◐        |
| Small details | Prompt diff and rollback, pinned model snapshots with deprecation dates, one-sentence run summary, cache-hit rate                                                                                           | ○        |

### 4.2 People (user management)

_References: Okta, WorkOS, GitHub Enterprise, Google Workspace admin._

| Feature    | Details                                                                                                                 | Today        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | ------------ |
| Roles      | Owner, admin, member, guest, billing, auditor; custom roles from permissions; conditions (project tag, environment, IP) | ◐ 4 roles    |
| Structure  | Teams and nested groups; project roles override workspace roles; guests and clients see only shared projects            | ◐ guests     |
| Sign-in    | OIDC and SAML, verified domains, provisioning (SCIM), MFA policy per role (TOTP, passkeys), break-glass admin           | ◐ OIDC, TOTP |
| Sessions   | Devices list, revoke, idle and absolute timeouts, sign out everywhere                                                   | ○            |
| Lifecycle  | Invitations with expiry and bulk CSV; offboarding wizard that hands over tasks, agents, tokens, projects, then suspends | ◐ invites    |
| Governance | Access reviews, stale users, "why can X see Y" checker, permission-change preview, audit log, consented impersonation   | ○            |
| Profile    | Skills, capacity, time zone, working hours, holidays, manager, cost rate                                                | ○            |
| Seats      | Used vs bought, last active, agent seats separate                                                                       | ◐ licence    |
| Privacy    | GDPR export and erasure per person                                                                                      | ○            |

### 4.3 Tokens and costs (token management)

_References: OpenAI and Anthropic usage consoles, Vantage, GitHub fine-grained tokens, HashiCorp Vault, GitGuardian._

| Feature       | Details                                                                                                                                                     | Today       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| AI usage      | By user, agent, project, model, provider, key, task; token types stacked; unit costs per task, PR, sprint                                                   | ◐           |
| Budgets       | At every level, month-end forecast, burn rate, anomaly alerts (a looping agent)                                                                             | ◐           |
| Provider keys | Bring your own key per workspace or project, key health, provider limits                                                                                    | ◐ workspace |
| Prices        | Editable versioned price tables, monthly invoice and chargeback per cost centre, reconcile with provider invoices; currency and rate source on every figure | ◐           |
| Access tokens | Personal tokens, service accounts, project API keys, runner tokens; fine scopes per project                                                                 | ◐           |
| Policy        | Mandatory expiry, maximum lifetime, rotation with overlap, approval for broad scopes, IP allow-lists                                                        | ○           |
| Visibility    | Last used (time, IP, client), usage count, expiring-soon mail, unused-for-90-days report, owner shown so offboarding catches it                             | ◐           |
| Leak defence  | Prefixed tokens (`pe_pat_`), secret scanning in commits, task text, traces, logs; auto-revoke                                                               | ◐ prefixes  |

### 4.4 Activity at scale

_References: Datadog Log Explorer, Linear Inbox, GitHub audit log, Sentry._

| Feature   | Details                                                                                                                                          | Today         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Two modes | Inbox (what needs me: done, snooze, mark all read) and firehose (everything)                                                                     | ◐ feed        |
| Finding   | Faceted sidebar with live counts; full text; query language `actor:agent project:PCODE -verb:progressed` with autocomplete                       | ○             |
| Views     | Saved and shared views, columns, density; group by actor, object, project, time                                                                  | ○             |
| Time      | Histogram you drag to zoom; heat map; relative or absolute time; time zone                                                                       | ○             |
| Live      | Live tail with pause on scroll, "N new events" pill, rate                                                                                        | ◐ live        |
| History   | One object's full story across tasks, commits, runs, deploys; before/after values; permalinks                                                    | ◐             |
| Noise     | Collapse repeats ("agent edited 42 files"); AI digest daily or "while you were away"; explain a spike                                            | ○             |
| Scale     | Virtual lists, cursor paging; retention tiers with archive; hash-chained audit stream; export CSV/JSON for any query; stream to SIEM or webhooks | ◐ 24 h replay |
| Targets   | 10 000 events per second in, facet queries under 1 s on 100 million events, scrolling under 100 ms                                               | ○             |

### 4.5 Clients and the client portal

_References: Productive.io and Teamwork client access, Jira Service Management portal, Linear Asks,
Canny, Basecamp clients, Moxo. The owner asked for this section to be really comprehensive and
interactive._

The section has two sides. **Clients** is the team's view inside Orqiva. The **client portal** is what client users sign in to. Clients never see internal data: comments marked internal, agent traces, other clients, or costs the team keeps private. Row-level security enforces this, and a "view as client" preview shows the team exactly what a client sees.

| Feature                   | Details                                                                                                                                                                                               | Today      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Client organisations      | Many clients, each with several projects, contacts and roles: sponsor, approver, product owner, tester, requester, viewer. Per-client branding (logo, colours, own domain), language and time zone    | ◐ guests   |
| Portal home               | Live health per project (on track, at risk, late), next milestone, what waits for them (approvals, tests, questions), latest release, budget used                                                     | ○          |
| Requests                  | Forms per request type (bug, change, new feature, question) with attachments, screenshots, voice notes and screen recording. Status and SLA timer. Duplicates merged. Votes from several client users | ○          |
| Conversation              | Threads per request and per shared task. Internal notes sit in the same thread but are never shown to the client. Mentions, read receipts, and email replies that land in the thread                  | ◐ comments |
| Live roadmap              | Milestones, sprints and releases, as far as the client may see them. Gantt and timeline, read-only. What moved and why                                                                                | ○          |
| Ideation with the client  | Clients upload documents and answer the AI interview themselves. They sign the PRD and proposal with an e-signature                                                                                   | ◐          |
| Change requests           | Estimate, cost and schedule impact shown before approval. Approved changes enter planning. History of every scope change                                                                              | ○          |
| Acceptance tests (UAT)    | Tests assigned to client testers. Results with images, video and voice. One-click bug from a failed step. Sign-off per release                                                                        | ○          |
| Design approval           | Mockups from the UI kit with pinned comments. Approve or ask for changes, per version                                                                                                                 | ○          |
| Deliverables and releases | Release notes written for clients, demo recordings, download or staging links, acceptance per deliverable                                                                                             | ○          |
| Documents                 | Shared folders and pages, contracts, meeting notes; who read what                                                                                                                                     | ○          |
| Budget and billing        | Budget burn (hours, AI cost, fixed price), forecast, invoices and payment status, quotes and their acceptance                                                                                         | ◐ billing  |
| Meetings                  | Book a review or demo. Agenda and notes linked to tasks. Action items become requests or tasks                                                                                                        | ○          |
| Status and incidents      | Status page per client environment; incident updates sent to the client                                                                                                                               | ○          |
| Satisfaction              | Rating after each release or closed request (CSAT), quarterly NPS, comments to the account owner                                                                                                      | ○          |
| Embeddable widget         | Feedback button in the client's own app: captures a screenshot, the console and user data, and lands as a request                                                                                     | ○          |
| Team side                 | Client list with health, revenue, open requests and SLA breaches. Account owner per client. Cross-client resource view. Client activity feed                                                          | ○          |
| Small details             | Portal invitation by magic link with MFA. Digest emails instead of a flood. Mobile-first portal. Export of everything a client ever approved (audit). Per-client data retention. "View as client"     | ○          |

### 4.6 Incidents and on-call

_References: PagerDuty, incident.io, Opsgenie, FireHydrant._

| Feature       | Details                                                                                                                                       | Today        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Alerts        | From health checks, deploy failures, Sentry, Prometheus or any webhook. Grouped, deduplicated, with a severity                                | ◐ health URL |
| On-call       | Rotations, overrides, holidays, escalation policies. Push and phone notification. Acknowledge from the phone                                  | ◐ push       |
| Incident      | Commander and roles, a live timeline built from events, status updates, linked tasks                                                          | ○            |
| Cause         | Suspect changes: recent deploys, PRs and fingerprinted code that touched the failing area. Rollback button                                    | ◐ deploys    |
| Communication | Internal channel, status page per environment and per client, templates                                                                       | ○            |
| After         | Postmortem template filled by AI from the timeline. Action items become tasks. MTTA and MTTR, SLOs and error budgets, runbooks from Documents | ○            |

### 4.7 Time

_References: Harvest, Toggl Track, Clockify, Tempo._

| Feature          | Details                                                                                                                               | Today        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Capture          | Timer starts and stops with `orq start` and `orq done` in the IDE. Timer in web and mobile, manual entries, idle detection, reminders | ◐ task times |
| Timesheets       | Weekly per person; submit and approve; past periods locked; corrections need a reason                                                 | ○            |
| Rates            | Billable or not. Rates per person, role, client and project. Internal cost rates                                                      | ○            |
| Budgets          | Hours or money per project, phase or client. Alerts. Estimate vs actual per task                                                      | ○            |
| AI time and cost | Agent run time and token cost next to human hours on the same task                                                                    | ◐            |
| Reports          | By client, project, person, sprint or task. Export to CSV and DATEV. Feeds client invoices                                            | ○            |
| Absences         | Holidays and leave feed capacity in Planning and Canvas                                                                               | ○            |

### 4.8 Sync and collaboration (web and IDE; many projects, developers and clients)

_Decided by the owner on 4 Oct 2026: everything stays in sync between the web app and the IDE and is
ready for multi-project, multi-developer and multi-client work._

| Area            | Details                                                                                                                                                                                                     | Today       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| One live stream | Web app, VS Code extension, CLI, MCP server and mobile read the same event stream. Every change appears everywhere in under a second                                                                        | ✅          |
| Full IDE parity | From the IDE: ideation interview, tasks, comments, approvals, test evidence, review, code-map overlays in the editor, agents, time. Every IDE action is visible on the web, and every web action in the IDE | ◐           |
| Offline         | Actions queued while offline and sent in order. Conflicts are shown, never lost                                                                                                                             | ◐ CLI queue |
| Conflicts       | Field-level changes with history for records. Live co-editing for documents. "Someone else changed this" notices                                                                                            | ◐           |
| Presence        | Who is on which page, task, document and code block (through fingerprints), across web and IDE                                                                                                              | ◐           |
| Multi-project   | Project switcher, portfolio view, cross-project dependencies and resources, per-project permissions                                                                                                         | ◐           |
| Multi-developer | Assignments, reviews, "who works on this block now", branch awareness, team capacity                                                                                                                        | ◐           |
| Multi-client    | Clients separated by row-level security, each with its own branding and billing. Cross-client resource planning for the team                                                                                | ◐           |

## 5. Cross-cutting features (the owner did not list them; every section needs them)

- **Command palette and global search** (Cmd-K) across tasks, docs, agents, runs, people, settings; shortcut sheet.
- **Notification center** with rules per channel (in app, email, push, Slack or Teams), quiet hours, digests. ◐ push
- **Home per role** (developer, lead, admin, tester, client) with widgets.
- **Traceability everywhere**: idea → PRD → epic → task → commit → test → finding → deploy → doc. ◐
- **AI assistant in every section**, scoped to what it may read, citing sources; its output is always a diff to accept.
- **Approvals as one building block** used by ideation, gates, tests, releases, risk acceptance, tokens.
- **Integrations hub**: Git hosts, CI, Slack or Teams, email-in, calendar, Sentry, Figma, MCP registry.
- **API, webhooks, CLI and MCP server** for IDEs and agents. ◐
- **Policies** (approvals, budgets, data rules) with a dry run.
- **Templates library** for projects, PRDs, sprints, docs, agents.
- **Settings inheritance**: workspace → team → project → person, with "overridden here" markers.
- **System health page**: server, queues, runners, providers; backup, restore and upgrade wizard. ◐ CLI
- **Mobile** (PWA now, apps later) for inbox, approvals and the kill switch. ◐
- **Languages** English and German; WCAG 2.2 AA; dark mode. ◐

## 6. Design direction for the mockups

- One shell: a slim left rail (sections), a project switcher, a top bar with Cmd-K, inbox count, agent
  activity and spend today. Dense like Linear, structured like Google's Material 3 data screens.
- Every list: virtual scrolling, filters as chips, saved views, bulk select, keyboard navigation.
- Every object page: header (state, owner, links), main tabs, a right panel with history, AI and links.
- Light and dark from day one; tokens only; the reference UI kit chosen earlier stays the base.
- Charts drawn by our own SVG components, as today.

## 7. The new plan

**Phase D: design (no backend work).** The mockup is built inside the real web app as a **preview
mode** with sample data, reached at `/preview`. The approved screens then become the product, rather
than being thrown away. Each step ends with a review by the owner.

| Step | Content                                                                                    | Review                            |
| ---- | ------------------------------------------------------------------------------------------ | --------------------------------- |
| D1   | Design system v2, shell, navigation, Cmd-K, Home, Inbox, project overview                  | owner reviews look and navigation |
| D2   | Ideation, Planning, Canvas (Gantt, grid, workload, board, calendar, mind map)              | owner reviews                     |
| D3   | Documents, UI kit, Test                                                                    | owner reviews                     |
| D4   | Versions and releases, Security center, Code map and review                                | owner reviews                     |
| D5   | Agents, People, Tokens and costs, Activity at scale, Insights, Settings                    | owner reviews                     |
| D6   | Clients and the client portal, Incidents and on-call, Time; web and IDE views side by side | owner reviews                     |
| D7   | Full click-through, fixes, **approval gate A1: features and UI approved**                  | owner signs                       |

**Phase B: build (after A1).** The data model is redesigned for the approved screens first (one
migration plan), then sections are built in this order: shell and cross-cutting → Projects (Planning
and Canvas first, then the rest) → Agents and costs → People and tokens → Activity at scale → Insights.
The old roadmap T16–T24 (docs, release trains, live command center, enterprise, GA, mobile) is kept
and re-scheduled after phase B. Dates are set at the A1 review.

## 8. Decisions (owner, 4 Oct 2026)

1. The map is approved, including Home, Inbox, Releases and environments, Insights.
2. Incidents and on-call, the client portal and time tracking are in. The client section is to be
   really comprehensive and interactive (4.5).
3. Token management covers both AI token costs and access tokens (4.3).
4. The mockup is built inside the real web app at `/preview` with sample data.
5. Currency: euro.
6. Everything stays in sync between the web app and the IDE, ready for multi-project, multi-developer and
   multi-client collaboration (4.8).

<!-- [PCODE-160 | S15 | v0.1.0] Gate A1 answers: agent-vs-people comparisons for admins only, sign-off recorded -->

At gate A1 (4 Oct 2026, [gate-a1.md](gate-a1.md)):

7. Design system v2 is final.
8. Money in German format everywhere (1.286 €).
9. Comparisons of agents with people are for admins only.
10. Every client gets its own portal domain from the start.
11. Phase B runs in the order B0–B8.
