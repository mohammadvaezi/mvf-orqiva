<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- [PCODE-110 | S15 | v0.1.0] Run the M1 review and re-plan T07 onward -->

# M1 review: Dogfood (T01–T06)

Prepared 3 Oct 2026 for the owner's decision. The milestone is signed off by the owner, not by this document.

## The exit criterion

> Orqiva builds Orqiva for 5 working days with no Plane.

**Status: running since 3 Oct 2026.** PCODE moved to the Orqiva server on this machine
(http://localhost:8480) on 3 Oct; the `plane` command and hooks are off for this repository; Plane is the
read-only archive. Since then every task (PCODE-109, 113–116) was created, started and finished with `orq`
on Orqiva. Day 5 without Plane is **9 Oct 2026**; sign-off is possible from then.

## What M1 delivered, against the plan

| Sprint | Planned                                              | Delivered                                                                                                    | Note                                      |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| T01    | Monorepo, CI, schema, auth, API, web shell           | All, plus own licence gate and SBOM, `orq install`, Docker image                                             | Own HTTP layer, no framework              |
| T02    | Work tracking, real-time sync, own bus and WebSocket | All: items, states, labels, comments, outbox and event bus, RFC 6455 gateway, SSE, local-first store         |                                           |
| T03    | Planning core and presence                           | All: sprints, backlog, board, list, filters, command bar, presence                                           |                                           |
| T04    | The loop on our server                               | All: loop API, `orq` CLI and Claude Code hooks, fingerprints on the server, live loop events                 |                                           |
| T05    | VS Code on the new API; Plane importer               | All: extension live over our WebSocket (no polling), activity feed, Plane importer with comments and history | Real PCODE import verified field by field |
| T06    | Git integration; Plane retired                       | All: GitHub and Gitea webhooks, commits and PRs on items live; PCODE moved, Plane archived                   | Real webhooks need a reachable server     |
| extra  | (not planned)                                        | Web app rebuilt: shell, dashboards with own charts, settings, members, invitations, the reference look       | Owner request, 3 Oct (PCODE-113–116)      |

Size at M1: about 131,000 lines of TypeScript; the full check (lint, tests, build, licence gate) runs
10 shared, 185 server, 47 CLI, 55 web and 472 extension tests; 18 third-party packages ship, none denied.

## What is not done, or not proven yet

1. **Reachable server.** The server runs on the owner's machine. GitHub webhooks, teammates and mobile need
   a host on the internet with HTTPS (decision below).
2. **Phone-width layout** is written but not yet looked at in a narrow window.
3. **v0.1.0 release items** PCODE-69 (smoke checklist on a clean VS Code profile) and PCODE-71 (tag and
   release the .vsix) are still open from Sprint 14.
4. **Review queue.** About 110 imported and new items sit in Review; most are finished work waiting for the
   owner to move them to Done.
5. **Git identity.** Commits on this machine carry no author name and email.
6. **Upgrade message.** `orq install` on an existing install still says "create the first account".

## Decisions for the owner

1. **Sign off M1** after 9 Oct if the 5 days hold, or name what blocks it.
2. **Where the server lives** for teammates and GitHub: a Linux host with a DNS name and HTTPS.
3. **Push target** for the repository (Farivarz/Orqiva or a new one), still open since T01.
4. **Review queue:** move the reviewed work to Done in bulk, or go through it.
5. **Licence wording** (PCODE-83) before anything ships to a customer.

## Re-plan from T07

The calendar is far ahead of the plan: T01–T06 were planned for 5 Oct to 23 Dec 2026 and are done on
3 Oct. The proposal keeps the order and scope of the plan and moves the dates forward, with one change:

| Sprint | Goal                                      | Change                                                                                 |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| T07    | Lifecycle engine: stages, gates, sign-off | As planned; starts now. Exit: a project walks Ideation → Approval with gates blocking. |
| T08    | Agent runtime                             | As planned                                                                             |
| T09    | Front half: ideas, interview, proposal    | As planned                                                                             |
| T10    | M2 Alpha                                  | Add: deploy to a reachable host, so design partners and GitHub webhooks can reach it   |

The hiring dates (January and March 2027) and the GA date stay until the owner decides otherwise.
