<!-- [PCODE-64 | S12 | v0.1.0] Add the Get Started walkthrough content and smoke checklist for Sprint 12 -->

# Develop

**Start development** opens Claude Code in this folder with the engine's environment. From there the
loop runs itself:

1. `sync` carries yesterday's unfinished items into today's sprint.
2. `start PCODE-12` moves the item to In Progress and writes the active task.
3. Every block of code written for it carries `[PCODE-12 | S12 | v0.1.0]`.
4. `done` refuses without that marker, then commits, comments and moves the item to Review.

You can do any of it from here too: the Sprints view starts and finishes tasks, the status bar shows
the active one, and a CodeLens above each fingerprint opens the task it belongs to.

This step completes while a task is active.
