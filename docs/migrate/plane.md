<!-- [PCODE-221 | S15 | v0.1.0] T20.3 Migration guides for Jira, Linear and Plane on the docs site -->

# Moving from Plane

A Plane project comes over through Plane's own API, with more than a CSV could carry: comments with their
authors and times, and the activity history. Each item keeps its number, so `PCODE-12` stays `PCODE-12`,
and fingerprints in your code keep pointing at the right task.

## 1. Make a Plane API key

In Plane's settings, open **API tokens** and create a token. The import only reads Plane, at no more
than 50 requests a minute, so it never changes anything there.

Then set three variables in the terminal you will use. The key stays in that terminal; it is never
written anywhere.

| Variable               | Value                                                |
| ---------------------- | ---------------------------------------------------- |
| `PLANE_API_KEY`        | The token you created                                |
| `PLANE_BASE_URL`       | Your Plane address, e.g. `https://plane.example.com` |
| `PLANE_WORKSPACE_SLUG` | The workspace part of Plane's URLs                   |

## 2. Look first, then sign in

A dry run reads the project from Plane and shows what would come in, without changing anything:

```
orq import plane --project PCODE --dry-run
```

Then sign in to your Orqiva server as a workspace admin:

```
orq login --server https://orqiva.your-company.example
```

## 3. Import

```
orq import plane --project PCODE
```

This creates the project under Plane's key. To use another key, add `--key NEWKEY`. To import into the
project your folder is linked to (`orq link`), add `--into-linked`. A large project takes a while because
of Plane's rate limit; the command shows its progress.

## What comes over

| In Plane                                    | In Orqiva                                                     |
| ------------------------------------------- | ------------------------------------------------------------- |
| Work items with their numbers               | Tasks with the same key and number                            |
| Title, description                          | Title, description (as text)                                  |
| States with their groups                    | The same states and groups                                    |
| Labels                                      | Labels                                                        |
| Cycles (an item in several: the latest one) | Sprints                                                       |
| Parent                                      | The parent task                                               |
| Assignees                                   | Kept when the same email address is a member of the workspace |
| Priority                                    | A label such as `priority: high`                              |
| Comments, with author and time              | Comments                                                      |
| The activity log                            | Each task's history                                           |

Invite your team **before** the import, so that assignees are kept.

## What does not come over

- **Attachments and pages.**
- **Modules, views and estimates' point scales.**
- **Formatting in descriptions**: they arrive as plain text.

## Running it again

Run the same command again. What changed in Plane is updated and nothing is added twice. An import that
stopped half way is simply run again. You can keep using Plane during a trial period and import again
before you switch.

## When something goes wrong

| Message                                                      | What to do                                        |
| ------------------------------------------------------------ | ------------------------------------------------- |
| Set PLANE_API_KEY, PLANE_BASE_URL and PLANE_WORKSPACE_SLUG … | Set the three variables in this terminal (step 1) |
| Not signed in to … Run: orq login --server …                 | Sign in first, as shown in step 2                 |
| `--into-linked` needs a folder linked with orq link          | Run `orq link KEY` in this folder first           |
