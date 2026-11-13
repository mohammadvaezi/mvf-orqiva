<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- ── [PCODE-68 | S14 | v0.1.0] Write the user documentation: install, setup, daily loop, release and deploy ── -->

# Releasing, packaging and deploying

Three panels, in the order a release happens: decide the version, build the image, put it somewhere.
All three are in the Docs view, and every one of them posts what it did back to the Plane item for that
version, so the board says what is running where.

- [Version](#version)
- [Docker](#docker)
- [Deploy](#deploy)
- [What gets written where](#what-gets-written-where)

## Version

**Orqiva: Version and release** opens the panel. It shows the version large, the last git tag, the
commits since it, and three bump buttons.

Before it lets you bump, it checks three things and says which one is in the way:

- **Uncommitted changes** — "Commit or stash N changed files before bumping." A release that includes
  work not in a commit cannot be reproduced.
- **The three sources disagree** — `.plane/project.json`, `package.json` and the last tag must say the
  same thing. If they do not, the panel names which one is different rather than picking one.
- **Plane is unreachable** — the changelog is built from the items finished since the last tag, so
  without Plane there is no changelog and the buttons stay disabled.

The preview lists those items grouped as Features, Fixes, Tests, Chores and Changes, plus any commits
that carry no task reference.

**Orqiva: Bump the version** (or a button) confirms in a modal that names exactly what will happen,
then in one step writes the CHANGELOG section, updates `package.json` and `.plane/project.json`,
commits, and tags. Afterwards the status bar and every new fingerprint carry the new version, and a
**Release v0.1.1** item appears in Plane holding the changelog and an unticked "deployed to a target".

A second bump to a version that already has a Release item reuses it instead of creating a twin.

## Docker

**Orqiva: Docker** opens the panel. With Docker Desktop stopped it says so and disables everything
rather than failing later.

**No Dockerfile yet?** **Orqiva: Generate Dockerfile and compose with Claude** creates a Plane task,
starts it, and opens Claude Code with a prompt to write both files from `architecture.md`. When Claude
finishes, the files carry that task's fingerprint like any other code, and the panel lights up.

- **Build** streams the output into the panel and into the "Orqiva Docker" channel, ending with
  `Built <name>:<version>`. Close the panel mid-build and reopen it: the build is still running and its
  output is back.
- **Run** does `compose up` and lists the services with their health as it settles.
- **Logs** streams the container output live; **Stop logs** ends it.
- **Stop** does `compose down`.
- **Check now** polls `orqiva.docker.healthUrl` (or `healthUrl` in `.plane/deploy.json`) and reports
  the status and how long it took.

## Deploy

**Orqiva: Deploy** opens the panel: the version with any warnings, the targets, and the history of
attempts for this version.

### Targets

Targets live in `.plane/deploy.json`, which is committed — **without any token**. Two kinds:

**Coolify** needs the address, the application uuid and an API token. The token goes to SecretStorage
the moment you save; the row then reads "token stored" and the field is empty again. It is never in
`deploy.json`, never in a log, and never in the panel after that.

**SSH** needs host, user and the folder holding `docker-compose.yml` on that machine. Authentication is
your SSH agent or `~/.ssh/config` — Orqiva never handles a private key or a password. The remote
path is quoted, so a folder with a space works.

### Deploying

**Deploy** names the version and the target in a modal before anything happens. Cancelling is itself
recorded on the Release item, because "we decided not to" is worth knowing later.

On confirm the adapter's own output fills the log — Coolify's queued → in progress → finished, or the
ssh session — ending with `Deployed v0.1.1 to prod in 1m 43s`.

Failures are shown as themselves: a rejected Coolify token says the token was rejected and which target
it belongs to; an SSH host that does not know your key says so and tells you to add it to the agent.
Every attempt, failures included, is appended to the Release item in Plane.

### Prerequisites

|             |                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Coolify** | An application already created in Coolify, its uuid, and an API token with permission to deploy it                       |
| **SSH**     | Key-based access from this machine, a folder on the host with `docker-compose.yml`, and `docker compose` installed there |

Neither adapter creates infrastructure. They deploy what already exists.

## What gets written where

|                                       |                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `CHANGELOG.md`                        | The section for the new version, from the items done since the last tag                  |
| `package.json`, `.plane/project.json` | The new version number                                                                   |
| git                                   | One commit holding those, and a tag `v<version>`                                         |
| Plane                                 | A **Release v\<version\>** item with the changelog, and a comment per deployment attempt |
| `.plane/deploy.json`                  | The targets — never their tokens                                                         |
| SecretStorage                         | The tokens                                                                               |
