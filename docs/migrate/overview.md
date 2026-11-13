<!-- [PCODE-221 | S15 | v0.1.0] T20.3 Migration guides for Jira, Linear and Plane on the docs site -->

# Moving to Orqiva

Your backlog comes with you, and its numbers stay the same. An imported `APP-12` is still `APP-12`, so
links in commits, pull requests and chat keep making sense.

| From   | How                            | Comments and history | Guide               |
| ------ | ------------------------------ | -------------------- | ------------------- |
| Jira   | CSV export (all fields)        | No                   | [Jira](jira.md)     |
| Linear | CSV export                     | No                   | [Linear](linear.md) |
| Plane  | Plane's API, with an API token | Yes                  | [Plane](plane.md)   |

## Every import works the same way

- **Dry run first.** `--dry-run` shows what would come in and changes nothing.
- **Run it as often as you like.** A second run updates what changed and adds what is new. Nothing is
  ever duplicated, and an import that stopped half way is simply run again.
- **One project per run.** Choose it with `--project KEY`. Use `--key NEWKEY` to give it another key, or
  `--into-linked` to import into an existing project.
- **States keep their names** and are sorted into Orqiva's groups: backlog, to do, started, done and
  cancelled.
- **Priority becomes a label** such as `priority: high`, so nothing is lost.
- It needs a workspace admin.

## A good order for the switch

1. **Install Orqiva** and invite your team ([Getting started](../getting-started.md)). From Plane,
   assignees are only kept for people who are already members.
2. **Do a dry run**, then import one project and look at it with the team.
3. **Keep working in the old tool for a few days if you like.** Import again before the switch: it
   updates in place.
4. **Switch.** Plan the next sprint in Orqiva, assign the open work, and link your repositories with
   `orq link KEY`.
