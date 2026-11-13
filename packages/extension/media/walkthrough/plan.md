<!-- [PCODE-455 | S15 | v0.1.0] Rename the project folder .plane to .orqiva on Orqiva folders, with a one-time move -->
<!-- [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names -->
<!-- [PCODE-64 | S12 | v0.1.0] Add the Get Started walkthrough content and smoke checklist for Sprint 12 -->

# Plan the project

Write what you want in `.orqiva/description/description.md` - prose, not tickets. Add screenshots or a
PDF if you have them.

Then **Draft plan** opens Claude Code with the planning prompt. It reads the description and writes
`architecture.md`, `design-system.md`, the project half of `rules.md`, `criticals.md` and `plan.json`:
one-day sprints, each item with a description and acceptance checks. Nothing reaches the server yet.

**Check plan** validates it, **Publish plan** creates the cycles and issues after you confirm the count.
Publishing again adds what is new; it never deletes.

This step completes once a plan has been published.
