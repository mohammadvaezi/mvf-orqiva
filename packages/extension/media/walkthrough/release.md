<!-- [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names -->
<!-- [PCODE-64 | S12 | v0.1.0] Add the Get Started walkthrough content and smoke checklist for Sprint 12 -->

# Release

**Version** shows what the three sources say - `project.json`, `package.json` and the last git tag - and
names any disagreement before you act on it. A bump writes the CHANGELOG section from the items done
since the last tag, updates the version files, commits and tags, all in one step.

**Docker** generates a Dockerfile and a compose file from `architecture.md` through a task of its own, then builds, starts and watches the container from the panel.

**Deploy** sends it to a Coolify application or over SSH, and every attempt - including a failure - is
posted to the release item, so the board says what is running where.

This step completes once a CHANGELOG exists in the project.
