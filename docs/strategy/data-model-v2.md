<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- [PCODE-161 | S15 | v0.1.0] B0 data model v2: model for all approved screens and the foundation migrations -->

# Data model v2

_Step B0 of phase B ([gate-a1.md](gate-a1.md)), 4 Oct 2026. One data model behind every screen approved
at gate A1. Marks: ✅ exists, ◐ exists and is extended, ○ new. The foundation (migrations 0032–0036)
is built in B0; every other new table is added by the step that makes its screens live._

## 1. Conventions

- **One database, many workspaces.** Every tenant table has `workspace_id`, row-level security is
  enabled and forced, and the server reaches tenant data only through `inWorkspace()`, which pins the
  workspace for the transaction. A schema test fails the build if a table with `workspace_id` lacks it.
- **Clients are isolated by the database.** A client contact's transaction also carries
  `app.client_id` (`inWorkspace(pool, ws, fn, { clientId })`). Restrictive policies named
  `client_scope` then narrow every client-reachable table to that client's projects and to rows marked
  for clients (`comments.visibility = 'client'`, `files.client_visible`, client or project budgets).
  Team-only tables (roles, teams, rates, settings …) return nothing. Every new table that a client may
  reach gets its `client_scope` policy in the same migration; the rest get `USING (current_client_id()
IS NULL)`.
- **Money** is `bigint` euro cents. Provider prices are kept in USD micros per million tokens
  (`model_prices`) with the day's rate (`fx_rates`); a stored euro figure keeps the rate's date, so every
  number can say which rate made it. Display is German format everywhere (owner, gate A1).
- **Files** are stored once by SHA-256 in our own blob store (`data/blobs/ab/cd/<sha256>`); the `files`
  row carries name, type, OCR text or transcript (for search and agents) and whether a client may see it.
- **Approvals** of any kind are one table (`approvals`) bound to the hash of the approved version; an
  edit afterwards reopens the approval.
- **History** stays in the activity outbox: every change writes an event in the same transaction.
  New object types are added to `@orqiva/shared` with each step.
- **Text and numbers are checked by the database** (length limits, enumerations as `CHECK … IN`,
  non-negative money). IDs are UUIDs; times are `timestamptz`.

## 2. Screens and their tables

### Shell, Home, Inbox, Settings (B1)

| Table                                          | Mark   | For                                                                                     |
| ---------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| workspaces, users, sessions, user_totp, push_* | ✅     | sign-in, devices, notifications                                                         |
| workspace_members                              | ◐ 0033 | roles owner, admin, member, tester, designer, billing, auditor, guest; `custom_role_id` |
| roles                                          | ○ 0033 | custom roles: base role, permissions, conditions                                        |
| teams, team_members                            | ○ 0033 | teams, nested, leads                                                                    |
| project_members                                | ○ 0033 | role per project, overrides the workspace role                                          |
| member_profiles                                | ○ 0033 | skills, capacity, focus, time zone, working and quiet hours, manager, cost rate         |
| inbox_items                                    | ○ 0034 | one row per person and waiting thing; done, snooze, read across devices                 |
| notification_rules                             | ○ 0034 | channels per event kind (in app, e-mail, push, Slack, Teams, IDE)                       |
| settings                                       | ○ 0034 | values per workspace, team, project, person; the most specific wins                     |
| saved_filters                                  | ◐ 0034 | `surface` (any list) and `shared`                                                       |

### Clients and the portal (foundation B0, features B7)

| Table                            | Mark   | For                                                                                                   |
| -------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| clients                          | ○ 0032 | name, owner, branding, own portal domain, language, what is shared, retention                         |
| client_contacts                  | ○ 0032 | portal roles: sponsor, approver, product owner, tester, requester, viewer                             |
| projects                         | ◐ 0032 | `client_id`                                                                                           |
| comments                         | ◐ 0032 | `visibility` team or client: internal notes stay inside                                               |
| client_requests                  | ○ B7   | bug, change, feature, question; state; response due; linked task; change impact (points, price, days) |
| client_invoices                  | ○ B7   | number, period, amount, state, PDF file                                                               |
| meetings                         | ○ B7   | slot, attendees, agenda and notes page, action items                                                  |
| csat_ratings                     | ○ B7   | rating after a release or a closed request                                                            |
| status_components, status_checks | ○ B7   | the client's status page and 30-day uptime                                                            |
| portal_domains (on clients)      | ◐ B7   | verification and TLS certificate per domain                                                           |

### Ideation (B3)

| Table                                                            | Mark | For                                                        |
| ---------------------------------------------------------------- | ---- | ---------------------------------------------------------- |
| ideas, idea_messages, proposals, proposal_signatures, idea_items | ✅   | ideas, interview, PRD versions, signing, promotion         |
| idea_sources                                                     | ○ B3 | files and links of an idea, statements taken from each     |
| requirements                                                     | ○ B3 | R-ids, type, text, citation (file and passage), status     |
| idea_questions, idea_risks, idea_assumptions                     | ○ B3 | owners and due dates; likelihood × impact; how to validate |
| decisions, glossary_terms                                        | ○ B3 | project decision log; terms the agents use                 |
| idea_scores                                                      | ○ B3 | RICE, ICE, WSJF, MoSCoW per scorer                         |

### Planning and Canvas (B2)

| Table                                                                                | Mark             | For                                                                                                                         |
| ------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| items, project_states, labels, sprints, sprint_capacity, item_criteria, item_history | ✅               | tasks, board, sprints, capacity, criteria, history                                                                          |
| items                                                                                | ◐ B2             | type (epic, story, bug, task, spike), priority, start and due dates, duration, % done, WBS order, ready flag, carried count |
| sprints                                                                              | ◐ B2             | goal, goal met, scope snapshot at start                                                                                     |
| item_dependencies                                                                    | ○ B2             | FS, SS, FF, SF with lag                                                                                                     |
| baselines, baseline_items                                                            | ○ B2             | saved plans for variance                                                                                                    |
| plan_scenarios                                                                       | ○ B2             | branched plans                                                                                                              |
| plan_drafts                                                                          | ○ B2             | the Planner's proposal, accepted line by line                                                                               |
| retro_notes                                                                          | ○ B2             | went well, to improve, actions (linked tasks)                                                                               |
| absences                                                                             | ○ B7, read in B2 | holidays and leave feeding capacity                                                                                         |

### Documents and UI kit (B3)

| Table                                 | Mark   | For                                                                       |
| ------------------------------------- | ------ | ------------------------------------------------------------------------- |
| files, approvals                      | ○ 0036 | uploads and sign-offs                                                     |
| doc_pages, doc_versions               | ○ B3   | tree, status, owner, review date, generated-from-code, blocks per version |
| doc_comments, doc_links               | ○ B3   | anchored comments; backlinks and link checks                              |
| knowledge_scopes, knowledge_reads     | ○ B3   | what each agent may read; what it read and cited                          |
| design_tokens, ui_components          | ○ B3   | tokens light and dark; components with status, code path, usage           |
| mockups, mockup_versions, mockup_pins | ○ B3   | review with pinned comments; approval through `approvals`                 |
| assets                                | ○ B3   | file, kind, rights, licence, expiry                                       |

### Test, Versions, Security, Code map (B4)

| Table                                            | Mark | For                                                                                     |
| ------------------------------------------------ | ---- | --------------------------------------------------------------------------------------- |
| test_cases, test_runs, test_results              | ◐ B4 | suites, case type and steps, case version, configuration matrix, step results           |
| test_evidence                                    | ○ B4 | file, kind (screenshot, recording, console, network, voice), step                       |
| git_connections, item_git_links                  | ✅   | repositories and links                                                                  |
| pull_requests                                    | ○ B4 | number, branch, checks, reviews, size, risk, stale                                      |
| releases, release_items                          | ○ B4 | version, train, freeze, state, notes for team and client, contents                      |
| environments, deploy_runs, deploy_steps, runners | ✅   | what runs where, deploys                                                                |
| feature_flags                                    | ○ B4 | key, task, where on, age                                                                |
| security_scans, findings                         | ◐ B4 | EPSS, KEV, reachable, exposed, risk score, accepted until, introducing task             |
| sboms                                            | ○ B4 | per release: components, licences, diff                                                 |
| policies                                         | ○ B4 | gates as rules (merge, release, secret) with dry run; shared with Settings              |
| campaigns                                        | ○ B4 | a finding class removed across projects                                                 |
| item_fingerprints                                | ✅   | code to task                                                                            |
| code_files, api_endpoints                        | ○ B4 | size, churn, complexity, health, agent share; endpoints with task, owner, tests, access |

### Agents, Tokens and costs, People governance (B5)

| Table                                                    | Mark   | For                                                                                                                    |
| -------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| agents, agent_runs, agent_steps, agent_provider_settings | ◐ B5   | fallback model, autonomy, accountable owner, scopes, triggers, identity; cost per token kind; provider key per project |
| agent_prompt_versions                                    | ○ B5   | versioned instructions with labels and rollback                                                                        |
| agent_action_rules                                       | ○ B5   | never, ask, allowed per action class                                                                                   |
| agent_evals                                              | ○ B5   | datasets, scores, gate on change                                                                                       |
| model_prices, fx_rates, budgets, rates                   | ○ 0035 | prices in USD micros, daily rate, budgets at every level, hourly rates                                                 |
| api_tokens                                               | ◐ B5   | kind (personal, service, runner), expiry policy, IP allow-list, last use, approval of broad scopes                     |
| token_leaks                                              | ○ B5   | where found, revoked when                                                                                              |
| access_reviews, access_review_items                      | ○ B5   | quarterly certification                                                                                                |

### Activity and Insights (B6)

| Table                                     | Mark | For                                                                                                   |
| ----------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| activity_events, workspace_event_counters | ◐ B6 | search vector, partitions by month, archive tier                                                      |
| activity_exports                          | ○ B6 | asynchronous exports of any query                                                                     |
| webhooks, webhook_deliveries              | ○ B6 | signed delivery with retries; SIEM streaming                                                          |
| insight_snapshots                         | ○ B6 | weekly figures per project and team; agent-vs-people figures readable by admins only (owner, gate A1) |

### Incidents and Time (B7)

| Table                                                | Mark | For                                                                                        |
| ---------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| alerts                                               | ○ B7 | source, grouping key, severity, environment                                                |
| incidents, incident_events, incident_updates         | ○ B7 | severity, roles, timeline, status updates for clients                                      |
| oncall_schedules, oncall_shifts, escalation_policies | ○ B7 | rotations and escalation                                                                   |
| slos                                                 | ○ B7 | objectives and error budgets                                                               |
| time_entries                                         | ○ B7 | person, task, project, client, minutes, billable, source (IDE, web, manual), rate snapshot |
| timesheets                                           | ○ B7 | week, state submitted, approved, locked                                                    |
| absences                                             | ○ B7 | holidays and leave                                                                         |

### Web and IDE sync (B8)

No new tables: VS Code, the CLI and the phone use the same API and event stream as the web app.
`work_sessions` and `item_fingerprints` (✅) carry what is IDE-specific.

## 3. Migrations

| Migration            | Step | Content                                                                                                                                    |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0032_clients         | B0   | clients, client contacts, `projects.client_id`, `comments.visibility`, `current_client_id()`, client policies on projects, items, comments |
| 0033_people          | B0   | wider roles, custom roles, teams, project roles, member profiles                                                                           |
| 0034_inbox_settings  | B0   | inbox, notification rules, inherited settings, saved views for any list                                                                    |
| 0035_money           | B0   | exchange rates, model prices, budgets, rates                                                                                               |
| 0036_files_approvals | B0   | files, approvals                                                                                                                           |
| 0037–0039            | B1   | inbox fill from events, search index, notification fan-out                                                                                 |
| 0040–0043            | B2   | item fields, dependencies, baselines, scenarios, drafts, retro                                                                             |
| 0044–0048            | B3   | ideation tables, documents, knowledge, UI kit                                                                                              |
| 0049–0054            | B4   | test extensions, pull requests, releases, flags, security, code map                                                                        |
| 0055–0058            | B5   | agent extensions, prompts, rules, evals, token extensions, reviews                                                                         |
| 0059–0061            | B6   | activity partitions and archive, exports, webhooks, insight snapshots                                                                      |
| 0062–0067            | B7   | client portal tables, incidents, on-call, time, absences                                                                                   |

Numbers after B0 are reserved per step and may shift by a few; the order stays.

## 4. Open points decided later

- The blob store directory and its backup are added to `orq install` and `orq backup` in B3.
- Activity partitions by month need PostgreSQL 15 or later; the install already uses 17.
- `project_guests` stays for single guests; client contacts reach projects through `clients`.
