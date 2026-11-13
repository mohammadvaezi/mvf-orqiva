<!-- [PCODE-437 | S15 | v0.1.0] T36.7 Test report and sprint close -->

# Version 1 test report (T36)

T36 tested the whole product on 15 October 2026, before the UX work of T37. This report covers what was
tested, how to run it again, what passed, and what was found. Every finding is a task in the tracker
(PCODE-412 to PCODE-436), with its severity in the title.

## How to run it

| What                                  | Command (from the repository root)         | Needs                                         |
| ------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| Unit and database tests               | `npm test`                                 | `ORQIVA_TEST_DATABASE_URL`                    |
| Journeys, every screen, keyboard pass | `npm run e2e --workspace packages/server`  | the database, a built web app, Edge or Chrome |
| Load and scale                        | `npm run perf --workspace packages/server` | the database; best on a quiet machine         |
| Our own scan                          | `orq scan`                                 | nothing                                       |

The browser tests drive headless Edge or Chrome over the DevTools protocol with our own small harness
(`packages/server/test/browser/harness.ts`). Set `ORQIVA_BROWSER` to use another browser. CI runs them on
Linux with Chrome, after the build, and keeps screenshots of failures.

## What passed

- **Journeys for every role** in a real browser, against the real server: owner, lead, developer, tester,
  designer, client and admin (31 steps), with no console errors.
- **Every screen** (34 workspace screens and 19 project views) in a workspace with work and in an empty
  one, light and dark, at 1400 and 390 px: no console errors, no accessibility findings, and no sideways
  scrolling on a phone. Screenshots of every screen land in `out/screens`.
- **Keyboard and screen reader**: on every screen, the first Tab reaches the skip link. Focus never gets
  stuck, and every control is reached. Ctrl+K opens the command bar with the focus inside, and Escape
  closes it. Every screen has a main region, navigation, one top heading, and a name on every control.
- **Security**: the authorization matrix over every route passes. Our own scan finds nothing; its false
  positives are written down in `.orqiva/scan-ignore` with a reason each. The external pen test is the
  owner's booking (`docs/security/pentest-brief.md`).
- **Live latency**: an edit shows for another person well under a second.

Found and fixed during T36:

- The daily digest gave up the day on a quiet check, so work that arrived later in that hour got no
  digest.
- A phone that gave up while connecting could crash the server with an unhandled socket error.
- The current app frame had no skip link.
- Ten project views had no top heading.
- Small targets and focus order on four screens.
- Clock-dependent and port-dependent test failures.

## Measurements

| Target                                | Measured                                                                     | Task      |
| ------------------------------------- | ---------------------------------------------------------------------------- | --------- |
| Activity: 10 000 events per second in | 117/s (one workspace, one per action) to 557/s (eight workspaces, batches)   | PCODE-412 |
| Activity: facets under 1 s            | 5.4–11.4 s over 1 million events (100 million was not built on this machine) | PCODE-413 |
| Command center at 100 projects        | screen p95 1181 ms (target 1000 ms); 20 projects pass                        | PCODE-414 |

Measured on the development machine, with PostgreSQL 17 on the same host. The numbers are in
`out/activity.json` and `out/scale.json`.

## Defects and UX issues

| Severity | Task      | Issue                                                           |
| -------- | --------- | --------------------------------------------------------------- |
| high     | PCODE-412 | Activity ingestion far below 10 000 events per second           |
| high     | PCODE-413 | Activity facets take seconds                                    |
| high     | PCODE-414 | Command center slower than 1 s at 100 projects                  |
| high     | PCODE-415 | Testers cannot write test cases or plan runs in the browser     |
| high     | PCODE-416 | A person in two workspaces cannot reach the second              |
| medium   | PCODE-417 | Members see the Administration group                            |
| medium   | PCODE-418 | The task page does not show or change the assignee              |
| medium   | PCODE-419 | A filed bug does not show as a bug and loses the step note      |
| medium   | PCODE-420 | German number and date formats in the English UI                |
| medium   | PCODE-421 | Members cannot pick their own language                          |
| medium   | PCODE-422 | German leftovers                                                |
| medium   | PCODE-432 | The empty home does not guide a new workspace                   |
| low      | PCODE-423 | Command-line words in the web app                               |
| low      | PCODE-424 | Policy dry run says "1 tasks"                                   |
| low      | PCODE-425 | Policy rows scroll sideways                                     |
| low      | PCODE-426 | Portal home shows an empty budget                               |
| low      | PCODE-427 | The portal survey comes too early; its field is too narrow      |
| low      | PCODE-428 | Request references share one counter                            |
| low      | PCODE-429 | A very short timer books nothing without saying why             |
| low      | PCODE-430 | The board on a phone                                            |
| low      | PCODE-431 | The Time page on a phone                                        |
| low      | PCODE-433 | Task descriptions show raw Markdown                             |
| low      | PCODE-434 | No screen control for WIP limits and custom-field filters       |
| low      | PCODE-435 | Quality board bars show their percentage only to screen readers |
| low      | PCODE-436 | Three folder import cycles in Orqiva's own code                 |

<!-- [PCODE-441 | S15 | v0.1.0] T37 Close: results in the test report, roadmap and plan -->

## After T37 (16 October 2026)

T37 worked through the list by severity. All browser tests (45 steps: journeys, every screen, keyboard and
screen reader), the server's 920 tests and the load tests pass on the final code.

| Target                                 | T36                 | After T37                                 |
| -------------------------------------- | ------------------- | ----------------------------------------- |
| Activity: events per second in         | 117–557/s           | 132/s one per action; 7 113/s in batches  |
| Activity: search over 1 million events | 5.4–11.4 s          | 75–176 ms (facets, windows and free text) |
| Command center at 100 projects         | screen p95 1 181 ms | screen p95 392 ms                         |
| Live latency                           | passed              | p95 114 ms                                |

How: events are written in one statement, and batches build the hash chain inside the database. The
activity page counts from hourly roll-ups that the writers keep; free text goes through its own index,
whose table is the one documented exception to row-level security. The command center reads every
project's lifecycle in four queries instead of four per project.

| Task          | Result                                                                                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PCODE-412     | Batches 14× faster. One event per action is bound by its own commit; 10 000/s was not reached on this 6-core 1.8 GHz desktop                                                                                                                                         |
| PCODE-413     | Done                                                                                                                                                                                                                                                                 |
| PCODE-414     | Done                                                                                                                                                                                                                                                                 |
| PCODE-415     | Done: testers write cases and plan runs                                                                                                                                                                                                                              |
| PCODE-416     | Done: a workspace switch in the sidebar's header, remembered on the device                                                                                                                                                                                           |
| PCODE-417     | Done: members see "Your account" instead of "Administration"                                                                                                                                                                                                         |
| PCODE-418     | Done: the task page shows and changes the assignee                                                                                                                                                                                                                   |
| PCODE-419     | Done: a bug says so; a failed step takes a note into the bug                                                                                                                                                                                                         |
| PCODE-420     | Done: every screen follows the workspace's number format (German by default, the owner's decision)                                                                                                                                                                   |
| PCODE-421     | Done: everyone picks their own language in Profile                                                                                                                                                                                                                   |
| PCODE-422     | Done: server-sent texts, counts, activity sentences and relative times in German                                                                                                                                                                                     |
| PCODE-423–435 | Done: wording, dry-run counts, policy rows, portal budget and survey, request numbers per kind, short timers, the board and the Time page on a phone, the first steps of a new workspace, formatted task descriptions, WIP limits and field filters, bar percentages |
| PCODE-436     | Done: no folder imports another that imports it; guard tests in web, server and CLI                                                                                                                                                                                  |
| PCODE-438     | Done: activity free text through its own index                                                                                                                                                                                                                       |
| PCODE-439     | Left for the owner: the same speed-up for tasks, documents and messages would keep their words outside row-level security                                                                                                                                            |
| PCODE-440     | Done: every error is announced as an alert and every loading line as a status                                                                                                                                                                                        |

Still open beyond T37: request prefixes (F, BUG, CR, Q) stay as they are, since changing them would
rename references clients already use. The external pen test, 100 million events, and real identity
providers are the owner's.
