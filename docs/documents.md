<!-- [PCODE-286 | S15 | v0.1.0] T29.8 T29 exit check, docs and sprint close -->

# Documents

Every project has a wiki under its **Documents** tab. **Pages** shows the tree on the left, the open page
in the middle and its side parts on the right. **AI knowledge** sets which pages each agent may read, and
**Health** lists stale pages and broken links. A page is Markdown underneath, so versions, diffs, agents
and exports all read the same text.

## Writing a page

**Edit** opens the page. **Blocks** edits it block by block in place; **Source** shows the whole Markdown.
In Blocks, type `/` in an empty block (or use **+**) to insert one:

- text, headings, bulleted, numbered and task lists, quotes, tables and code with its language;
- **callouts**: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]` and `> [!CAUTION]`, with an
  optional title after the marker;
- **math** in TeX, as a block between `$$` lines or inline between single `$`;
- **diagrams**: a `mermaid` code block with a flowchart (`graph LR`) or a sequence diagram;
- **live parts of the project**, written as an `embed` block of one line:
  - `tasks: state:open label:ops` lists tasks by a query, kept up to date;
  - `design: <name>` shows the latest version of a UI kit design;
  - `gantt` (or `gantt S15`) shows the plan as a timeline;
  - `code: src/file.ts#L10-L40` shows lines of a repository file, as of the last `orq docs scan`.

Drag a block by its handle to move it. Paste or drop an image to upload it; it becomes one of the page's
files.

## Editing together

When several people open the same page in Edit, the bar above it names them. Each person's changes reach
the others about once a second, and edits to different lines or different words of one line are merged.
When two people change the same words, both versions are kept one under the other, and the bar says so.
**Save** makes one version for everyone. A save made outside the live draft (by the CLI or an agent, for
example) is taken into the draft, not lost.

## Versions, comments and watching

**History** lists the versions with who saved them. Name a version (for example "Agreed with ops") to find
it again. Compare two versions as a rendered diff: added blocks in green, removed blocks in red, changed
words marked. You can also restore an older version.

Select a passage to comment on it. `@name` in a comment tells that person in their inbox, with a link to
the page. **Watch** tells you when the page changes. **Lock** stops others from editing it.

## Finding pages

The search above the tree looks through titles, tags and page text, and shows where the words matched.
Pages also appear in the global search and in Cmd-K, for members (not guests). **Links** shows the pages
that link here; `[[Page title]]` links to another page.

## The tree, files and readers

Drag a page in the tree onto another page to put it under that page, or onto the edge between two pages to
put it between them. A page never moves inside itself. **New** makes a page or a folder.

**Files** lists a page's files (they also show under the page in the tree). Click an image on the page to
**annotate** it with boxes, arrows and labels; the result is saved as a new image next to the old one.

**Readers** shows who read which version, how often, and which watchers have not read the latest one.

## Pages for one task

Under **Properties**, a page can be opened to the agents working on named tasks: add `OPS-12`, and an agent
running for OPS-12 can read the page even when its knowledge scope would not allow it. Other tasks see
nothing more. When an agent reads a page it names the passage it relies on. The server checks that the
passage is on the page (spaces and case aside). The agent is told when it is not, and **AI knowledge**
marks those reads.

## Import

**Import** (above the tree) takes:

- a ZIP of Markdown files: folders become folders, links between files become page links, and images
  become files of their pages;
- a **Notion** export (Markdown & CSV): the ids in file names are dropped and sub-pages nest under their
  page. Databases (the CSV files) do not become pages;
- a **Confluence** space exported as HTML: pages nest by their breadcrumbs, and information, note and
  warning boxes become callouts;
- one Markdown or HTML file.

Choose the folder to import into. The result says how many pages, folders and files came in, and which
files were not read (style sheets, scripts and other files no page uses). README files from the repository arrive through
`orq docs scan`.

## Export

On a page, **Export** offers **Markdown**, **HTML** (one file, with its images, math and diagrams inside)
and **PDF** (the browser's print dialog shows only the page; choose "Save as PDF"). A folder offers
**Download it as a ZIP**, and **Download the wiki (ZIP)** above the tree takes every page: Markdown files in
their folders, with their files under `files/`.
