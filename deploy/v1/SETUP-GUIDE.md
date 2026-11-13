<!-- [PCODE-442 | S15 | v0.1.0] T38 V1 test package for the dev team: server bundle, IDE setup exe, setup guide -->

# Orqiva version 1: setup guide for the test

This folder holds everything the team needs to test Orqiva version 1 (build 0.1.0): the server, the
setup for developer machines, and the documentation. Nothing in it is a password, key or account. Each
person creates their own sign-in on your test server.

The test has two roles:

- **One person (the server admin)** installs the server once, creates the workspace and invites the
  team. This takes about 30 minutes. See parts 1 and 2.
- **Every tester** installs the developer setup on their own machine and signs in. This takes about 10
  minutes. See part 3.

Then everyone works in Orqiva as they normally would and reports what they find. See parts 4 and 5.

## What is in the folder

| Path                                  | What it is                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `SETUP-GUIDE.html`, `SETUP-GUIDE.md`  | this guide                                                                       |
| `server/orqiva-server-0.1.0.tar`      | the server images for an install without internet: Orqiva, PostgreSQL 17, Caddy  |
| `server/orqiva-server-0.1.0.tar.json` | the list of images in the bundle and its SHA-256                                 |
| `server/orq.mjs`                      | the Orqiva command line, one file; it installs the server                        |
| `ide/Orqiva-IDE-Setup-0.1.0.exe`      | the developer setup for Windows                                                  |
| `ide/manual/`                         | the same files for macOS, Linux, or a manual install on Windows                  |
| `browser-bug-capture/`                | the browser extension that files a bug with a screenshot (Chrome, Edge, Firefox) |
| `docs/index.html`                     | the full documentation, offline                                                  |
| `SHA256SUMS`                          | the checksum of every file                                                       |

To check that nothing changed on the way, compare the checksums. On Linux or macOS, run
`sha256sum -c SHA256SUMS` in the folder. On Windows, run `Get-FileHash <file>` in PowerShell and compare
the result with the line in `SHA256SUMS`.

## 1. Install the server (server admin, about 20 minutes)

### What the server machine needs

- Linux (Ubuntu 22.04 or 24.04), or Windows or macOS with Docker Desktop.
- Docker with the Compose plugin: `docker compose version` must answer.
- Node.js 22 or newer, for `orq.mjs`.
- 2 CPU cores, 4 GB of memory, 10 GB of free disk.
- One free port that the testers' machines can reach, 8080 by default.

The server does not need internet access. Everything it runs is in the bundle.

### Install

Copy the `server` folder to the machine, open a terminal in it, and check the machine first:

```
node orq.mjs install --check --port 8080
```

Every line should start with `ok`. A line with `FIX` says what to change. The check changes nothing.

Then install. Use the address the testers will open in their browser:

```
node orq.mjs install --bundle orqiva-server-0.1.0.tar --public-url http://orqiva-test.your-company.lan:8080
```

- The command loads the images, starts PostgreSQL and the server, and waits until the server answers.
  On the first start the database is created, which takes up to a minute.
- The install lives in `~/orqiva`. Its `.env` file holds the database passwords and the server's secret
  key, which are generated for this install. **Keep `.env` on the server and do not share it.**
- With a domain name that the internet can reach, add `--tls-email you@your-company.example`, and
  Orqiva gets its own HTTPS certificate. On an internal network, plain `http://` is fine for the test.
- If port 8080 is taken, add `--port 8090` and use that port in the address as well.
- Open the port in the server's firewall for the testers' network only.

### Create the workspace

Open the address in a browser and choose **Create account**. The first account owns the workspace. Use
your own e-mail address and a strong password of your own.

### Day to day

In `~/orqiva`:

```
docker compose logs -f server      # what the server is doing
docker compose down                # stop; the data is kept
docker compose up -d               # start again
```

In the `server` folder:

```
node orq.mjs backup                # a checked backup of the database in ~/orqiva/backups
node orq.mjs install --bundle orqiva-server-0.1.0.tar   # install this or a newer bundle again
```

Run a backup before you install a newer bundle.

## 2. Prepare the workspace for the testers (server admin, about 10 minutes)

1. **Invite the team.** Go to **Settings → Members → Invite people**. There is no mail server in the
   test setup, so Orqiva shows an invitation link, which works once, for 7 days. Send each person their
   own link in a private message. They choose their own password when they open it.
   - Choose each person's role: **admin** manages the workspace, **member** works, and **guest** sees
     only the projects they are invited to.
   - The free plan covers 5 people; client contacts do not count. For a bigger test team, ask the
     product owner for a test licence key. As the owner, paste it under **Settings → Plan and billing**
     and choose **Install licence**. No internet connection is needed.
2. **Create a test project.** Go to **Projects → New project**. Give it a key such as `APP`; its tasks
   are then numbered `APP-1`, `APP-2` and so on.
3. **Give project roles.** In the project, go to **Settings → Roles in this project** and choose lead,
   member, tester, designer or viewer for each person. Spread the roles across the team, so that every
   role is tested.
4. **Add a client** (optional). Go to **Clients → New client** and add a contact who signs in to the
   client portal. A tester can play the client with a second e-mail address.
5. **AI agents** (optional). Go to **Settings → AI providers** and either connect a provider with your
   company's key, or add the **demo model** to try the agents without a key.
6. **A project for the feedback.** Create a project with the key `FB` and the name "V1 feedback". Part
   5 explains how the testers use it.

If someone forgets their password, open **Settings → Members** and choose **Reset link** next to the
person. The link works once, for 24 hours.

## 3. Set up a developer machine (every tester, about 10 minutes)

What you need from your admin: the server address, and your invitation link. Open the link first and
choose your password.

### Windows: the setup program

1. Run `ide/Orqiva-IDE-Setup-0.1.0.exe`.
   - The program is not signed yet, so Windows may show "Windows protected your PC". Choose **More
     info → Run anyway**. You can first compare the file's checksum with `SHA256SUMS`.
   - It needs no administrator rights. Everything is installed for your Windows user only.
2. The setup does these steps, in a console window:
   - It checks for **Node.js 22** and offers to install it if it is missing.
   - It puts the **`orq` command** in `%LOCALAPPDATA%\Orqiva\bin` and on your PATH.
   - It installs the **Orqiva extension in VS Code**. If VS Code is missing, it offers to install it.
   - It asks for the **server address and your e-mail**. `orq` then asks for your password itself,
     without showing it. Your password is not stored; the sign-in is kept as a token in `~\.orqiva`.
     Press Enter to skip this step and sign in later.

<!-- [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names -->

3. Open your repository in VS Code. The **Orqiva** tab shows four steps: **This computer → Sign in to
   Orqiva → Your project → Work**.
   - **Sign in to Orqiva** is ticked if you signed in during the setup. If not, click **Sign in** and
     type the server address, your e-mail and your password.
   - **Your project**: click **Use an existing project** and pick the project from the list, for
     example **APP**. **Start a new project** creates a new project on the server instead.
4. The Orqiva sidebar now shows the project's board, and the status bar shows your active task.

The same from a terminal: open a **new** terminal in your repository and run `orq link APP`.

To uninstall, run `%LOCALAPPDATA%\Orqiva\Uninstall-OrqivaIDE.ps1` in PowerShell. Add `-RemoveSignIn` to
delete the saved sign-in as well.

### macOS, Linux, or Windows by hand

The files are in `ide/manual`. You need Node.js 22 and VS Code.

1. Put `orq.mjs` in a folder of your own, for example `~/.orqiva/bin`. Then make it a command:
   - **macOS and Linux:** add `alias orq='node ~/.orqiva/bin/orq.mjs'` to your shell profile.
   - **Windows:** run `ide/manual/setup.cmd`. It does the same as the setup program.
2. Install the extension: `code --install-extension orqiva-0.1.0.vsix`. You can also do this in VS
   Code: **Extensions → … → Install from VSIX**.
3. Sign in and link your repository:

```
orq login --server http://orqiva-test.your-company.lan:8080 --email you@your-company.example
orq link APP
```

### Claude Code (optional)

If you work with Claude Code, run `orq hooks install` once in each linked repository. Claude Code then
follows the task loop: it starts a task before it edits code, it marks every change with the task's
fingerprint, and `orq done` reports the work to the task.

### The task loop from the terminal

```
orq list                  # open tasks, active sprint first
orq start APP-12          # In Progress, assigned to you, active in this folder
orq done APP-12           # check the fingerprints, commit, report to the task
orq inbox                 # what waits for you
orq time start | orq time stop
```

Every command is in `docs/cli.html`.

### Browser bug capture (recommended for testers)

With this extension, a bug is filed from the page where it happened. The bug includes a screenshot, the
last console messages and network requests, and the clicks before it. It never records what you type.

- **Chrome or Edge:** open `chrome://extensions` (or `edge://extensions`) and switch on developer mode.
  Choose **Load unpacked** and pick `browser-bug-capture/chrome`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and pick
  `browser-bug-capture/firefox/manifest.json`.
- In the extension's options, enter the server address and a personal token. You create the token in
  Orqiva under **Settings → Personal tokens**. The token stays in the browser and is not shared.

## 4. What to test

Work in Orqiva on real work for the test period, not only on tasks. These are the areas to cover, by
role.

| Role               | Try at least this                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Owner and admin    | invite and remove people, roles, settings, AI providers, the command center, the audit log, a backup                   |
| Lead               | the backlog, plan and start a sprint, the board with WIP limits, filters, reports, releases                            |
| Developer (member) | the task loop in VS Code and with `orq`, comments, time tracking, repositories, an agent run with approval             |
| Tester             | write test cases, plan and run a test run, file a bug from a failed step, the browser bug capture                      |
| Designer           | the canvas and mockups, sharing a design with the client for approval                                                  |
| Client (portal)    | sign-in, releases and sign-off, requests and votes, approvals                                                          |
| Viewer or guest    | that they see only what they should, and can change nothing                                                            |
| Everyone           | the phone layout (open the address on your phone), dark mode, the language in **Profile**, keyboard only (Tab, Ctrl+K) |

## 5. How to give feedback

All feedback goes into Orqiva itself, in the `FB` project. Reporting there is part of the test.

- **A bug:** file a task with the type **bug** in `FB`. Write down the steps, what you expected and what
  happened. Use the browser bug capture where you can; it adds the screenshot and console messages for
  you.
- **An idea or a missing feature:** add it on the `FB` project's **Ideas** page.
- **Something confusing:** file it as a task with the label `ux`. Name the screen and what you expected
  to find.
- **A security issue:** do not file it in the workspace. Tell the product owner directly.

Please add the browser and operating system to every bug, if the bug capture did not add them already.

## 6. Known limits of this test build

- **No e-mail.** Invitations and password resets are links that the admin sends. A mail server can be
  added later; see `docs/install.html`, the section on e-mail.
- **Word search** over tasks, documents and messages is not tuned yet for very large workspaces. This
  does not matter at test sizes.
- **Single sign-on** (SAML, OpenID Connect) and SCIM need an Enterprise licence and a real identity
  provider, and are not part of this test.
- **The setup program is not code-signed** yet, so Windows warns about it on the first run.
- **The VS Code extension and the bug capture** are installed from the files in this folder. They are
  not in the marketplaces yet.

## Safety notes

- The folder contains no passwords, tokens, keys or accounts. It can be shared inside the team.
- Every person chooses their own password. Do not send passwords in chat or e-mail; the invitation link
  lets each person choose their own.
- `~/orqiva/.env` on the server holds the install's secrets. Back it up together with the data, and do not
  share it.
- Use test data or ordinary internal work. Do not put customer secrets or production credentials into
  the test workspace.
