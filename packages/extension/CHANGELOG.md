<!-- [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names -->
<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- ── [PCODE-70 | S14 | v0.1.0] Add the extension icon, marketplace metadata, licence and CHANGELOG for 0.1.0 ── -->

# Changelog

Every release, written from the Orqiva tasks that were done for it.

## About 0.1.0

The first release: the whole loop, end to end, on your Orqiva server.

- **Getting started.** The Orqiva tab walks through four steps: this computer, sign in to Orqiva, your
  project, work. You sign in once, with the same sign-in as `orq login`. _Use an existing project_ lists
  the projects on your server; _Start a new project_ creates one there and links the folder.
- **The board and the task loop.** The sidebar shows the board of the folder you have open, and the
  status bar shows the task you are on. Starting a task moves it on the server. Finishing one is refused
  unless the code you wrote carries the task's fingerprint; then it commits, comments and moves the task
  to Review in one step.
- **Fingerprints.** Every fingerprint in the code carries a lens back to its task, and the whole set of
  them generates the code documentation.
- **Around the loop.** The planning run that turns a written description into architecture, rules and
  one-day sprints; version bumps with a changelog built from the tasks actually finished; Docker
  packaging; deployment over Coolify or SSH, with every attempt posted to the board; a security
  checklist kept in the repository, with npm audit, pip-audit and a secret scan; and a dashboard across
  every project in the workspace.
- **Credentials.** Nothing is stored outside the editor's own secret storage and the `orq` sign-in.
- **Older folders.** Folders set up before Orqiva (the legacy tracker and the Python engine) keep
  working as before.

## v0.1.0 (2026-10-22)

### Features

- PCODE-453 Getting started on the Orqiva server: sign in, link a folder to a server project, or
  start a new project there
- PCODE-192 One name everywhere: Orqiva, with existing installs kept working
- PCODE-70 The extension icon, marketplace details, licence and this changelog
