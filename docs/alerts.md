<!-- [PCODE-251 | S15 | v0.1.0] T25.6 T25 exit check, docs and sprint close -->

# Alerts and reminders

Some settings speak up when it matters. Every few minutes the server looks at budgets, the day's AI
spend, watched pages, feature flags and ideas. What it finds lands in the inbox. It reaches phones and
mail as each person's rules under **Settings → Notifications** say, and quiet hours hold back the push.

| Alert                | Goes to                                                                    | When                                                                | Rule              |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------- |
| Budget warning       | owners, admins, who set the budget, the agent's owner, the project's leads | at the budget's warning percentage, once per period                 | Budgets and spend |
| Budget used up       | the same                                                                   | at 100 %, once per period                                           | Budgets and spend |
| Unusual AI spend     | owners and admins                                                          | today costs more than three times the days before, and at least 1 € | Budgets and spend |
| Watched page changed | the page's watchers, not who changed it                                    | after edits, restores, renames, status changes or comments          | Watched pages     |
| Stale flag           | who made the flag (else the admins)                                        | unchanged for 30 days                                               | Reminders         |
| Quiet idea           | who filed the idea (else the admins)                                       | open and without activity for 14 days                               | Reminders         |

## Budgets

A budget under **Tokens and costs → AI spend → Budgets** counts the AI spend of its scope: the workspace, a
client, a project or an agent. It counts per day, per month or in total. It warns once at its warning
percentage (80 % unless set otherwise) and once when it is used up. A new day or month starts both
again. A budget with **hard stop** also stops agent runs in its scope at 100 %.

## Watched pages

**Watch** on a page follows it. A burst of changes becomes one notice per page and person. It goes once
the page is quiet for two minutes, or after fifteen minutes of steady work. For example: "Ada edited it
(3 times) · Bo commented: check step two".

## Reminders

A reminder comes once. A flag that changes, or an idea that moves again, can remind again when it goes
quiet. **Settings → General** sets how long that takes:

- **Remind of a flag unchanged for (days)**, 30 by default;
- **Remind of an idea without activity for (days)**, 14 by default.
