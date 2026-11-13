<!-- [PCODE-345 | S15 | v0.1.0] T34.4 T34 exit check, docs and sprint close -->

# Clients, incidents and time

Three parts of Orqiva face the people you work for: **Clients** with the client portal, **Incidents**
with status pages, and **Time** with reports and billing.

## Clients and the portal

Each client has a page for the team: health, revenue, recent activity and the people working for it.
**Clients › Overview** puts every client on one line, so you can see which one needs attention.

The client's own people sign in to the **portal**:

- **Home** shows the client's health, the next milestone, the latest release and how much of the budget
  is used.
- **Releases** list what each release delivers, with links and demo recordings. The client signs off a
  release there, and acceptance results can carry files.
- **Requests**: the client's people vote on requests. The team merges duplicates; the votes move to the
  request that stays. A short NPS survey asks how likely they are to recommend you.
- **Meetings**: notes and their actions. An action becomes a task in the project with one click.

**The feedback widget** goes into the client's own product with one script tag. What a user sends with
it arrives as a request in the portal.

**Signing in**: client people can sign in with an emailed link instead of a password. An invitation
works the same way and needs no password. When **Require two-factor sign-in** is set for a client, its
people must set up a second factor before they see anything.

## Incidents

An incident opens from an alert, by hand, or by itself:

- A **status probe** that fails several times in a row raises an alert. So does a **deploy that fails**.
- **Alert sources** take alerts from Sentry and Prometheus Alertmanager through a signed webhook.
  **Incidents › Alert sources** shows the address and, once, the secret, with the lines to paste into
  Alertmanager's configuration or into Sentry.

Critical and error alerts open an incident or join the open one of the same project. Other alerts are
kept, and a resolved alert clears its own.

### Runbooks

A runbook says what to do when a known problem comes back: a title, the steps in Markdown, and
**trigger words** separated by commas (`disk full, no space left`). It can belong to one project or to
all of them. Admins keep runbooks under **Incidents › Runbooks**.

When an incident's title or one of its alerts contains a trigger word, the incident shows the runbook
above its timeline. The timeline notes it once when the alert opens or joins the incident.

### Updates and status pages

**Updates** start from a template. Four are built in (Investigating, Identified, Monitoring, Resolved),
and admins can replace them or add their own. A template's placeholders are filled from the incident:
`{{product}}`, `{{title}}`, `{{severity}}`, `{{state}}` and `{{next}}` (the time of the next update).

**Status pages**: the portal always shows the client's status page. On the client's page, an admin can
also open it to everyone at `/status/<short name>`, without an account. The public page shows the
components by environment, their uptime over 30 days, and the incidents told to the client. Postmortems
stay private. `?environment=<key>` shows one environment.

### Postmortems

After an incident is resolved, **Incidents › Postmortems** writes it up. You have two ways to start:

- **Draft from the timeline** lays out what happened and the timeline; you write the why.
- **Draft with the DevOps agent** sends the incident, its timeline and the updates sent to the DevOps
  agent. It answers with What happened, Timeline, Why, Impact and Actions, using only those facts. Its
  actions become the postmortem's actions.

The agent needs the incident to belong to a project, and it counts against the agent's budget like any
other run. Actions turn into tasks with one click. A postmortem can be shared with the client.

## Time

**My time** is the week: a timer on the task you work on, hours per task and day, and the week sent for
approval.

- **Away from the timer**: if no key or mouse moves for ten minutes while a timer runs, Orqiva asks when
  you come back. **Take it off the timer** subtracts that time; **Keep it** leaves it.
- **Reminders**: after 17:00 on a workday with nothing booked, you get an inbox reminder. On Friday from
  15:00, a week with hours that is not submitted gets one too. Each comes once, in your time zone, and
  never on an approved day off. Only people who booked time in the last 30 days get them.
- **Corrections**: a submitted or approved week is locked. **Correct with a reason** opens it for a
  change. The correction is kept with the hours before and after and the reason, and the week lists it.
  Your approver is told, and an approved week goes back for approval.

**Reports and billing** shows a month per client: hours, billable share, people and AI cost against
the budget, with a CSV.

**Breakdown** sums any range of days by person, sprint, task, project or client, with hours, billable
hours and the amount at the billable rates. It has a CSV too.

**DATEV export** (admins and billing, under Breakdown) writes the billable amounts of the range as a DATEV
_Buchungsstapel_ (EXTF format 700, category 21) for DATEV Rechnungswesen. It makes one booking per client
and project, to the revenue account you enter (8400 unless you change it), with the consultant and client
numbers of your tax adviser. Each client's debtor account is set under **Debtor accounts of the
clients**; a client without one is booked to 10000.

**Hour budgets** give a project or a client so many hours per month or in total, with a warning level
(80 % unless you change it). Admins get an inbox alert when booked time crosses the warning level and
again when the hours are used up, once per period. Changing a budget resets its alerts.
