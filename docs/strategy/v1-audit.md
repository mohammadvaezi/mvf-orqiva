<!-- [PCODE-232 | S15 | v0.1.0] Replan: version 1 complete before the mobile app (feature audit, new sprint plan) -->

# Version 1 audit: what the spec asks for and the code does not do yet

On 11 Oct 2026, every row of [command-center-spec.md](command-center-spec.md) was checked against the
code. Checked: the server routes and migrations, the live web screens (`packages/web/src/v2`), the CLI
and the VS Code extension. The mockups in `packages/web/src/preview` do not count as built. The spec's
"Today" column dates from 4 Oct and is out of date; this page replaces it.

**In short.** The data model and most server routes exist for every section. The gaps are of four
kinds:

1. **Email does not exist.** The server sends no mail at all, so there is no password reset, no
   invitation mail, no digests, no notification email and no client updates.
2. **Stored but not acting.** Some settings are kept but nothing acts on them:
   - agent triggers, agent scopes, custom roles, project roles;
   - budget warnings, merge policies, watch notifications.
3. **Built on the server, no screen.** Examples: naming a doc version, test parameters, test
   assignment, the docs search, the item history, member profiles.
4. **Not built at all.** These features exist only as a mockup, or nowhere.

Each section below lists what is missing. "Built" items are left out.

## 3.1 Ideation

- **Intake:** parsing PDF, DOCX, images (OCR) and audio (transcripts); fetching links; email intake;
  adding sources from the IDE and CLI.
- **Interview:** the interviewer should steer by coverage (today it stops after 6 questions). Notify the
  stakeholder a question is assigned to.
- **Extraction:** structured Given/When/Then stories; a personas and stories tab.
- **Prioritisation:** the value/effort matrix chart.
- **Estimate:** T-shirt sizes, a confidence range, a basis from similar past tasks.
- **PRD:** a diff between versions, citations per statement, templates per idea type, export to MD, PDF
  and DOCX.
- **Approval:** named approvers, the states "in review" and "superseded", approval reopens after an edit;
  use the shared approvals building block.
- **Promote:** a separate promote step that creates an epic with stories (not flat tasks).
- **Small details:** an evidence library with request counts, a stale-idea notification, side-by-side
  compare.

## 3.2 Planning

- **Hierarchy:** an initiative level, custom item types and fields.
- **AI sprint plan:** the Planner proposes new stories, deliverables and estimates (today it only picks
  existing tasks).
- **Estimation:** hours and T-shirt sizes, async planning poker, AI estimates from similar tasks, estimate
  vs actual.
- **Capacity:** holidays and absences (from Time), a focus factor, agents and agent budgets as capacity.
- **Charts:** burnup, cumulative flow, control chart, lead-time chart.
- **Flow:** "relates" and "duplicates" links, scheduling warnings on the board, WIP limits.
- **Backlog:**
  - definition of done, a triage inbox for new work;
  - item templates, recurring tasks.
- **Small details:**
  - keyboard keys (C, E, A, L), bulk edit, undo, shared views;
  - automatic moves on branch, PR and merge, SLA timers on bugs;
  - a screen for the item history.

## 3.3 Canvas

- **Views:** timeline, mind map, cross-project portfolio, whiteboard.
- **Gantt:**
  - drag to move and resize, drag to link, shift-drag moves successors, split tasks;
  - constraint types, holidays from Time, an auto/manual switch in the screen;
  - zoom to month and year, colour rules, collapse to an outline level.
- **Resources:** agents as resources; a real heat map.
- **Grid:** fill down, paste from Excel, formulas and roll-ups, indent and outdent.
- **Scenarios:** a per-task diff against the live plan.
- **IDE link:** commits and PRs on the bars; the extension reads the plan.
- **Export:** MS Project XML and CSV (in and out), PDF and PNG, iCal, a read-only share link.

## 3.4 Documents

- **Structure:** drag to reorder, files and images in the page tree.
- **Editor:**
  - a block editor with rendered Mermaid, math, callouts;
  - embeds of designs, Gantt, live task lists and repo code.
- **Versions:** naming a version in the screen, a visual diff.
- **Collaboration:** live co-editing, mentions in doc comments, notifications for watchers.
- **Search:**
  - a screen for the existing full-text route, docs in the global search;
  - semantic search, OCR of files.
- **AI knowledge:** per-task scopes, checking that a cited passage is really on the page.
- **From code:** README import.
- **Small details:**
  - paste a screenshot to upload, image annotation, read analytics;
  - import from Confluence, Notion and Markdown; export to PDF, MD and HTML.

## 3.5 UI kit

- **Tokens:** themes and modes beyond light and dark, iOS and Android export, export as a pull request,
  W3C import.
- **Figma:** two-way sync of variables and styles, frame import, design context for agents.
- **Components:** a live preview; usage counted from the code.
- **Assets:** generated sizes, a download portal.
- **Brand:** guideline pages (colour, type, voice, logo use, do and don't).
- **Review:** overlay compare.
- **Handoff:** spacing, tokens used, states, breakpoints and assets to export.
- **Checks:** focus order, target size, alt text, a lint for non-token values in the code, visual
  regression.
- **Agent rule:** generated UI must use the kit's tokens and components.

## 3.6 Test

- **Repository:** shared steps, parameters in the screen, structured BDD.
- **Plans and runs:** assigning people in the screen (the route exists), a workload view.
- **Evidence:** voice transcription, AI indexing of images, video and voice.
- **Bug capture:** a browser extension (recording, console, network, device data, last actions).
- **Exploratory:** findings as items.
- **Automation:** Cypress and Allure import.
- **Traceability:** defects in the trace graph.
- **Quality:** defect leakage, milestone burndown.
- **Sign-off:** a named approver with a frozen snapshot, and a release gate on tests.
- **AI:** cases from code diffs, failure triage, impacted tests first.
- **Small details:** keyboard result entry, timers per case, a blocked case reopens itself when its defect
  closes, masking of personal data, a test-data vault.

## 3.7 Versions

- **Providers:** GitLab and Azure Repos; branches and tags views; webhook backfill.
- **PR status:** conflicts, stacked PRs, merge queue.
- **Linking:** links by fingerprints; a warning when a PR touches another task's code.
- **Versions:** versions from commits (conventional commits), per-path versions in a monorepo.
- **Releases:** findings tied to the release, not the whole project.
- **Environments:** a config diff between environments.
- **Flags:** a reminder for stale flags.
- **Metrics:** a full PR cycle-time breakdown.
- **Small details:** revert detection, signed commits and provenance, breaking API change detection,
  close the task on merge.

## 3.8 Security

- **Scanners:** secrets in the Git history, IaC, container and DAST scanners, a SARIF upload in the web
  app.
- **CVE alerts:** a new CVE against shipped versions alerts automatically.
- **Priority:** EPSS and known-exploited feeds, reachability analysis.
- **Gates:** merge policies enforced through commit statuses on GitHub and Gitea; a live check whether a
  leaked secret still works.
- **Fixes:** upgrade PRs, AI fix PRs, a finding straight to an agent run.
- **Posture:** a score per version, VEX statements.
- **Small details:** the transitive path to a vulnerable package, a malicious-package feed.

## 3.9 Code map and code review

- **Map:** by feature, sprint and version; a sprint time-lapse.
- **Architecture:** modules, their dependencies, layering violations.
- **API inventory:** owners per endpoint, events and tables.
- **Hotspots:** change coupling, bus-factor risk.
- **Review:**
  - a review queue per PR, with assignment, SLA timers, checklists and risk order;
  - AI review comments anchored to lines, to accept or dismiss;
  - a side-by-side diff with overlays for coverage, findings and tests.
- **Hygiene:** fingerprints of deleted tasks; drift when another task edits a block.
- **Small details:** a "why does this exist" panel, the search syntax, the code map for agents over MCP.

## 4.1 Agents

- **Definition:**
  - MCP servers per agent;
  - enforce the file, branch and network scopes (today they are stored only);
  - more AI providers than Anthropic.
- **Triggers:** schedule, webhook, label or assignment, mention, CI failure. Today they are stored but
  nothing starts a run.
- **Budgets:** warnings at 50, 80 and 100 %, a cost estimate before a run, team budgets that count.
- **Cost:** record cache and reasoning tokens, fetch the daily USD→EUR rate, charge to team, task or
  epic.
- **Traces:** nesting, sub-agents, latency, links to commits and PRs.
- **Quality:** evals, judge scores, human annotation, outcome scores (merged, reverted), a leaderboard.
- **Playground:** rerun a step with another prompt or model, compare, A/B split.
- **Control:** rate limits.
- **Safety:** a sandbox per run, redaction in traces, a bot Git identity.
- **Small details:** cache-hit rate (needs cache tokens), pinned model snapshots.

## 4.2 People

- **Roles:** enforce custom roles and role conditions (today only the base role counts).
- **Structure:** project roles that override workspace roles (`project_members` is never written).
- **Sign-in:** passkeys, a break-glass admin, verified SAML domains.
- **Lifecycle:** invitation by email, bulk CSV invites, hand over projects.
- **Governance:** a permission-change preview, consented impersonation.
- **Profile:** a screen and routes for skills, capacity, time zone, working hours, manager and cost rate.
- **Seats:** a separate count of agent seats.
- **Privacy:** GDPR export and erasure per person.

## 4.3 Tokens and costs

- **Usage:** by user, provider key and task; unit costs per task, PR and sprint.
- **Budgets:** budget and anomaly alerts.
- **Keys:** a key health check, provider limits, more providers.
- **Prices:** chargeback per cost centre, reconciliation with provider invoices, a real daily FX rate.
- **Access tokens:** project API keys, scopes per project.
- **Visibility:** an email when a token is about to expire, a 90-day unused report.
- **Leak defence:** scan commits, traces and logs too.

## 4.4 Activity at scale

- **Finding:** autocomplete in the query language.
- **Views:** columns, density, group-by.
- **Time:** drag to zoom, a heat map, relative or absolute time, time zone.
- **Live:** events per second, a pause control.
- **Noise:** an AI daily digest and "while you were away".
- **Targets:** a benchmark proving 10 000 events per second, and facets under 1 s on 100 million events.

## 4.5 Clients and the portal

- **Clients:** time zone per client.
- **Portal home:** health per project, next milestone, latest release, budget.
- **Requests:** voice notes and screen recording in the browser, merging duplicates, votes.
- **Conversation:** mentions, read receipts, replies by email.
- **Roadmap:** sprints and releases on it.
- **Ideation with the client:** the client takes part in ideation and e-signs the PRD and proposal.
- **Change requests:** approval puts the work into planning; a history of scope changes.
- **UAT:** images, video and voice on results; sign-off per release.
- **Design approval:** pinned comments for clients.
- **Deliverables:** demo recordings, download and staging links, acceptance per deliverable.
- **Documents:** folders; a who-read-what view for the team.
- **Meetings:** notes; action items become requests or tasks.
- **Status:** updates sent to the client's contacts.
- **Satisfaction:** quarterly NPS; comments routed to the account owner.
- **Embeddable widget:** the feedback button for the client's app, and its intake.
- **Team side:** health and revenue per client, a cross-client resource view, a client activity feed.
- **Small details:** magic-link invitations with MFA, digest emails, export of everything a client
  approved, retention per client enforced.

## 4.6 Incidents and on-call

- **Alerts:** raised automatically from status probes and failed deploys; Sentry and Prometheus
  adapters.
- **On-call:** phone or SMS paging, acknowledging from the notification.
- **Cause:** suspect PRs and fingerprinted code.
- **Communication:** a status page per environment, update templates, an internal channel.
- **After:** an AI-written postmortem, runbooks from Documents.

## 4.7 Time

- **Capture:** idle detection, reminders.
- **Timesheets:** a required reason for corrections.
- **Budgets:** hour budgets, budgets per phase, time-budget alerts, estimate vs actual per task.
- **AI time:** AI and people side by side on a task.
- **Reports:** by person, sprint and task; DATEV export.
- **Absences:** absences reduce capacity in Planning and Canvas.

## 4.8 Sync and collaboration

- **Offline:** offline beyond tasks.
- **Conflicts:** live co-editing, a general "someone else changed this" notice.
- **Multi-project:** cross-project dependencies, a cross-project resource view.
- **Multi-developer:** branch awareness in presence.
- **Multi-client:** cross-client resource planning.
- **IDE parity:** code review in the IDE, test evidence in the extension.

## 5 Cross-cutting

- **Email:** a mail sender, password reset, invitation mail, an email channel and digests.
- **Notifications:** Slack and Teams delivery.
- **Search:** Cmd-K over docs, agents, runs, people and settings; a shortcut sheet.
- **Home:** homes for developers and testers; configurable widgets.
- **Traceability:** documents and epics as nodes.
- **AI assistant:** an assistant in every section; its output is a diff to accept.
- **Approvals:** tokens, gates and ideation use the shared approvals block.
- **Integrations hub:** a hub page; Slack and Teams, Sentry, email-in, calendar sync, Figma, CI, an MCP
  registry.
- **Policies:** approval, budget and data-rule policies, each with a dry run.
- **Templates:** a library for projects, PRDs, sprints and agents.
- **Settings inheritance:** setting team and project values in the screen.
- **System health:** a web page for the server, queues, runners and providers; backup, restore and
  upgrade wizards.
- **Languages and accessibility:** a German UI (no translation layer exists yet); a WCAG 2.2 AA audit.

## Also open from the build (review list)

- **Plans and pricing:** enforce plan contents beyond seats; settle the free tier.
- **Imports:** Jira and Linear without assignees and comments.
- **SAML:** single logout, encrypted assertions.
- **Cluster:** rate limits that count across all nodes.
- **Conflicts:** a version check on task edits.
