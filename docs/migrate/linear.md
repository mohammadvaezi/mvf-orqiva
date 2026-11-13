<!-- [PCODE-221 | S15 | v0.1.0] T20.3 Migration guides for Jira, Linear and Plane on the docs site -->

# Moving from Linear

A Linear team's issues come over from a CSV export. Each issue keeps its identifier, so `ENG-42` stays
`ENG-42`. Running the import again updates what is there; it never makes copies.

## 1. Export from Linear

In Linear, open **Settings → Import / export → Export CSV** and save the file Linear prepares.

## 2. Look first, then sign in

First do a dry run. It reads the file and shows what would come in: the issues, statuses, cycles and
labels. It changes nothing and needs no sign-in.

```
orq import linear linear-export.csv --dry-run
```

Then sign in to your Orqiva server as a workspace admin:

```
orq login --server https://orqiva.your-company.example
```

## 3. Import

A Linear export usually holds every team. Each run imports one team; name it with `--project`:

```
orq import linear linear-export.csv --project ENG
orq import linear linear-export.csv --project OPS
```

Each team becomes a project under its key and named after the team. To use another key, add
`--key NEWKEY`. To import into the project your folder is linked to, add `--into-linked`.

## What comes over

| In Linear                                        | In Orqiva                                            |
| ------------------------------------------------ | ---------------------------------------------------- |
| Identifier (`ENG-42`)                            | The same key and number                              |
| Title, Description                               | Title, description                                   |
| Status                                           | A state of the same name                             |
| Started, Completed, Canceled dates               | Decide the state's group: started, done or cancelled |
| Labels                                           | Labels                                               |
| Cycle (its name, or _Cycle 12_ when it has none) | A sprint of the same name                            |
| Parent issue                                     | The parent task                                      |
| Estimate                                         | The estimate (whole numbers)                         |
| Priority                                         | A label such as `priority: urgent`                   |
| Created, Updated                                 | The same dates                                       |
| Assignee                                         | The assignee, when it matches a member               |

## What does not come over

- **Comments and attachments.** They are not part of Linear's CSV export.
- **People who are not members.** Assignees are matched to your members by email or name; invite your
  team before the import. A name that differs can be mapped in a CSV of `name,email` passed with
  `--people people.csv`. Work of people who are not members arrives unassigned.
- **Cycle dates, projects, roadmaps and initiatives.** Cycles arrive by name only.

## Running it again

Export again and run the same command. Issues that changed are updated and new ones are added. Each issue
is recognised by its Linear ID, so nothing is duplicated. An import that stopped half way is simply run
again.

## When something goes wrong

| Message                                                         | What to do                                   |
| --------------------------------------------------------------- | -------------------------------------------- |
| This is not a Linear export: it has no "ID" and "Title" columns | Export again from Settings → Import / export |
| No issues with the key `X` in the file                          | Check the team key you gave with `--project` |
| Not signed in to … Run: orq login --server …                    | Sign in first, as shown in step 2            |
