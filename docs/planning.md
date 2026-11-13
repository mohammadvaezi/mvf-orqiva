<!-- [PCODE-258 | S15 | v0.1.0] T26.7 T26 exit check, docs and sprint close -->

# Planning

Planning is where a project's work is shaped, estimated, taken into sprints and followed to done. You find
it under a project's **Planning** tab: **Board**, **Backlog**, **Planner's draft**, **Capacity**,
**Reports** and **Retro**.

## The shape of the work

- **Levels:** an **initiative** holds **epics**; an epic holds stories, tasks, bugs and spikes.
  - A task's drawer picks its epic; an epic's drawer picks its initiative.
  - The **Initiatives** card above the backlog shows each initiative's epics and how many tasks and
    points below it are done.
- **Your own types:** **Project settings → Types of task** adds kinds of your own, each on a base kind.
  An Incident on a bug is a bug that shows as Incident. Choosing a type sets the task's kind.
- **Your own fields:** **Project settings → Fields** adds fields to every task of the project. A field is
  text, a number, a choice, a day or a person.
  - The drawer edits them, and every value is checked.
  - The API filters on them: `?field=customer:Northwind`.
  - Removing a field removes its values.

## Estimates

**Settings → General → Estimate in** sets the unit per workspace or project: points, hours or T-shirt
sizes. T-shirt sizes XS, S, M, L, XL and XXL are kept as 1, 2, 3, 5, 8 and 13 points. **Hours of work in one
point** (6 unless set) turns points into hours where hours are compared.

- **Planning poker:** **Planning poker** in a task's drawer starts a round.
  - Everyone lays a card; nobody sees the others' cards, only who has voted.
  - **Reveal** shows the cards, from the lowest to the highest, and suggests the middle card.
  - **Accept** makes it the estimate. A round can also be closed without one.
- **Suggest from similar tasks:** looks at the project's finished tasks whose title and description read
  alike, and shows them with their estimates and the hours logged on them.
  - With time logged on two or more, the suggestion is what they really took.
  - Otherwise it is the middle of their estimates.
- **Estimate vs actual** in Reports sets each task's estimate against the hours logged on it, for the
  sprint or for the last 90 days. The tasks that went most over come first.

## Capacity

**Capacity** counts each person's room in the sprint:

- their hours a week (from their work profile) over the working days;
- without the workspace's holidays (**Settings → General → Holidays**) and their approved absences;
- times their focus factor;
- in points or hours.

A number typed in by hand wins. Counted are the project's people: those with a role in the project, a
task in it, or a number set by hand. Agents with a day budget show their budget for the sprint and the
tasks they hold.

## The Planner

**Planner's draft** asks the Planner agent which backlog tasks to take into the sprint's room. It sees:

- each task's priority, whether it is ready, and the definition of ready;
- who has room, and who is away;
- which unfinished tasks outside the sprint a task waits for.

A task is kept only after the task it waits for. Each line names who could take it; accepting a task
nobody has yet gives it to them. The Planner may also propose up to three **new stories** the sprint
needs, within the room left; accepting one makes it a task of the sprint.

## Flow

- **Links:** a task relates to, duplicates or blocks another, and the other task shows the link from
  its side. **Close as duplicate of** closes a task into its original.
- **WIP limits:** `PUT …/states/<state>/wip` sets the most tasks a column may hold. The board shows
  "2 / 1" in red when a column is over, and says so when a card is dropped into a full column.
- **Warnings:** a "!" on a card names what holds it up:
  - it is blocked by an open task;
  - it is due after the sprint ends;
  - it waits for a task outside the sprint.
- **Definitions of ready and done** are checklists in the drawer. Ticking all of ready makes the task
  ready. With **Ask for a reason when a task is done with open entries of the definition** on, such a
  move needs a reason, which is kept as a comment.
- **Triage:** tasks an agent makes, and tasks sent with `"triage": true`, wait above the backlog until
  someone takes or declines them.
- **Templates:** a template makes the same kind of task the same way, into the backlog or the sprint.
  A template can repeat daily, weekly on a weekday or monthly on a day; the server makes the next task
  on its day.

## At keyboard speed

On the board and the backlog, **?** shows the keys:

| Key    | Does                       |
| ------ | -------------------------- |
| j / k  | next and previous task     |
| Enter  | open the task              |
| e      | open it to edit the title  |
| a      | assign it to me            |
| m      | move it to the next column |
| x      | select it                  |
| c      | new task (backlog)         |
| Ctrl+Z | undo                       |

Selected tasks get a bar to move, assign, plan, reprioritise or delete them all at once. **Undo**, or
Ctrl+Z, puts the last change back: one edit, or a whole bulk change. A deletion cannot be undone.

**Views** on the board save the lanes and quick filters under a name, for you or shared with the team.
A task's page has its **History**: every change, who made it and when.

## Git and bugs

- **Git moves the tasks** in Project settings: a branch or commit, an opened pull request and a merge
  each move the tasks they name to a state you choose. Tasks move forward only, never back and never out
  of done.
- **Bug fix times:** a bug has a fix time by its priority (**Fix time of a bug by priority**: urgent 8 h,
  high 24 h, medium 72 h, low 168 h). Its card shows the time left. Past it, the assignee (else the
  admins) gets one alert.

## Reports

| Chart               | Shows                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Burnup and burndown | of any sprint, past or running, in points or tasks, with the scope as tasks joined and left            |
| Cumulative flow     | how many tasks stood in backlog, to do, in progress and done on each of the last 30 days               |
| Control chart       | each task finished in 90 days by its days from start to done, with the average and the 85th percentile |
| Lead time           | how many tasks took how many days from being filed to done                                             |

The charts are rebuilt from the activity, so they are right for the past without daily snapshots.
