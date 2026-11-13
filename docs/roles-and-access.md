<!-- [PCODE-251 | S15 | v0.1.0] T25.6 T25 exit check, docs and sprint close -->

# Roles and access

What a person may do follows from their role in the workspace. A custom role can narrow it, with
conditions, and their role in a project can narrow it further there.

## Built-in roles

**People → Roles** shows what each role may do, as the server enforces it. The permissions are:

- see projects, tasks and documents;
- create and change tasks, plans and documents;
- run tests and record results;
- ask agents to work and approve their actions;
- plan and ship releases;
- accept security risks and override policies;
- set up agents, providers, prices and budgets;
- manage people, roles, tokens and sign-in rules;
- see costs, the licence and invoices;
- make or remove owners.

## Custom roles

A custom role starts from a base role and keeps some of its permissions; it never adds one. A person
with a custom role can do only what the role keeps. A contractor on _member_ who keeps only _see_ and
_create and change_ can work on tasks, but cannot ship a release, record test results or see the costs.
The answer says so: "The role Contractor does not allow this: Plan and ship releases".

The server decides which permission a request needs from what it does:

- **Reading** needs _see_; reading costs and invoices needs _see costs_.
- **Changing** needs:
  - _run tests_ for test runs and cases;
  - _ask agents_ for agent runs and approvals;
  - _ship_ for releases, deploys, environments and trains;
  - _accept risks_ for risk acceptances;
  - _create and change_ for everything else.
- **Admin work** needs _manage people_ or _set up agents_, by what it touches.

A person's own things need nothing beyond their base role: their tokens, inbox, notification rules,
devices and watched pages. Searches need nothing more either.

Changing someone's role directly takes their custom role away, since a custom role belongs to its base
role.

## Conditions

**When** on a custom role limits one of its permissions to weekdays and hours. For example, _ship_ only
Monday to Thursday, 09:00 to 16:00. The hours are read in the workspace's time zone, the one of its
working hours. Outside them the answer says when the permission holds again: "The role Release manager
allows "Plan and ship releases" only Mon–Thu 09:00–16:00 (Europe/Berlin)".

## Project roles

Under a project's **Settings → Roles in this project**, an admin gives a person a role in that project:
lead, member, tester, designer or viewer. It overrides their workspace role there.

- **A viewer** reads the project and changes nothing in it. Their other projects are unchanged.
- **Lead, member, tester and designer** keep the rights of their workspace role. The lead is shown as
  the project's lead and hears of the project's budget warnings.

Guests still reach a project by invitation, as before.

## Why someone can or cannot

**People → Governance → Access check** follows every step for a person and a project or task:

- membership and suspension;
- the custom role and the permissions it keeps, with their conditions;
- the project role;
- guest invitations and client contacts.

Through the API (`GET /api/workspaces/<id>/access-check?userId=…&projectId=…&permission=ship`), the
check also says whether they may do that one thing now.

## Editing the same task at once

A task edit may name the version it was made on, as `version` in the body or `If-Match: "7"`. When
someone changed the task since, the edit is refused with `409` and who changed it. The web app does this
for titles and descriptions, so nobody overwrites words they never saw. It reloads the task and says
what happened. Moves on the board, assignees and estimates stay _last change wins_.
