<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- [PCODE-159 | S15 | v0.1.0] D7 preview: full click-through, fixes and the gate A1 package -->

# Gate A1: features and UI approved

_Prepared 4 Oct 2026 at the end of phase D. Gate A1 is passed when the owner signs at the end of this page.
Until then no backend or database work starts for the new screens (see the design-first decision in
[command-center-spec.md](command-center-spec.md))._

## 1. What phase D produced

The whole command center as a clickable preview inside the real web app, at **`/preview`**, with sample
data (3 clients, 5 projects, 8 people, 6 agents). No sign-in, no server calls. A bar at the top switches
the role (developer, lead, admin, tester, client) and light or dark. A link can name the view:
`/preview/projects/NWL/canvas?as=lead&theme=dark`.

| Step | Commit    | What can be clicked                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1   | a0a15f7   | Design system v2, shell and sidebar with the full map, top bar (search, running agents, spend today, VS Code sync, presence, inbox), command palette (Ctrl K), Home per role, Inbox with actions per kind and keys, project overview with lifecycle and figures                                                                                                                      |
| D2   | 0e8ae35   | Ideation (interview, sources, requirements with citations, questions, risks, stories, RICE, PRD with diff and e-signature, decisions, glossary), Planning (board with WIP limits, backlog, AI draft, capacity, reports, retro, task panel), Canvas (Gantt with critical path, baselines and commits, grid, workload with levelling, calendar, mind map, portfolio)                   |
| D3   | 2feec68   | Documents (wiki, editor, comments, versions, templates, AI knowledge per agent, health), UI kit (brand, tokens to code, components, mockup review with pins and client approval, assets, checks), Test (run matrix, step results, evidence with recording, console, network and voice, AI triage, repository, coverage, flaky, AI cases)                                             |
| D4   | 5132395   | Versions (pull requests, go/no-go, release notes for team and client, backports, environments, flags, DORA), Security (risk-ordered findings with their signals, fix with an agent, accepted risk with expiry, SBOM, policies, campaigns), Code map (treemap from fingerprints with time-lapse, API inventory, hotspots, review queue with AI comments, hygiene), Releases page      |
| D5   | b3745d6   | Agents (fleet, kill switch, full settings incl. action rules, traces, costs per project in euro, leaderboard), People (members, roles, sign-in, why-can-X-see-Y, offboarding), Tokens and costs (spend, forecast, budgets, prices, keys, access tokens and policies, leaks), Activity (20 000 events, histogram, facets, query language, live tail, event story), Insights, Settings |
| D6   | 799403a   | Clients (team side with internal notes and View as client) and the client portal (requests, roadmap, acceptance tests, approvals with signature, releases with rating, documents, budget and invoices, meetings, status), Incidents and on-call, Time, the web app next to VS Code                                                                                                   |
| D7   | this step | Click-through as a test, client isolation, phone layout with a menu, this package                                                                                                                                                                                                                                                                                                    |

## 2. What the click-through checked

- **Every page for every role renders**: 73 addresses × 5 roles = 365 pages, as an automated test that
  runs with every build. Every link stays inside the preview.
- **A client stays in the portal** on every address: no other client, no internal notes, no agent
  controls or costs, no team sections; team pages show "Not part of your portal"; their own project
  shows the overview only.
- **Visual pass** in light and dark at 1600 px and at phone width. Fixed in D7: the phone layout (menu
  button with the sidebar over the page, wrapping banner, wide content scrolls inside its card),
  number formats in Time, a clash of class names in Incidents.
- 134 web tests, type check, lint and formatting pass.

## 3. What the preview does not show

- **Data is invented and not saved.** Buttons change the screen (approve, sign, move, accept), not a
  database. Phase B makes each screen live.
- **Some interactions are drawn, not built**: dragging bars in the Gantt, live co-editing of documents,
  real recording of screen and voice, real Figma sync. Their screens are final; the mechanics come in
  phase B.
- **VS Code** is shown as a picture of the extension. The extension itself is rebuilt to these screens
  in phase B.
- **Phone apps** (iOS, Android) stay in the later roadmap (T21–T24); the web app works on a phone and
  installs as an app today.

## 4. Questions for the owner before phase B

1. **Look and feel**: is design system v2 (dense, calm, one indigo accent, light and dark) the final
   direction, or are there changes to colour, density or type?
2. **Money format**: the screens show German formatting (1.286 €) in an English interface. Keep it, or
   follow each person's language (€1,286 in English, 1.286 € in German)?
3. **Agents compared with people** (Insights, Leaderboard): show it to everyone, or only to leads and
   admins?
4. **Client portal domain**: each client on its own domain (projects.helio-health.de) from the start,
   or one portal address first?
5. **Order of phase B** (section 5): is this the right order for the business, given the first paying
   customers?

## 5. Phase B: making the screens live

Each step replaces the sample data of finished screens with the real API and database, reusing what the
server already has (35 API modules: projects, items, sprints, lifecycle and gates, agents and runs,
ideas and proposals, environments and deploys, tests, findings, compliance, reviews, licences, billing,
two-step sign-in, push). Every step ends with the owner checking the live screens against the preview.

| Step | Content                                                                                                                                                                                                                              | Builds on                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| B0   | One data model for the approved screens: clients and portal roles, requests and threads with internal notes, documents and knowledge scopes, design assets, time entries, incidents, budgets and prices, saved views; migration plan | existing schema and row-level security      |
| B1   | Shell for real: roles incl. client, Home per role, Inbox, command palette and search, notifications, presence, settings inheritance                                                                                                  | auth, events, live gateway, push            |
| B2   | Planning and Canvas live (board, backlog, AI draft, Gantt with dependencies and baselines, workload)                                                                                                                                 | items, sprints, planner agent               |
| B3   | Ideation, Documents, UI kit                                                                                                                                                                                                          | ideas, proposals, signing                   |
| B4   | Test, Versions and releases, Security, Code map                                                                                                                                                                                      | tests, deploys, findings, fingerprints, git |
| B5   | Agents (full settings, traces, costs), Tokens and costs, People                                                                                                                                                                      | agent runtime, tokens, members              |
| B6   | Activity at scale (archive, query language, export), Insights                                                                                                                                                                        | outbox and event bus                        |
| B7   | Clients and the portal, Incidents and on-call, Time                                                                                                                                                                                  | sharing, guests, billing                    |
| B8   | VS Code extension and CLI on par with the web (section 4.8 of the spec)                                                                                                                                                              | extension, `orq`                            |

After phase B the remaining roadmap (docs and handover, release trains, live command center, enterprise,
GA, phone apps) continues with new dates set at the A1 review.

## 6. Sign-off

<!-- [PCODE-160 | S15 | v0.1.0] Gate A1 answers: agent-vs-people comparisons for admins only, sign-off recorded -->

**Passed on 4 Oct 2026.** The owner's answers to section 4:

1. Design system v2 is final ("perfect").
2. Money keeps the German format everywhere (1.286 €), also in the English interface. _Recorded from the
   answer "yes" to "keep it"; the owner can still choose per-language formatting._
3. Comparisons of agents with people (throughput split, rework, reverts, cost per point) are shown to
   **admins only**; leads and everyone else see totals. Applied to the preview in PCODE-160.
4. Each client gets its own portal domain from the start (part of B7, with TLS per domain).
5. The phase B order B0–B8 is approved.

- [x] Features approved (the specification and the screens)
- [x] UI approved (design system v2 and every page of `/preview`)
- [x] Answers to section 4 recorded
- [x] Phase B order approved

Approved by the owner in the session of 4 Oct 2026. Phase B starts with B0.
