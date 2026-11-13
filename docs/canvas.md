<!-- [PCODE-265 | S15 | v0.1.0] T27.7 T27 exit check, docs and sprint close -->

# Canvas

The Canvas is a project's plan over time: its tasks scheduled over the team's working days, with their
dependencies, the critical path, baselines and scenarios. You find it under a project's **Canvas** tab:
**Gantt**, **Grid**, **Timeline**, **Mind map**, **Workload**, **Calendar** and **Portfolio**.

## The Gantt

- **Drag a bar** to move the task. A task scheduled automatically keeps its dependencies; the date you
  drop it on becomes the earliest it may start.
- **Drag a bar's right end** to change its duration. Dropped on a day off, it counts the next working day.
- **Drag the dot after a bar** onto another task: the other task now waits for this one (finish to
  start). A link that would close a loop is refused.
- **Shift-drag** moves the task and every task that follows it through its dependencies, by the same
  number of working days. In a scenario, the move goes into the scenario.
- **Zoom** from days and weeks to months, quarters and years.
- **Colour** the bars by the critical path, state, kind, type (the project's own type colours) or person.
  The legend follows.
- **Outline:** fold a summary row with its arrow, or show only levels 1, 2 or 3.
- Commits and pull requests linked to a task show as marks on its bar, on their day. Clients don't see
  them.

### Scheduling, constraints and splits

The task panel below the Gantt sets how a task is scheduled:

- **Automatic** tasks start as soon as their dependencies allow. **By hand** tasks stay where they are and
  say which dependency they break.
- **Constraints**, as MS Project names them:
  - **As soon as possible** and **As late as possible**.
  - **Start no earlier than**, **Start no later than**, **Finish no earlier than** and **Finish no later
    than**.
  - **Must start on** and **Must finish on**.

  The "no later than" kinds also bound the latest dates, so they show on the float and the critical path.
  A constraint the dependencies break is marked **!** on the bar.

- **Split:** pause a task after some working days for some working days. The bar is drawn in pieces, the
  tasks after it wait for its last piece, and the workload counts only the days of work.

The plan counts the team's working weekdays and the workspace's holidays (**Settings → General →
Holidays**).

## The grid

The grid is the plan as a spreadsheet:

- **Cells:** the task, start, duration, predecessors, resource and % done are edited in place. **Enter**
  or leaving the cell saves; **Escape** puts the value back. A wrong value is outlined and says why.
- **Values** are taken the ways people type them: 2026-10-12, 12.10.2026, 3 days, 3d, 40 %.
- **Formulas:** start a cell with `=`. Rows are named by their outline number:
  - `=[1.2].finish + 2` is two working days after 1.2 finishes.
  - `=SUM([1.1].duration, [1.3].duration)`, `MIN`, `MAX`, `AVG` and `ROUND` work on numbers.
  - `WORKDAY(2026-10-12, 5)` counts working days.

  A date plus a number counts working days; a date minus a date is the working days between. The result
  is saved as the value.

- **Predecessors** are written as in MS Project: `1.2FS+2d, 3SS`. Retyped, the dependencies follow.
- **Fill down:** click a cell, Shift-click one below it, then **Fill down** or Ctrl+D.
- **Paste from Excel or Google Sheets:** a block lands from the cell you paste into, to the right and
  down. Rows past the end become new tasks.
- **Indent** puts a task under the one above it; **Outdent** moves it up one level (Alt+Shift+Right and
  Left).
- Summary rows add up the estimate and the work below them.

## The other views

| View      | Shows                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| Timeline  | one lane per top-level part with its span and progress, the milestones on their own lane, months on the axis          |
| Mind map  | the project as a tree from the project to its tasks, with progress; **+** adds a task under a node                    |
| Workload  | each person and agent per week, or as a heat map by day; levelling moves tasks within their float, first as a preview |
| Calendar  | the month with the tasks' starts and ends and the milestones                                                          |
| Portfolio | every open project on one axis: % done, finish, slip against its latest baseline, critical and late tasks, milestones |

**Agents as resources:** a task given to an agent (and nobody else) loads the agent. An agent carries
several tasks a day: **Tasks an agent carries a day** in the settings, 3 unless set.

## Scenarios

A scenario changes dates, durations and people aside from the live plan. With a scenario chosen, **What
the scenario changes** lists every task whose start, finish, duration or person differs from the live
plan. **changed** marks the tasks changed in the scenario; **follows** marks the tasks that moved because
of them. **Merge** writes the scenario onto the plan; **Discard** drops it.

## Files in and out

- **Export:**
  - **MS Project XML** opens in MS Project, ProjectLibre and GanttProject, with outline levels,
    durations, % done, constraints, links with their lag, and people.
  - **CSV for Excel** has the columns MS Project uses.
  - **Calendar (iCal)** has each task as an all-day event.
- **Import:** an MS Project XML file, or a CSV with a Name column (English or German MS Project column
  names, comma or semicolon). You see first what would be made, under which parent and for whom, and
  what is skipped and why. **Make … tasks** then makes them. People are matched by name; a link that
  would close a loop is left out.
- **Picture:**
  - **PNG picture** saves the Gantt as shown, for slides and mails.
  - **Print or save as PDF** lays it on A4 or A3, landscape or portrait, on one page or page-wide across
    pages; the browser's print saves the PDF.

## Share links

**Share** makes a read-only link to the project's plan, with a name and an end date if you want one.
Anyone with the link sees the Gantt and the timeline without signing in: tasks, dates, links and
progress, with no people, comments or code. The same link has a calendar address (`webcal://…`) that
Outlook and Google Calendar subscribe to, so the plan's dates stay current there.

Copy the link when it is made; it is shown once and kept only as a hash. The list shows when each link
was last opened, and **Withdraw** ends a link at once.
