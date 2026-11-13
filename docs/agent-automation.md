<!-- [PCODE-251 | S15 | v0.1.0] T25.6 T25 exit check, docs and sprint close -->

# Agents that start by themselves

An agent can start work without anyone pressing **Start a run**. Its triggers say when. Its scope says
which files, branches and hosts it may touch. Its traces keep no secrets.

## Triggers

Under **Agents → Settings**, an admin adds triggers to an agent:

| Trigger                    | Starts the agent when                                                   | Value                                |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------ |
| Task assigned to the agent | a task's **Agent** is set to it (on the task, or when the task is made) | none                                 |
| Label on a task            | the label is put on a task                                              | the label's name                     |
| Mention in a comment       | a comment names it as a word of its own, e.g. `/coder`                  | the mention                          |
| CI fails                   | a test run or a deploy of a project fails                               | none                                 |
| Schedule                   | the minute comes, in the workspace's time zone                          | five cron fields, e.g. `0 7 * * 1-5` |
| Webhook                    | an outside system calls the agent's webhook address                     | none                                 |

A schedule and a webhook work in a project: name its key. Either may carry its own ask, e.g. "Look at
new ideas and requests". The other triggers bring the task or the failed run with them.

Each run says what started it ("started by assigned HEL-12"). The agent's settings show when each
trigger last started a run.

**Limits:**

- One cause starts an agent once: the same event, scheduled minute or webhook delivery never starts it
  twice.
- An agent never starts itself.
- An agent starts at most 30 triggered runs an hour, so two agents that mention each other cannot run
  away.
- The agent's switch, **Pause all agents**, its concurrency and its budgets apply as to every run.
- A run that nobody asked for acts as the agent's accountable person, or else the workspace owner.

## The webhook

Under the triggers, **Make the webhook address** gives the agent an address and a secret. The secret is
shown once; the screen keeps only its last four characters. **New secret** replaces both address and
secret, and the old ones stop working.

The caller sends a `POST` to `https://<your Orqiva>/hooks/agents/<id>`. It proves itself in one of two
ways:

- the header `X-Orqiva-Signature: sha256=<HMAC-SHA256 of the body with the secret>`; GitHub's
  `X-Hub-Signature-256` is accepted too;
- the header `Authorization: Bearer <secret>`.

The body, up to 10 MB, goes to the agent as what was sent. JSON with `"project": "KEY"` names the
project when the trigger names none. A delivery id (`X-Orqiva-Delivery`, `X-GitHub-Delivery` or
`X-Request-Id`) makes a retried delivery start the agent only once.

The answers: `202` with the run's id; `200` when this delivery already started a run or the hourly
limit is reached; `401` for a wrong signature; `404` for an unknown address; `409` when the agent is
switched off.

## Scope

Files, branches and network are lists on the agent:

| Scope    | Matches                                                               | Without a list     |
| -------- | --------------------------------------------------------------------- | ------------------ |
| Files    | repository paths: `src/**`, `docs/*.md`, or a folder such as `test`   | not limited        |
| Branches | branch names: `agent/*` (one level), `main`                           | not limited        |
| Network  | hosts: `api.github.com`, `*.example.com` (its subdomains, not itself) | **no host at all** |

**Files and branches.** When a task is assigned to an agent, `orq start` brings the agent's scope with
the task. The Claude Code hooks then refuse:

- an edit of a file outside the files scope;
- `git commit`, `merge` or `rebase` on a branch outside the branches scope;
- `git checkout -b`, `switch -c` or `branch` creating such a branch;
- `git push` to one.

The hooks need Bash in their `PreToolUse` matcher; `orq install` writes it. Other clients ask the server:
`GET /api/workspaces/<id>/agents/<agent>/scope-check?file=…&branch=…&host=…` answers each with
_allowed_ and the reason.

**Network.** The **fetch_url** tool reads a web page or an API answer. Switch it on with **May read web
pages** under the scope. It reads only:

- https addresses on hosts in the network scope;
- public addresses, never the server's own network;
- text, at most 1 MB read and 20 000 characters kept.

Every redirect is checked again. A refused address is a step in the trace that says why.

## Traces keep no secrets

Before a step of a run is stored, every text in it is cleaned. These are replaced by `[redacted <kind>]`:

- keys of Orqiva, Anthropic, OpenAI, xAI, Google, AWS, GitHub, GitLab, Slack and Stripe, and webhook
  secrets;
- private key blocks;
- passwords in URLs, bearer tokens, and values named password, secret, API key or access token.

The step says which kinds were removed. An Orqiva token found in a trace is also revoked at once and
listed under **Tokens and costs → Policies and leaks**.
