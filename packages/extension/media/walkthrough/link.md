<!-- [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names -->
<!-- [PCODE-64 | S12 | v0.1.0] Add the Get Started walkthrough content and smoke checklist for Sprint 12 -->

# Link or create a project

One folder, one Orqiva project. The link lives in `.orqiva/project.json` and is committed, so everyone
who clones the repository works against the same board.

- **Link project** lists the projects you can see on your Orqiva server, including one you made a minute
  ago in the web app, and links this folder to the one you pick. It is the same as `orq link KEY`.
- **New project** creates the project on the server, with its board states, and links this folder to it.

This step completes when the folder is linked.
