<!-- [PCODE-243 | S15 | v0.1.0] T24.4 AI providers exit check, docs and sprint close -->
<!-- [PCODE-218 | S15 | v0.1.0] T20.1 Public docs site built from the repository (own Markdown renderer, CLI and API reference, link check) -->

# Getting started

This guide takes you from a machine with Docker to your team's first sprint in about an hour. Everything
runs on your machine, and nothing is sent to us.

## 1. Check the machine (5 minutes)

You need a Linux, Windows or macOS machine with:

- Docker: Docker Engine with the Compose plugin, or Docker Desktop.
- Node.js 22.
- 2 CPU cores, 2 GB of memory, 10 GB of free disk and one free port.

Download `orq.mjs` from the release. It is the whole Orqiva command line in one file. Then run:

```
node orq.mjs install --check
```

Every line should start with `ok`. A line with `FIX` says what to do. The check changes nothing.

## 2. Install (10 minutes)

```
node orq.mjs install --public-url https://orqiva.your-company.example
```

Leave out `--public-url` to use the machine's name. To have Orqiva get its own certificate, add
`--tls-email you@your-company.example`; for other options, see [HTTPS](install-server.md#https).

The install lives in `~/orqiva`. Keep its `.env` file private and include it in your machine backups:
without its secret key, the stored AI provider keys cannot be read. To upgrade, run `orq install` again.
It upgrades in place and keeps all data.

Open the address it prints and create the first account. That person owns the workspace.

## 3. Your team and first project (10 minutes)

- **Settings → Members:** invite your team. A member works, an admin manages, and a guest sees one project.
- **Projects → New project:** a key such as `APP` and a name. Tasks are then numbered `APP-1`, `APP-2` and so
  on.
- **Settings → AI providers:** connect Anthropic, OpenAI, Azure OpenAI, Gemini, Bedrock or Grok, and choose
  which connection serves agents, takes over when it fails, reads files and writes transcripts. Or add the
  demo model to try the agents without a key. See [AI providers and files](ai-providers.md).
- **Settings → Single sign-on** (optional): connect your identity provider with SAML or OpenID Connect, and
  SCIM to provision people.

## 4. Bring your backlog (10 minutes)

From Jira or Linear, export the issues as CSV, then run:

```
orq login --server https://orqiva.your-company.example
orq import jira jira-export.csv --dry-run
orq import jira jira-export.csv
```

The issue numbers stay as they were (`APP-12` stays `APP-12`), and running the import again updates what
it brought in. See [Moving to Orqiva](migrate/overview.md) for Jira, Linear and Plane.

## 5. Your first sprint (20 minutes)

1. **Backlog → create a sprint, then Plan.** Enter each person's points for the sprint.
2. **Suggest tasks.** The Planner agent proposes what fits. Untick what you do not want, then choose
   _Take into the sprint_.
3. **Write each task's acceptance criteria.** Ticking a criterion moves the progress bar on its card, for
   everyone.
4. **Start the sprint** and work on the board. Choose _Complete_ at the end. Velocity is measured from the
   sprints you finish.

New ideas go to the project's **Ideas** page:

- The Interviewer agent asks what is missing.
- The Architect agent drafts a proposal with an estimate.
- When the owner signs the proposal, its tasks are created.

## 6. From the terminal

Developers can do their daily work without the browser, in a folder linked with `orq link APP`:

```
orq list | orq start APP-12 | orq done APP-12    # the task loop
orq inbox                                        # what waits for you
orq approve 2 | orq decline 2 --note "why"       # answer an agent that asks
orq time start | orq time stop                   # the timer, on the active task
```

Every command is listed in the [command line reference](cli.html).

## 7. Backups

Run `orq backup` daily (with cron or Task Scheduler) and copy the files off the machine, together with
`.env`. See [Offline install and backups](offline-and-backups.md).
