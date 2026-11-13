<!-- [PCODE-364 | S15 | v0.1.0] T35.8 T35 exit check, docs and sprint close -->

# Working across Orqiva

These features are not tied to one screen: finding things fast, your own home, connections to other tools,
templates, settings and policies, the health of your server, language and accessibility, and what each plan
holds.

## Finding things and keys

Press **Ctrl K** (**⌘ K** on a Mac) anywhere. Type a few letters to find tasks, projects, documents,
agents, agent runs, people and settings. Guests and client people see only what they may open.

Keys move you without the mouse: **g** then a letter goes to a place (**g h** home, **g i** inbox, **g p**
projects, **g a** agents, **g s** settings). **?** shows every key.

## Your home

**Start** fits the person: a lead sees open incidents, reviews and deploys; a developer their tasks, today's
time and failing builds; a tester their test runs and failing tests. **Choose widgets** changes what your
own home shows. Your choice stays yours; **Back to the preset** returns to the home for your role.

## Integrations

**Settings › Integrations** shows what the workspace is connected to and what each connection last did.

- **Slack and Teams** are optional. A bridge posts the topics you choose (incidents, releases, a channel's
  messages) to one Slack or Teams channel. Work stays in Orqiva's own channels; nothing requires Slack.
- **Email in** turns replies to Orqiva's mails into messages, and mail to a project's idea address into an
  idea. Point your mail provider's inbound webhook (Postmark JSON) at the address shown once.
- **Your calendar**: **Settings › Profile › Your calendar** gives you a private link with your due dates
  and absences. Make a new link to stop the old one.
- **CI**: pipelines report their runs to `POST /api/workspaces/{id}/projects/{id}/ci-runs`. Task keys in the
  branch name link the run to its tasks, and a failed run can start the CI failure agent.
- **Sentry and Alertmanager** open incidents (see Clients, incidents and time).

## Templates

**Settings › Templates library** holds templates for projects, sprints, agents and PRDs, built in or kept
from your own work. **Use** starts a project with its states, labels and epics, a sprint on a date with
its tasks, or an agent (switched off until you check it). Admins keep a project as a new template.

## Settings, teams and leads

A setting can be set for the workspace, a team, a project or a person. The screen shows where each value
comes from. A team's lead sets the team's values; a **project lead** runs their project as its admin
(members, guests, settings) without being a workspace admin. AI budgets warn at 50, 80 and 100 %.

## Policies

**Settings › Policies** holds rules for the whole workspace: tasks need acceptance criteria before they go
into a sprint, agents never merge, a cap on tokens per agent run, and personal data masked before it
reaches the AI provider. **Dry run** shows what a rule would catch today, before you switch it on.

## System health

**Settings › System** (owner only) shows the version, the database, queues that are stuck, the last
backups, and what needs attention. Wizards walk through a backup, a restore and an upgrade with the
commands to run on the server.

## Offline

Comments, messages and time typed without a connection wait on the device and go out when it is back.
Pages you opened recently still show. Signing out clears what was kept.

## Activity

**Activity** suggests field names and values as you type a query, shows the columns you choose, groups by
any column, zooms into a time range when you drag across the chart, and shows a heat map of the week by
day and hour.

## Language

Orqiva speaks English and German. It follows a person's own language, then the workspace's (an admin sets
it with the **Language** setting under **Settings › General**), then the client's, then the browser. Texts
the server writes (some error messages) are still in English.

## Accessibility

The web app follows WCAG 2.2 AA: every control has a name and a visible focus mark, targets are at least
24 × 24 px, text keeps a contrast of 4.5 : 1 in light and dark, and dialogs keep the keyboard inside until
**Escape** closes them.

## Plans

| Plan       | What it holds                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Free       | Up to 5 people, everything but the Enterprise features                                                                          |
| Team       | Up to 5 active projects, standard agents, sprints, boards, CI test runs and security findings                                   |
| Business   | Any number of projects, the command center, your own agents, lifecycles and gates, test management, compliance packs, audit log |
| Enterprise | Business, plus SAML single sign-on, SCIM provisioning and audit export                                                          |

**Settings › Plan and billing** lists what your plan holds. Something your plan does not hold says which
plan has it. Archiving a project makes room on Team.

## Single sign-on

SAML assertions can be encrypted: each workspace publishes its own encryption certificate in its metadata.
With a **logout URL** set, signing out of Orqiva signs you out at the identity provider too, and a logout
there ends your Orqiva sessions.

## Moving from Jira or Linear

`orq import jira` and `orq import linear` bring assignees (matched to members by email or name) and, from
Jira, comments. See [Moving from Jira](migrate/jira.md) and [Moving from Linear](migrate/linear.md).
