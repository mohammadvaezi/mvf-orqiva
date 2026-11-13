<!-- [PCODE-278 | S15 | v0.1.0] T28.7 T28 exit check, docs and sprint close -->

# Ideation and the PRD

Ideation takes an idea from a first sentence to an approved PRD and an epic in the backlog. You find it
under a project's **Ideation** tab. The list on the left shows the ideas; above it you switch between one
**Idea**, the **Matrix** of all open ideas and the **Evidence** library. Ideation belongs to the team:
clients take part only through the portal (see the end of this page).

## Sources

An idea learns from its sources. Under **Sources** you add:

- **Files:** PDF, Word, images (read by OCR) and audio (transcribed). Text files are read straight away;
  the rest is read in the background through the workspace's AI provider, and the row says when it's done.
- **Links:** the server reads the page when you add it and keeps its text and title. A PDF or Word file
  behind a link is stored and read like an upload. Only public addresses are read, and every redirect is
  checked again. **Read again** fetches a changed page, or retries one that failed (the row says why).
- **Text** and **quotes**: pasted notes, and what a customer said, with who said it.
- **Client requests:** link a request of the project's client to the idea. It counts as evidence.

From the terminal: `orq idea source APP-I3 --file brief.pdf`, `--link https://…` or
`--text "…" --said-by "…"`, and `orq idea show APP-I3` lists the sources and how far each is read. In VS
Code, **Orqiva: Add a source to an idea** sends the selection, the open file, a link or text.

## The interview

The Interviewer asks the idea's owner one question at a time. Each question names its area: problem,
users, scope, non-goals, quality, data, integrations or security. The answers fill those areas, and so
do requirements and answered questions. Before each question, the Interviewer is told how well each area
is covered and asks about the weakest one that matters. It sums up when every area is covered, after at
most 12 questions, or when you press **That's enough, sum up** (`orq idea interview APP-I3 --enough`).

A question, risk or assumption handed to a person (its owner) reaches them in the inbox, by push and by
email, and links straight to the idea's questions.

## Requirements, stories and personas

**Extract with the Analyst** reads the idea, its sources and the interview. It proposes:

- requirements, each citing the exact passage of the source it rests on;
- open questions, assumptions, risks and glossary terms;
- **personas** (the project's people: role, goals, pains, a quote);
- **stories** in the form "As a …, I want …, so that …", each with its persona and its Given / When / Then
  scenarios.

Everything arrives as _proposed_. Statements already known are left out, and so are lines of the prompt
itself. If a source had no text yet, a note says which one, so you can extract again once it's read.

The **Stories** tab groups the stories by persona. There you change a story's persona, add or remove
scenarios, add a story, and copy all of them as Gherkin for a test tool. The **Personas** tab holds the
project's personas, shared by all its ideas.

## Matrix, evidence and compare

- **Matrix:** the open ideas placed by the mean value and effort people scored under **Priority** (value
  up, effort right). The four corners are quick wins, big bets, fill-ins and money pits. Click an idea to
  open it.
- **Evidence:** every customer quote and every linked client request, counted per idea with the number of
  distinct voices (the same person twice counts once).
- **Compare** (on an idea) puts it next to another: status, scores, coverage, requirements by kind, open
  questions, the top risk, evidence and the estimate.

## The PRD

**PRD and sign-off** opens the idea's PRD page. The Architect writes the proposal from the idea, the
interview and the requirements. People then edit it, and every save is a new version.

- **Template by kind.** A feature adds users and personas, success metrics and quality requirements. An
  improvement adds how it works today and what gets better. A bug adds steps to reproduce, expected and
  actual behaviour, and affected versions. Research adds the questions, the method and the decision it
  informs. A change request adds the current agreement, the requested change, and its effect on cost and
  dates.
- **Citations.** A statement that rests on a requirement or source ends with its code, e.g. `[R-3]` or
  `[S2]`. The page shows each code as a chip; hover it to see the requirement and the exact passage. A
  line above the PRD says how many statements are cited and lists the others.
- **Versions.** Pick a version, and pick another under **compared with**: the changes show part by part,
  text word by word, lists line by line.
- **Export** any version as **Markdown**, **Word** or **Gherkin**, or print it as a **PDF**. The files
  include the stories with their scenarios and an appendix of the cited requirements and passages.

### The estimate

Next to the points and working days, the PRD shows:

- a **size** for the whole idea, from XS (up to 3 points) to XXL (over 80);
- a **range**: likely days, and a low and high figure. These come from how the project's finished tasks of
  the last 180 days came out against their estimates (logged hours over estimated hours). With fewer than
  five such tasks, the standard spread is used, and the page says so;
- a **confidence** (high, medium or low), from how much history there is and how widely it spreads;
- the **basis per task**: the project's finished tasks that read most alike, what they were estimated at,
  what they really took, and the points they suggest. Tasks far from their look-alikes are marked.

## Review, approval and promotion

**Name approvers** under **Approval**. Approvers can be team members who see the project, or contacts of
the project's client. **Request review** puts the idea _in review_ and asks each approver.

Each approver reads the latest version and either approves it or asks for changes. Either way, they sign
with their typed name and the consent statement. The SHA-256 of the exact version is kept with the
decision. The idea is **approved** when every named approver has approved the latest version. One request
for changes (with a note) sends it back to _proposed_.

A new version voids earlier decisions. If you edit an idea that is in review or already approved, the
review starts again and the approvers are asked again. In the version list, each version shows its state:
draft, in review, approved, changes requested, declined, or superseded for every older version.

Without named approvers, the workspace owner signs alone, as before, now once per version.

**Promote to an epic** is a separate step after approval. The idea becomes an epic in the backlog with
its stories under it (each scenario as an acceptance criterion) and the proposal's tasks with their
points. The tasks link back to the idea, so the traceability view runs from the decision to the deploy.
After promotion, the PRD is frozen.

## The client's part

In the portal under **Approvals**, a client contact sees:

- the PRDs they are named to approve. They read the PRD there, then approve it or ask for changes with
  the same signature;
- the questions the team handed to them, which they answer in place. The answer reaches the idea at once.

Contacts never see the rest of Ideation: other ideas, scores, internal sources or the team's
discussion.
