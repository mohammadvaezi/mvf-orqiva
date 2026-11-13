<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- ── [PCODE-91 | S15 | v0.1.0] Package the server as a Docker Compose install started by `orq install` ── -->

# Installing the Orqiva server

One command takes a machine with Docker to a running Orqiva: PostgreSQL 17 and the Orqiva server
(API and web app) in Docker Compose, with database passwords generated for this install.

## What the machine needs

- Linux (Ubuntu 22.04 or 24.04 tested in CI), or Windows/macOS with Docker Desktop
- Docker Engine 24 or newer with the Compose v2 plugin (`docker compose version` answers)
- Node.js 22 for the `orq` command
- 2 CPU cores, 2 GB RAM, 10 GB disk for a small team

## Install

Until the image is published to a registry, `orq install` builds it from a copy of this repository:

```
npm ci
npm run build --workspace packages/shared --workspace packages/cli
node packages/cli/dist/main.js install --build . --public-url https://orqiva.example.com
```

| Option         | Default                    | Meaning                                                     |
| -------------- | -------------------------- | ----------------------------------------------------------- |
| `--dir`        | `~/orqiva`                 | where the install lives: `compose.yaml`, `.env`, `initdb/`  |
| `--port`       | `8080`                     | the port on this machine                                    |
| `--public-url` | `http://<hostname>:<port>` | the address people open; `https://` turns on secure cookies |
| `--image`      | `orqiva/server:0.1.0`      | the server image                                            |
| `--build`      | (none)                     | build the image from this repository folder first           |

The command checks Docker, writes the install folder, starts both containers, waits until the server's
health check answers (the database schema is created on first start) and prints the address. Open it and
create the first account; that account owns the first workspace.

## Upgrade and change settings

Run the same command again. The `.env` file keeps the database passwords of the first install, so the data
stays; flags you pass replace the port, public address or image. The server moves the database schema
forward on start.

## What is where

- `.env`: settings and the two database passwords. Readable by its owner only; back it up with the data.
- `compose.yaml`: the two services. No secrets.
- `initdb/01-orqiva.sh`: runs once, on a new database volume. It creates the role `orqiva`, which
  owns the database but is not a superuser, so the row-level security that keeps workspaces apart applies to
  the server too. The server refuses to start as a superuser.
- The database lives in the Docker volume `orqiva_db-data`.

## HTTPS

Put Orqiva behind the reverse proxy you already run (Caddy, nginx, Traefik, a load balancer) and pass
the `https://` address as `--public-url`. The server itself speaks plain HTTP on the port you chose.

## Logs and stopping

```
cd ~/orqiva
docker compose logs -f server
docker compose down          # stop; data is kept
```

## Moving a project over from Plane, Jira or Linear

<!-- [PCODE-221 | S15 | v0.1.0] one place for the import steps: the migration guides -->

`orq import plane`, `orq import jira` and `orq import linear` bring a project over with its numbers
(`APP-12` stays `APP-12`), and running them again updates instead of duplicating. The steps, what comes
over and what does not are in the guides: [Moving to Orqiva](migrate/overview.md), with one page each for
[Jira](migrate/jira.md), [Linear](migrate/linear.md) and [Plane](migrate/plane.md).

## Connecting GitHub or Gitea

A project's **Repositories** tab (workspace admins) connects a repository. Orqiva then shows on each
task the commits and pull requests that name it: `PCODE-12` in a commit message, a pull request's title
or its branch (`pcode-12-reprice`). They appear on the item page, the board's feeds and in VS Code as
the Git host reports them.

1. Open the project, **Repositories**, choose GitHub or Gitea, enter `owner/name` and connect.
2. The page shows the webhook settings once: the payload URL, the content type `application/json`, a
   secret, and the events to send (pushes and pull requests). Enter them in the repository's webhook
   settings on the Git host.
3. The host's test delivery ("ping") should succeed; the Repositories tab then shows the last delivery.

The Git host must be able to reach the server's public address (`ORQIVA_PUBLIC_URL`). Every delivery
is checked against the secret (HMAC-SHA256), so one that was not signed with it is refused. Orqiva
never calls the Git host and needs no token for it. Disconnecting a repository refuses its deliveries
from then on; if the secret is lost, disconnect and connect again.

## Connecting an MCP client (Claude Code and others)

<!-- [PCODE-121 | S15 | v0.1.0] Add our own MCP server over HTTP with the agent tools -->

Each workspace has its own MCP endpoint at `<server>/mcp/<workspace id>` (JSON-RPC over HTTP). It signs in
with a personal API token only (Settings → API tokens), never with a browser cookie, and acts as the token's
person with their role: a guest sees only their projects and cannot change anything.

```
claude mcp add --transport http orqiva http://localhost:8480/mcp/<workspace id> \
  --header "Authorization: Bearer <your token>"
```

The tools are `list_projects`, `list_items`, `get_item`, `add_comment`, `create_item`, `update_item` and
`move_item`. Finishing or cancelling a task is not offered; that stays with people in the app.

<!-- [PCODE-310 | S15 | v0.1.0] T31.9a MCP tools for the code map and pull requests -->

For members (not guests) there are also tools for the code and the reviews:

- `code_map`: the scanned code by folder, with size, complexity, recent commits, its main authors and the
  share agents wrote. Name a folder to look inside it.
- `code_dependencies`: what a file or folder imports from the repository and which files import it. It
  needs a scan from a current `orq docs scan`.
- `list_pull_requests` and `get_pull_request`: the pull requests with their review and checks state, and
  one with its changed files, a file's patch with line numbers and the comments you may see.
- `comment_on_pull_request`: a draft comment on a changed line, as you. It is not posted to GitHub or
  another host until you submit your review in Orqiva.

## Notifications on phones and desktops

<!-- [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push -->

Orqiva installs as an app from the browser (Chrome and Edge: the install icon in the address bar;
Android: Add to home screen; iPhone and iPad: Share, then Add to Home Screen). Each person turns on
notifications for a device under **Settings → Notifications** and chooses which of these they want: an
agent waiting for their approval, a gate ready for them to sign, a failed deploy (the person who started
it and the admins), and a mention in a comment (`@ada` names whoever's address starts with `ada@`).

What the server needs:

- `ORQIVA_SECRET_KEY` set. The server makes its own Web Push key pair on first use and keeps it sealed
  with that key.
- HTTPS (`ORQIVA_PUBLIC_URL=https://…`). Browsers allow the service worker and push only on HTTPS or
  on localhost.
- Outgoing HTTPS to the browsers' push services: `fcm.googleapis.com` (Chrome, Edge on Android),
  `updates.push.services.mozilla.com` (Firefox), `*.push.apple.com` (Safari) and `*.notify.windows.com`
  (Edge on Windows). The server sends to no other address. Add more hosts with `ORQIVA_PUSH_HOSTS`,
  separated by commas.
- `ORQIVA_PUSH_CONTACT`: a `mailto:` or `https:` address the push services can contact you at. By
  default, the public address.

The messages are encrypted for each device (RFC 8291), so the push services only carry them and cannot
read them.

## Email

<!-- [PCODE-238 | S15 | v0.1.0] T23.5 Communication exit check, docs and sprint close -->

Orqiva sends its own mail through a mail server you name: password resets, invitations, notices by
email for those who choose them, the daily digest at 07:00 in each person's time zone, a notice a week
before an access token runs out, and status updates to clients. Without a mail server, all of this
still works with links that an admin hands over. Nothing is mailed.

Add the mail server to `.env` in the install folder, then run `orq install` again (it keeps these
settings on every later run):

```
ORQIVA_SMTP_HOST=mail.example.com
ORQIVA_SMTP_PORT=587                 # 587 by default, 465 with tls
ORQIVA_SMTP_SECURITY=starttls        # starttls (default), tls, or none for a server on your own network
ORQIVA_SMTP_USER=orqiva@example.com  # when the mail server wants a sign-in
ORQIVA_SMTP_PASSWORD=…               # or ORQIVA_SMTP_PASSWORD_FILE=/run/secrets/smtp
ORQIVA_MAIL_FROM=Orqiva <orqiva@example.com>
```

Set `ORQIVA_PUBLIC_URL` as well, so links in the mails point to your server.

Then check the setup under **Settings → Notifications → Mail**: it shows the mail server, sends you a
test mail, and lists the last mails of the workspace with the reason when one failed. A mail the server
turns away for now is tried again after 1, 5, 30, 120 and 360 minutes. A mail it refuses for good is
marked failed at once.

### Forgotten passwords

On the sign-in page, **Forgot your password?** sends a link to the address. The link works once, for an
hour. The page never says whether an account exists for an address. A new password signs the account out
everywhere.

Without a mail server, an admin opens **Settings → Members** and chooses **Reset link** next to the person.
The link works once, for 24 hours, and the admin hands it over in person. An admin can do this only for
an account whose every workspace they administer, so nobody takes over an account that also belongs to
another workspace.
