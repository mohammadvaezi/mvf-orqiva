<!-- [PCODE-221 | S15 | v0.1.0] T20.3 Migration guides for Jira, Linear and Plane on the docs site -->

# Moving from Jira

The Jira project's issues come over from a CSV export. Each issue keeps its number, so `APP-12` stays
`APP-12`. Running the import again updates what is there; it never makes copies.

## 1. Export from Jira

1. In Jira, open **Filters → View all issues** and filter to the project, for example `project = APP`.
2. Choose **Export → Export CSV (all fields)**.

Use _all fields_: the import needs the `Issue key`, `Status Category` and story point columns, and the
smaller export leaves some of them out. Jira limits how many issues one export holds; a large project may
need several exports (see [More than one file](#more-than-one-file)).

## 2. Look first, then sign in

First do a dry run. It reads the file and shows what would come in: the issues, statuses, sprints and
labels. It changes nothing and needs no sign-in.

```
orq import jira jira-export.csv --dry-run
```

Then sign in to your Orqiva server as a workspace admin:

```
orq login --server https://orqiva.your-company.example
```

## 3. Import

```
orq import jira jira-export.csv
```

This creates the project under the Jira key (`APP`) and the project's name. To use another key, add
`--key NEWKEY`. To import into the project your folder is linked to (`orq link`), add `--into-linked`.

## What comes over

| In Jira                                              | In Orqiva                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| Issue key and number                                 | The same key and number                                     |
| Summary, Description                                 | Title, description                                          |
| Status                                               | A state of the same name, grouped by Jira's status category |
| Status _Won't Do_, _Declined_, _Duplicate_ and alike | A cancelled state                                           |
| Labels                                               | Labels                                                      |
| Issue type other than Story, Task or Sub-task        | A label such as `type: Bug` or `type: Epic`                 |
| Sprint (the latest one, when an issue had several)   | A sprint of the same name                                   |
| Parent                                               | The parent task                                             |
| Story points                                         | The estimate (whole numbers)                                |
| Priority                                             | A label such as `priority: high`                            |
| Created, Updated                                     | The same dates                                              |
| Assignee                                             | The assignee, when it matches a member (see People)         |
| Comments (date, author, text)                        | Comments with their dates and authors                       |

## What does not come over

- **Attachments and work logs.** They are not part of Jira's CSV export.
- **People who are not members.** Their work arrives unassigned; assign it once they have joined.
- **Sprint dates and goals.** Sprints arrive by name only. Set the dates of the current sprint after the
  import.
- **Workflows and custom fields** other than story points.

## People

Assignees and comment authors are matched to the members of your workspace: by email address when the
export has one, otherwise by the member's name. Invite your team before the import so they can be
matched. Jira's export names comment authors by account ID; map those (and any name that differs) in a
small CSV and pass it with `--people`:

```
id,email
5b10ac8d82e05b22cc7d4ef5,ada@your-company.example
Ada L.,ada@your-company.example
```

```
orq import jira jira-export.csv --people people.csv
```

The import reports who it could not match. A comment by someone it could not match keeps the name as its
author.

## Running it again

Export again and run the same command. Issues that changed are updated, and new issues are added. Nothing
is duplicated, because each issue is recognised by its Jira ID. An import that stopped half way is simply
run again.

## More than one file

Each run imports one project. When a file holds several projects, the one with the most issues is
imported, and the others are counted as skipped. To pick a project, add `--project KEY`. Several exports
of the same project can be imported one after the other.

## When something goes wrong

| Message                                                 | What to do                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| This is not a Jira export: it has no "Issue key" column | Export again with **Export CSV (all fields)**                |
| No issues with the key `X` in the file                  | Check the key you gave with `--project`                      |
| Not signed in to … Run: orq login --server …            | Sign in first, as shown in step 2                            |
| The file has no issues                                  | The filter was empty; export again with the project selected |
