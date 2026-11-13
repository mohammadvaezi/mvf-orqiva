<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- ── [PCODE-68 | S14 | v0.1.0] Write the user documentation: install, setup, daily loop, release and deploy ── -->

# Using Orqiva

The rule the whole thing exists to enforce: **no code without a task, the task's state follows the
work, and every block of code carries the task, sprint and version it was written for.** Everything
below is that loop, plus the panels around it.

Installed already? Good. Otherwise: **[install.md](install.md)**.

- [The Home tab](#the-home-tab)
- [The sidebar](#the-sidebar)
- [The daily loop](#the-daily-loop)
- [Fingerprints](#fingerprints)
- [Planning a new project](#planning-a-new-project)
- [The Docs view](#the-docs-view)
- [Code documentation](#code-documentation)
- [Security checklist and checks](#security-checklist-and-checks)
- [Working across projects](#working-across-projects)
- [Release, Docker and deploy](#release-docker-and-deploy) → [release.md](release.md)
- [Settings](#settings)
- [When something goes wrong](#when-something-goes-wrong)

<!-- ── [PCODE-78 | S08 | v0.1.0] Add the Orqiva Home tab: guided setup steps and a visual task board ── -->

## The Home tab

**Orqiva: Open Home** (the house button on the Sprints view, and it opens by itself when VS Code
starts) is the place to begin, and for most people the only place they need. No command names, no
syntax: four steps across the top, and one big button for the step you are on.

<!-- ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ── -->

1. **This computer**: _Check this computer_ opens the setup report, with a button for anything missing.
   A computer already signed in to an Orqiva server skips this step.
2. **Sign in to Orqiva**: _Sign in_ (**Orqiva: Sign in to the Orqiva server**) asks for the server's
   address, your e-mail and your password, once. The password is not kept: this computer keeps a personal
   token in `~/.orqiva/credentials.json`, the same sign-in `orq login` makes. The setup program signs you
   in already, so most people never see this step.
3. **Your project**: _Choose a folder…_, then _Start a new project_ or _Use an existing project_.
   _Use an existing project_ (**Orqiva: Link this folder to an Orqiva project**) lists the projects you
   can see on the server, including one made a minute ago in the web app, and writes
   `.orqiva/project.json`, as `orq link KEY` does. _Start a new project_ creates the project on the server
   and links the folder to it.
4. **Work**: the sprint as a board, To do → Working on it → Check it → Done.

<!-- ── [PCODE-454 | S15 | v0.1.0] VS Code extension: Home tab shows and changes project, server and account; planning works on the Orqiva server ── -->

A finished step opens again with a click. _Sign in to Orqiva_ shows the server and the account, with
_Sign in to another server or account_. _Your project_ shows the linked project and its server, with
_Link to another project_, _Start a new project_ and _Open in Orqiva_
(**Orqiva: Open the project in Orqiva**). The project's name at the top right opens the same view.

On a project with no tasks yet, the tab plans it with you: describe the idea, let Claude draft the plan,
check it, and publish it. On an Orqiva folder the planning prompt ships with the extension, the check
runs in the extension, and Publish makes the sprints and tasks on the server; a second Publish adds only
sprints and tasks whose names are new.

Each card on the board has its buttons:

- **Build with Claude** starts the task and opens Claude Code with the task as its first message, in a
  terminal of its own. Claude reads the task, does the work and says when it is ready.
- **Finished** (on the task you are working on) runs Done: it checks the fingerprints, commits, and
  moves the task to Review.
- **Start** only starts the task, for when you write the code yourself; the title opens the task
  details; **Open online** opens the item in the browser.

<!-- ── [PCODE-79 | S08 | v0.1.0] Add the New project wizard: describe the idea, draft, review and publish the plan visually ── -->

**A new project** is a short wizard in the same tab. _Start a new project_ asks for a name and a short
code (the task prefix, suggested from the name) and creates the project. Then the board makes room for
four steps: **Describe your idea** (a text box, plain words), **Claude plans it** (_Plan it with
Claude_ runs **Orqiva: Draft the plan with Claude** in a terminal; the page moves on by itself when
the plan is written), **Check the plan** (anything wrong is listed, and _Let Claude fix it_ plans
again) and **Publish the plan** (the plan as cards; _Publish the plan_ publishes after one
confirmation). A folder linked to an Orqiva project skips the wizard and shows its board: Orqiva
projects are planned in the web app. The wizard reads where you are from the files, so closing VS Code half-way loses nothing.

Above the board: **New task**, **Plan the project** (Claude turns a description into sprints),
**Get latest** (Sync) and **All projects**. Turn the automatic opening off with
`orqiva.home.openOnStartup`.

## The sidebar

The Orqiva icon in the activity bar opens three views.

**Sprints** is the board of this folder's project: today's sprint first and expanded, then the next
ones, then the backlog. Each item shows its state icon, its priority and its reference (`PCODE-12`).
The title bar carries **Start development**, **Sync**, **New task**, **Plan the project** and
**Projects dashboard**.

**Docs** lists the documents in `.orqiva/` — rules, criticals, architecture, design system, the
description, the security checklist — plus the generated code documentation, and the Release, Docker
and Deploy panels.

<!-- [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move -->

The project's files live in `.orqiva/` on a folder linked to Orqiva. A folder still on the legacy
engine keeps them in `.plane/`, which that engine reads. When an Orqiva folder still has a `.plane/`
folder, the extension moves its files to `.orqiva/` once, the first time the folder is opened trusted:
a file `.orqiva/` already has, and the legacy engine's own files, go to `.orqiva/legacy/`, and the
empty `.plane/` is removed. The Orqiva output channel lists every file it moved.

**Activity** shows what the team and its AI agents do on the project, live: one line per event
("Ada moved PCODE-12 Export → Review"), newest on top, with a person, robot or gear icon for who acted.
Clicking a line runs **Open task from activity**, which opens the task in the web app. The view needs a
folder on an Orqiva server (see below).

### On an Orqiva server

A folder linked with `orq link` (it has `.orqiva/project.json`) runs on your Orqiva server
instead of Plane: run `orq login --server <url>` once and `orq link <PROJECT-KEY>` in the folder. The
board then follows the server live (there is no refresh timer), and Sync, Start, Done, Status, Note and
New task run the same loop as `orq` in the terminal and the Claude Code hooks, so all three share one
active task.

The **status bar** shows the active task and the number of Plane updates still queued. Clicking it
opens the task. An item with no active task reads `Orqiva: no task`.

<!-- [PCODE-193 | S15 | v0.1.0] the task panel, comments, inbox and timer on the server -->

On a linked folder the **task panel** shows the task as Orqiva has it: description, acceptance criteria
as ticked on the web, and the comments. Its **Comment** button writes a comment on the task; when the
project belongs to a client, tick _Written for the client_ to let them read it in their portal. Every
comment shows on the web within a second, and the other way round.

The **Inbox** view lists what waits for you, the same list as on the web: approvals your agents ask
for, mentions, gates to sign and incidents. Click an entry (**Orqiva: Open in Orqiva**) to open it in the
browser. The buttons on an entry are **Orqiva: Done** and **Orqiva: Snooze for an hour**. When an agent
waits for you, **Orqiva: Approve** lets it go on and **Orqiva: Decline** stops it with a reason the agent
reads. **Orqiva: Refresh inbox** reads it again (it also updates by itself when something happens).

<!-- [PCODE-236 | S15 | v0.1.0] T23.3 Messages for clients, in VS Code and in the CLI -->

The **Messages** view lists your channels and direct messages in Orqiva, with the number of unread
messages and an **@** where someone mentioned you. Click one (**Orqiva: Open conversation**) to read and
write in a panel beside the code: replies in a thread, reactions, and task references that open the task.
**Orqiva: Refresh messages** reads the list again (it also updates by itself). When someone mentions you
or writes to you directly, VS Code tells you unless that conversation is already open.

The **timer** in the status bar shows the running timer (task and clock) or today's hours, with the
week in its tooltip. **Orqiva: Start or stop the timer** (or a click) starts it on the active task or
stops it; the time lands on your week in Time on the web. Time from `orq start` … `orq done` is recorded
anyway, without a timer.

<!-- [PCODE-194 | S15 | v0.1.0] agents, findings, the code map and tests on the server -->

The **Agents** view shows this project's agent runs, the running and waiting ones first. Expand a run
to see its steps, worded as on the web: what the model called, when tools ran, when it asked a person.
**Orqiva: Ask an agent** picks an agent and asks it to work on your active task (or on the project when
no task is active). On a run, **Orqiva: Stop the run** stops it and
**Orqiva: Open the run in the web app** shows its full trace. An admin can use
**Orqiva: Pause all agents** and **Orqiva: Resume all agents** from the view's menu: running steps
finish, and nothing new starts. **Orqiva: Refresh agents**
reads the list again; it also updates by itself.

The open **code findings** of the project (secrets, code rules, dependencies) appear in the Problems
panel and as squiggles on their line. A finding with a task names it. On one without, the quick fix
**Orqiva: Make a task for this finding** makes the task. **Orqiva: Read the code findings again** reads
them now; they are also read when VS Code gets focus and when a finding changes.

On top of each file the code map knows, a lens shows its **hot spot** score, health, how often it
changed, its complexity, who wrote most of it and the tasks behind it. A click
(**Orqiva: Open the file on the code map**) opens its folder on the web's code map. The lens follows the CodeLens setting.

In the task panel each acceptance criterion shows its tests: _tests pass_, _a test fails_, _not tested
yet_ or _no test_, with the number of cases. **Orqiva: Run the tests and report them** asks for the test
command (it must write TAP, e.g. `npx vitest run --reporter=tap-flat`), runs it in the _Orqiva tests_
output and sends every result to Orqiva, as `orq test run` does.

<!-- [PCODE-196 | S15 | v0.1.0] ideas and presence in the editor -->

**Orqiva: Note an idea** writes an idea down without leaving the editor. The interviewer then asks its
first question in an input box. Answer it, and the next one follows, until the interviewer writes the
summary the idea's proposal starts from. Press Escape to go on later, here with **Orqiva: Idea interview**
or on the web.

<!-- [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code -->

**Orqiva: Add a source to an idea** (also in the editor's context menu when text is selected) gives an idea
something to extract from: the selection (titled with the file and lines), the open file, a link, or text
and a quote with who said it. The server reads a link straight away, a web page as text and a PDF or Word
file like an upload, and the message says how many characters it found or why it could not read it. From
the terminal: `orq idea source APP-I3 --file brief.pdf`, `--link https://…` or `--text "…" --said-by "…"`,
and `orq idea show APP-I3` lists the sources with how far each is read.

When someone else has the same file open, the status bar shows how many and who (tooltip). The lens
above a fingerprint adds _Ada is here_ when a colleague works on that block's task in this file. Files are
only shared when an admin switches on _Show the file people work in_ in the workspace settings (off by
default); guests never see them. Without it, presence stays at task level.

<!-- [PCODE-201 | S15 | v0.1.0] docs from code and the handover -->

**Orqiva: Rebuild docs from code** rebuilds the pages in the project's _Built from the code_ folder (API
reference, system overview, built by task) from the last code scan; `orq docs scan` in the terminal sends a
new one. **Orqiva: Handover status** lists the handover checks and the team checklist: pick an item to tick
it, and once nothing required is missing, send the pack to the client from the top of the list.

<!-- [PCODE-207 | S15 | v0.1.0] releases and environments -->

**Orqiva: Releases and environments** lists the project's environments with what runs on each: promote a
version to the next one (it waits for the approver where one is set), approve or decline a waiting
promotion, or roll an environment back to what ran there before.

<!-- [PCODE-311 | S15 | v0.1.0] code review in VS Code -->

**Orqiva: Review pull requests** lists the project's open pull requests, riskiest first, with their task,
review and checks state and how many files you have viewed. Pick one to see its changed files. A file opens
as a diff of the changed parts, and opening it marks it viewed. Comment on any changed line with the `+` in
the margin. Your comment is a draft until you post it: **Submit the review** (in the editor's title bar, or
**Files of this pull request**) approves, requests changes or only comments, and posts your drafts to the
host with it. **Ask the Reviewer agent for suggestions** puts the agent's comments on the lines:
**Accept suggestion** makes one your draft, **Dismiss suggestion** hides it, and **Delete draft** removes one of
your own. **Add draft comment** is the button under the comment box.

## The daily loop

### 1. Sync

**Orqiva: Sync** (or the title-bar button) carries yesterday's unfinished items into today's sprint,
flushes any Plane updates that were queued while you were offline, and refreshes `.plane/sprints.md`.
Start here; it is the only command that reconciles the board with reality.

### 2. Start a task

Click an item in the Sprints view and press **Start**, or **Orqiva: Start** from the palette. The
item moves Todo → In Progress, becomes the active task, and the engine announces the fingerprint you
are to use.

One task is active at a time. To switch, move the current one first: **Orqiva: Status…** offers
Review, Test, Blocked or Todo, and asks for a reason that becomes a Plane comment.

Nothing to start? **Orqiva: New task** opens a form: title, sprint, label, priority, description and
acceptance checks. The engine refuses a task without a real description and at least one acceptance
check, because a task nobody can judge cannot be finished. **Orqiva: Open in the web app** opens the item
in the browser (Orqiva, or Plane for a folder still on Plane) when you want the full board.

### 3. Write the code

**Orqiva: Start development** opens Claude Code in the integrated terminal, in this folder, with the
engine's environment. From there Claude works the same loop — and the hooks refuse an edit when no task
is active, so it cannot drift.

You can of course type the code yourself. The rules apply either way.

### 4. Finish

**Orqiva: Done**. The engine scans for the task's fingerprint and **refuses if no file carries it**,
then commits everything with the task reference as the message, posts the commit hash and the file list
to Plane, regenerates `.plane/fingerprints.md`, and moves the item to Review.

**Orqiva: Note…** adds a comment at any point — a decision, a blocker, something the next person
needs. Decisions belong in Plane, not only in your head.

## Fingerprints

A fingerprint is a comment naming the task, sprint and version a block of code was written for:

```ts
// ── [PCODE-12 | S03 | v0.1.0] Add the state store with a file watcher ──
//    Task: https://plan.broszio.com/.../issues/
//    Why:  the engine writes .plane/state/*; the store must notice within a moment.
```

One in the file header per task that shaped the file, and one above each function or section added or
materially changed for the task.

- **Orqiva: Copy fingerprint** puts the active task's marker on the clipboard.
- **Orqiva: Insert fingerprint for the active task** writes it at the cursor, in the comment syntax
  of the language you are in.
- Above every marker, a **CodeLens** shows the task's title and current state, and opens it on click.
  Turn it off with `orqiva.codeLens.enabled`.
- **Orqiva: Open active task** opens the task panel: description, acceptance checks, comments, and
  the files that carry its fingerprint — each opening at the right line.

This is what makes the board and the code point at each other, and what `Done` checks before it lets a
task close.

## Planning a new project

For a project that has no sprints yet.

1. **Orqiva: Open project description** — write what you want in `.orqiva/description/description.md`.
   Prose, not tickets. Screenshots and PDFs in that folder are read too.
2. **Orqiva: Plan the project** opens the Plan panel. **Draft plan** starts Claude Code with the
   planning prompt; it reads the description and writes `architecture.md`, `design-system.md`, the
   project half of `rules.md`, `criticals.md` and `plan.json` — one-day sprints, each item with a
   description and acceptance checks. Nothing has reached Plane yet.
3. **Check plan** validates it and reports what is wrong.
4. **Orqiva: Publish the plan to Plane** shows the count, asks once, then creates the cycles and the
   items. Publishing again adds what is new; it never deletes.

## The Docs view

Every document is one click from the Docs view, and **Orqiva: Open source** opens the underlying
file when a preview is showing. **Orqiva: Refresh docs** re-reads the folder if you changed it
outside the editor.

## Code documentation

**Orqiva: Generate code documentation** walks the workspace, reads every fingerprint and writes
`docs/generated/`: a README, one page per sprint and one per task, each linking to the exact source
lines. Running it again rewrites only what changed. `orqiva.docs.outputFolder` moves it;
`orqiva.docs.postToPlane` controls whether each task also gets a comment linking to its page.

## Security checklist and checks

**Orqiva: Security checklist** opens the checklist for this project. The first time, it is copied
from a template — 38 items across nine sections — into `.orqiva/security.md`, which is committed, so the
ticks travel with the repository and a reviewer can read them without the editor. Ticking saves
immediately; the Docs entry shows the count.

Under **Checks**, three things a machine can answer:

- **npm audit** — the severity counts for this project.
- **pip-audit** — for Python projects, and only when the module is really installed.
- **Secret scan** — the workspace against the real formats of Plane, AWS and GitHub credentials,
  private-key blocks and hard-coded assignments. A finding reports the file, the line and the rule,
  with the value masked.

Each run writes a dated line under the item it answers and **ticks nothing**: a green run today is
evidence for the person deciding, not the decision. A line the scan should ignore — a deliberate test
fixture — is marked `orqiva:allow-secret` in a comment on it or above it.

## Working across projects

**Orqiva: Projects dashboard** shows every project in the Plane workspace: open, in progress, review
and done counts, the sprint covering today, how long ago anything moved. **Open board** goes to Plane;
**Open folder** appears for a project this machine has opened before and switches to it — Ctrl/Cmd-click
for a new window.

In a folder that is not linked to anything, the Sprints view offers **Orqiva: Open a recent project**
instead of an empty board.

## Release, Docker and deploy

**Orqiva: Version and release**, **Orqiva: Bump the version**, **Orqiva: Docker**,
**Orqiva: Generate Dockerfile and compose with Claude** and **Orqiva: Deploy** are covered in
**[release.md](release.md)**.

<!-- [PCODE-458 | S15 | v0.1.0] VS Code extension updates itself from GitHub: CI publishes the build, Update button installs it -->

## Updates

**Orqiva: Check for updates** (the **Update** button at the top of the Home tab) asks GitHub for the
newest build. Every push to the repository's main branch is built by GitHub Actions and published as
the release `ide-latest`, with the extension, the `orq` command and the build's commit and time. When
that build is newer than the one you run, Orqiva downloads it, installs it, puts the new `orq` in
place of the old one (kept as `orq.mjs.before-update`) and asks you to reload VS Code.

When VS Code starts, the same check runs quietly and only offers the update. A private repository is
read with your GitHub sign-in in VS Code: the first check asks you to sign in (Accounts, bottom left).

## Settings

| Setting                              | What it does                                                               |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `orqiva.update.repository`           | The GitHub repository the updates come from (`owner/name`)                 |
| `orqiva.update.release`              | The release tag GitHub Actions publishes the extension to                  |
| `orqiva.update.checkOnStartup`       | Look for an update when VS Code starts                                     |
| `orqiva.engineHome`                  | The `plane\claude` folder, when `PLANE_CLAUDE_HOME` is not set or is wrong |
| `orqiva.pythonPath`                  | A specific Python, instead of `py -3` / `python3` / `python`               |
| `orqiva.plane.baseUrl`               | Your Plane instance                                                        |
| `orqiva.plane.workspace`             | The workspace slug                                                         |
| `orqiva.claudeCommand`               | What **Start development** types into the terminal                         |
| `orqiva.codeLens.enabled`            | The lens above each fingerprint                                            |
| `orqiva.docs.outputFolder`           | Where generated documentation is written                                   |
| `orqiva.docs.postToPlane`            | Whether generated pages are announced as Plane comments                    |
| `orqiva.docker.healthUrl`            | The URL the Docker panel polls after starting                              |
| `orqiva.docker.healthTimeoutSeconds` | How long that request may take                                             |
| `orqiva.home.openOnStartup`          | Open the Home tab when VS Code starts                                      |

The API key is deliberately **not** a setting. It lives in SecretStorage; **Orqiva: Forget the legacy tracker key**
removes it.

Two more commands exist for the setup itself: **Orqiva: Open setup** (the panel with the environment
report and the connection) and **Orqiva: Install Claude Code hooks** (re-registers the hooks if a
Claude Code upgrade dropped them). **Orqiva: Hello** does nothing but prove the extension is alive.

## When something goes wrong

Every failure shows one line: what failed, why in the engine's own words, and what to do next — with a
button that does it. "Open output" shows the full log in the **Orqiva** output channel, where a key
is never printed.

| What you see                                  | What it means                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `… is still active. Move it first`            | One task at a time. **Status** the current one, or **Done** it                                                                   |
| `no file carries the fingerprint`             | `Done` found no marker for this task. **Copy fingerprint** and put it above the code you wrote                                   |
| `has no usable description`                   | The item has nothing to judge it by. Fill it in in Plane, then start it again                                                    |
| `Plane refused the key`                       | The token was revoked or mistyped. **Connect Plane** again                                                                       |
| `Check the Plane address and your connection` | Plane is unreachable. Work continues; the engine queues its writes and the status bar counts them. They flush on the next `Sync` |

The board is read from `.plane/sprints.md`, so the sidebar keeps working with no network and no key at
all — only the commands that write to Plane need either.
