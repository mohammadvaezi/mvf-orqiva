<!-- [PCODE-218 | S15 | v0.1.0] T20.1 Public docs site built from the repository (own Markdown renderer, CLI and API reference, link check) -->

# Orqiva

Orqiva is a self-hosted engineering command center. It covers the whole road from an idea to a release in
one place: the plan, the work, the tests, the security findings, the evidence and the release. People and
AI agents work there side by side.

You run it on your own machines: one Docker host, a Kubernetes cluster, or a site without internet. Your
code and your data never leave them.

## What it covers

- **Ideas to plans.** Ideas, interviews and proposals become epics and tasks with acceptance criteria.
- **Sprints and boards.** Items, sprints, time tracking and capacity, with live updates for everyone.
- **AI agents with approvals.** Agents work on tasks with your own model key. A person approves each step
  that matters, and every step is recorded.
- **Tests and quality.** Test runs stream in from CI (TAP or JUnit). Each result is traced to its task and
  requirement.
- **Security.** A repository scan for secrets and risky code, dependency findings, and a posture page.
- **Compliance.** Evidence is collected as work happens, not typed in later.
- **Releases.** Release trains across projects, promotions with approval, rollback and changelogs.
- **Command center.** The portfolio's health, risks and alerts, live, with a 24-hour replay.
- **Clients.** A client portal, handover packs and docs built from the code.

## Where to start

- [Getting started](../getting-started.md): from a machine with Docker to your first sprint in about an
  hour.
- [Install with Docker](../install-server.md), [Kubernetes](../install-kubernetes.md), or
  [without internet](../offline-and-backups.md).
- The [command line](cli.html) and the [REST API](api.html).
- [Security](security.md): how your data is protected.

## Made to be owned

Orqiva is our own code, on Node.js and PostgreSQL. The server has a single third-party runtime library,
the PostgreSQL driver. No third-party licence terms stand between you and running it; see
[licences and ownership](../policy/licences.md).
