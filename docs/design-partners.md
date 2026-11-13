<!-- [PCODE-243 | S15 | v0.1.0] T24.4 AI providers exit check, docs and sprint close -->
<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- [PCODE-130 | S15 | v0.1.0] Build the design-partner install kit: backup, restore, check, guide -->

# Orqiva for design partners

Thank you for running Orqiva with your team during the alpha. This guide takes you from an empty
machine to your first sprint, in about an hour. Everything runs on your machine; nothing is sent to us.

## 1. Check the machine (5 minutes)

You need a Linux, Windows or macOS machine with Docker (Docker Engine with the Compose plugin, or Docker
Desktop), 2 GB of free disk and one free port. Then:

```
orq install --check
```

Every line should start with `ok`. A line with `FIX` says what to do. The check changes nothing.

## 2. Install (10 minutes)

```
orq install --public-url https://orqiva.your-company.example
```

Leave out `--public-url` to use the machine's name. The install lives in `~/orqiva`: `compose.yaml`,
and `.env` with generated passwords and the server's secret key. Keep `.env` private and include it in
your machine backups; without its secret key, stored AI provider keys cannot be read. Running
`orq install` again later upgrades in place and keeps all data.

Open the address it prints and create the first account: that person owns the workspace. Put HTTPS in
front of it before others use it over a network (see `docs/install-server.md`, HTTPS).

## 3. Your team and first project (10 minutes)

- Settings, Members: invite your team (member to work, admin to manage, guest for one project).
- Projects, New project: a key such as `APP` and a name. Tasks are `APP-1`, `APP-2` and so on.
- Settings, AI providers: connect the providers you use (Anthropic, OpenAI, Azure OpenAI, Gemini,
  Bedrock, Grok), or add the demo model to try the agents without a key.

## 4. Bring your backlog (10 minutes)

From Jira or Linear, export the issues as CSV and run (see `docs/install-server.md` for details):

```
orq login --server https://orqiva.your-company.example
orq import jira jira-export.csv --dry-run
orq import jira jira-export.csv --server https://orqiva.your-company.example
```

Numbers stay as they were (`APP-12` stays `APP-12`). From Plane: `orq import plane`.

## 5. Your first sprint (20 minutes)

1. Backlog: create a sprint, then Plan. Enter each person's points for the sprint.
2. Suggest tasks: the Planner agent proposes what fits; untick what you do not want, then Take into the
   sprint.
3. On each task, write its acceptance criteria. Ticking them moves the bar on every card, for everyone.
4. Start the sprint, work on the board, and Complete it at the end. Velocity is measured from the sprints
   you finish.

New ideas go to the project's Ideas page: the Interviewer agent asks what is missing, the Architect agent
drafts a proposal with an estimate, and the owner signs it, which creates its tasks.

<!-- [PCODE-195 | S15 | v0.1.0] the team's daily work from the terminal -->

### From the terminal

Everything a developer does daily also works without the browser, in a folder linked with `orq link`:

```
orq inbox                              # what waits for you, numbered
orq approve 2 | orq decline 2 --note "not on Friday"   # answer an agent that asks
orq comment APP-12 "Live on staging" --client          # the client reads it in the portal
orq time | orq time start | orq time stop | orq time set APP-12 1,5
orq agent ask tester "write tests for the criteria"    # on the active task
orq agent watch <run> | orq agent stop <run> | orq agent pause
orq idea "Reminders by SMS" | orq idea interview APP-I3 "older patients"
```

Without a network, comments, hours, inbox actions, decisions and new ideas wait and go with `orq sync`.
`orq --help` lists every command.

## 6. Backups

```
orq backup                       # writes ~/orqiva/backups/orqiva-YYYYMMDD-HHMM.dump
orq restore <file.dump> --yes    # replaces all data with the backup; make a backup first
```

Run `orq backup` daily (cron or Task Scheduler) and copy the files off the machine with `.env`.

## 7. Getting help

Send us what `orq install --check` prints and, if the server misbehaves, the last lines of
`docker compose logs server` from `~/orqiva`. Tell us what you expected to happen; that is the most
useful feedback of the alpha.
