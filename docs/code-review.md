<!-- [PCODE-312 | S15 | v0.1.0] T31.10 T31 exit check, docs and sprint close -->

# Code review and versions

Orqiva reads a project's repositories and keeps what happens there next to the tasks: commits, branches and tags,
pull requests and their review, merges, the versions they add up to and the code they leave behind. Review,
merge and release happen in the project's **Versions** tab and on the **Code map**; the same review works in VS
Code, and agents reach the code and the pull requests through MCP.

## Repositories

An admin connects a repository on the project's **Repositories** page: GitHub, Gitea, GitLab or Azure Repos. Orqiva
shows a webhook address and a secret to enter at the host; from then on the host reports pushes, tags and pull
requests, and each delivery is checked against the secret. For the history from before the webhook, and to read a
pull request's files, post a review or merge, the connection needs an **API token** of the host. It is kept
sealed and never shown again.

Each commit is kept with its files. Branches and tags show on the Repositories page as they move. A commit or pull
request that names a task (`SHOP-12`) is linked to it. Closing words merged into the default branch, such as
`Closes SHOP-12` or `Fixes SHOP-12`, finish the task. A revert is recognised, and the task it served is marked.

## The review queue

**Versions → Review** lists the open pull requests, the riskiest first. Risk comes from size, failing checks, a
missing task, sensitive paths (migrations, authentication, payments, infrastructure), conflicts and how long the
pull request has waited. Each row says why it ranks where it does and how many of its files you have viewed.

Opening one shows its changed files side by side, old and new. Lines carry the fingerprints the code got, so a
change without its task's fingerprint is visible at once. Mark a file **viewed**. If its patch changes, the mark
lapses.

## Comments and the review

Click a line number to comment on it. Comments are your **drafts** until you submit the review: **Approve**,
**Request changes** or **Comment**. Orqiva posts the review with your drafts to the host as the connection's token,
with your name in each text. A draft on a file that changed since you wrote it is **outdated**. It stays with you
and is not posted to a line that may have moved.

**Ask the AI for comments** has the Reviewer agent read the changed lines and suggest comments, each with a note,
a warning or a risk. Accept a suggestion to make it your draft (and edit it), or dismiss it.

## Merge policy and the merge queue

An admin sets the project's **merge policy**. It can require a linked task, fingerprints in every code file, an
approval, passing checks, an extra approval for sensitive paths, or no conflicts. Each pull request shows the
rules met or not, in words, and **Check again** asks the host about conflicts. With **Post the verdict to the host** on, Orqiva sends the verdict to the host as the commit
status `orqiva/policy`, so the host's branch protection can enforce it.

Stacked pull requests (one based on another's branch) are shown as a stack. The one below merges first.

**Add to merge queue** puts a pull request in line for its branch. **Merge next** asks the host whether the first in
line still merges cleanly. If it does and the policy passes, Orqiva merges it, pinned to the commit that was
checked, by merge, squash or rebase. A pull request that cannot merge leaves the line with the reason; one still
waiting for a check keeps its place.

## Versions from commits

**Versions → Versions and releases** plans the next version from the commits since the last tag. It reads
conventional commits: `feat` raises the minor version, `fix` the patch version, and a breaking change the major
version. It also writes the changelog. A monorepo can version **components** per folder, each with its own tag
prefix. **Plan 1.3.0** (the version it worked out) creates the release with that version and changelog.

## Environment config

**Versions → Environments** compares two environments key by key: variables, secrets, settings, feature flags
and the version deployed. Secrets are compared without their values, which are never sent to the browser. Keys
that are **meant to differ** (a database address, a log level) can be marked so, so the comparison shows
only real drift.

## The code map

`orq docs scan` in the repository sends the code scan: each file's size, complexity, recent commits, authors and
its imports within the repository. Imports by a monorepo's own package names count too. The **Code map** shows:

- **Map**: folders by size and activity.
- **By work**: the code by feature, sprint or version, from the fingerprints.
- **Over time**: the folders week by week, with the sprint that ran.
- **Architecture**: the folders and their imports as a graph, with import cycles named. Below it, files that
  keep changing together, the ones in different folders first.
- **Knowledge**: for each folder, the fewest people who wrote more than half of it. AI agents are not counted.

## In VS Code

**Orqiva: Review pull requests** opens the same queue in the editor. A file opens as a diff of its changed parts,
and comments sit on its lines through VS Code's comment threads: write drafts, accept or dismiss the agent's
suggestions, and submit the review from the editor's title bar. See the extension's guide.

## For agents (MCP)

The workspace's MCP endpoint (see [install-server.md](install-server.md)) gives members these tools:

- `code_map`: the scanned code by folder.
- `code_dependencies`: what a file or folder imports and what imports it.
- `list_pull_requests` and `get_pull_request`: the pull requests, and one with its files, a numbered patch and the
  comments you may see.
- `comment_on_pull_request`: leaves a draft. Nothing reaches the host until a person submits the review.
