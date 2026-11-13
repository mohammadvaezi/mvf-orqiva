<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- ── [PCODE-6 | S01 | v0.1.0] Write README, docs/install.md and the docs/smoke.md sprint checklist ── -->

# Smoke checklist

One section per sprint. The last task of a sprint is not `plane done` before its section passed on the
packaged `.vsix` (rules.md → Tests). Record the result (date, who, pass/fail) in the Plane item.

How to run any section: `npm run package`, then install the `.vsix` into a clean profile —
`code --profile orqiva-smoke --install-extension orqiva-<version>.vsix` — and open
`test/fixtures/workspace` (or a real linked project).

## Sprint 01 — Foundation

- [ ] `npm run check` and `npm run package` succeed from a clean clone (`npm ci`)
- [ ] The `.vsix` installs into a clean profile without warnings about missing dependencies
- [ ] Command Palette → **Orqiva: Hello** shows the notification "Orqiva is ready"
- [ ] View → Output → dropdown lists **Orqiva** and shows the `activated` line and the `hello command` line
- [ ] `npm run test:e2e` passes (activation < 1000 ms, hello registered)

## Sprint 02 — Engine bridge and project state

- [ ] Open a real linked project (e.g. `C:\Broszio Apps\letterman`): Output → Orqiva shows `activated · project: LTR (…) · active task: …`
- [ ] The same line shows `engine: C:\Broszio Apps\plane\claude · python: …` after the first engine call (or on demand once Sprint 03 adds Sync)
- [ ] Run `plane start <ID>` in a terminal: within a second the Output shows nothing new (no polling yet) but `store.state.active` changes — visible in Sprint 03's status bar; for now verified by `npm test` (store watcher) and `npm run test:e2e` (store populated at activation)
- [ ] Settings UI → search "orqiva": engineHome, pythonPath, plane.baseUrl, plane.workspace, appear with descriptions; no apiKey setting
- [ ] `npm run test:e2e` passes (3 tests)

## Sprint 03 — Sidebar board, status bar and the task loop

- [ ] Open `C:\Broszio Apps\letterman` in VS Code: the Orqiva icon appears in the activity bar; the Sprints view lists Sprint 01 first (expanded) with items, state icons and priority prefixes matching the Plane board
- [ ] Status bar shows `$(circle-slash) No task`; after `plane start LTR-<n>` in a terminal it shows `$(tasklist) LTR-<n> · S01 · v0.1.0` within a second; hover shows the fingerprint
- [ ] Hover an item → inline Start / Done / Open in Plane; context menu → Status…, Note…, Copy fingerprint (on the active item)
- [ ] View title: Start development opens a terminal "Claude Code" in the project root and Claude starts with the Plane brief; a second click only reveals it
- [ ] Sync (view title) runs the engine and shows "Synced. …"; the board refreshes
- [ ] Stop the Plane containers (`docker stop plane-app-proxy-1`): within the refresh interval the tree description reads "offline" and the status bar shows `$(cloud-offline)`; the board stays; no error notifications; start them again and the description clears
- [ ] `npm run test:e2e` passes (4 tests)

## Sprint 04 — Task detail and new-task panels

- [ ] Click an item in the Sprints view: a panel "PCODE-12 Title" opens beside the editor with ref, title, state / priority / label badges, Description, Acceptance (☐/☑), Code (path:line, header/block), Comments (newest last); clicking a Code entry opens the file with the line selected
- [ ] Panel header: Start on a Todo item (calls the engine, badge turns In Progress after reload); Done on an In Progress item without markers shows the three-line error inline and a notification with Open output; Status opens the select + note (Ctrl+Enter); Note opens the textarea; buttons show Working… and are disabled while an action runs
- [ ] Opening a second task retargets the same panel (one tab); Open in Plane opens the item in the browser
- [ ] Status bar click opens the active task's panel; "Copy fingerprint" copies the `//` or `#` header for the active editor's file type
- [ ] View title + (New task): the form; Create stays disabled until title, description (≥ 40) and one acceptance line are filled, with the reason under the field; Create shows "Created X in Sprint …" with Start it; the item appears in the tree after refresh
- [ ] With no API key stored (Restricted Mode or unconnected): panel shows "Plane is offline; details unavailable" and the board's data
- [ ] `npm run test:e2e` passes (6 tests)

## Sprint 05 — Setup wizard

- [ ] Orqiva: Open setup → panel with the seven checks (all green on the dev machine, versions shown in the Output channel); a failed check shows Fix / Download
- [ ] Connect with a wrong key → "Connection failed. 401 Unauthorized. Check the key in Plane > Profile > Personal Access Tokens." and nothing stored; with the real key → "Connected: N projects (…)", settings.json holds baseUrl and workspace only, the key field is cleared and the hint reads "Key stored securely"
- [ ] After connecting, the Sprints view refreshes live from Plane (view description empty, status bar without $(cloud-offline)) and the task panel shows description, acceptance and comments
- [ ] Install → progress notification, Output shows `--key ***`, then "Hooks, plane command and MCP server installed."; ~/.claude/settings.json contains hooks.py and Bash(plane *)
- [ ] Forget key → modal "Remove the stored Plane key from this computer? Projects and hooks are kept."; Cancel keeps it; Remove empties it, the status bar shows $(cloud-offline) and an unlinked folder shows the "Connect Plane" welcome
- [ ] Help → Get Started → "Get started with Orqiva" walkthrough lists five steps whose buttons run the commands
- [ ] `npm run test:e2e` passes (7 tests)

## Sprint 06 — Project and plan wizards

- [ ] Empty folder → Orqiva: New project → name + identifier prompts (identifier prefilled, `pc-1` refused) → "Created ABC … · 8 states added · 5 labels added · scaffolded …" with Open board; the Sprints view shows the board without reload
- [ ] Another empty folder → Link project → quick pick lists every Plane project as `IDENT  Name` → "Linked …"; `.plane/project.json` present
- [ ] Sprints view title → Plan the project → panel: step 1 "Description is still the template", Draft disabled with "Write the description first."; Open description opens the file
- [ ] Write two paragraphs, Refresh → "Description written", Draft enabled → Draft plan opens the terminal "Claude Code (planning)" and Claude starts with the planning prompt; `.plane/state/plan_prompt.txt` starts the plan on the next working day
- [ ] Close the planning terminal → the panel re-checks and shows "Plan valid: N sprints, M items, …" (or the error list)
- [ ] Edit plan.json (set a sprint date to yesterday, save) → within two seconds the panel shows "Plan has 1 error(s)." with "Sprint N: date … is in the past"; clicking it opens plan.json at that sprint; Publish is disabled; undo → "Plan valid: …" again
- [ ] Publish plan (on a **sandbox** project, never PCODE) → modal "Publish N sprints and M items to Plane? Existing items are kept; nothing is deleted." → Cancel does nothing; Publish → progress notification, Output shows one line per sprint, then "Published: N sprints, M items created." with Open board; the panel reads "Published <timestamp>" and the Sprints view shows the new cycles
- [ ] Click Publish twice quickly → one engine run (Output shows a single `publish --yes`)
- [ ] `npm run test:e2e` passes (7 tests)

## Sprint 07 — Docs tree and fingerprint CodeLens

- [ ] Orqiva container shows a **Docs** view: Rules, Criticals, Architecture, Design system, Security checklist, Description, Sprints, Fingerprint index, Plan, Generated docs; missing files dimmed with a tooltip naming the writer; click on Rules opens the markdown preview, the pencil opens the source
- [ ] Open a fingerprinted file (e.g. `src/extension.ts`) → a CodeLens "PCODE-12 Title · State" above every marker line; clicking opens the task panel; an unknown ref reads "· not found in Plane"; offline reads "· offline"
- [ ] Marker lines are dimmed with a gutter icon; hovering shows task, title, sprint, version, state and the "Open task" link works
- [ ] Settings → `orqiva.codeLens.enabled` off → lenses and decorations disappear without a reload
- [ ] With an active task: editor context menu → Insert fingerprint → header at the top (after a shebang); run again → input box → block line at the cursor; without an active task the palette command says "No active task. Start one from the Sprints view."
- [ ] `plane done` in a terminal (fingerprints.md rewritten) → the Docs view's "Fingerprint index" turns from dimmed to openable and the open task panel's Code section lists the new files without a click
- [ ] `plane start <other>` in a terminal → the lens above that task's marker reads "· In Progress" and the status bar follows, without reopening the file
- [ ] `npm run test:e2e` passes (8 tests)

## Sprint 08 — Code documentation generator

- [ ] Docs view → Generate code documentation (or the palette) → progress notification counts the scanned files, then "Documentation generated: N sprints, M tasks (P page(s) written)."; Open README shows the preview
- [ ] `docs/generated/` holds README.md, `sprints/S**.md` and `tasks/<REF>.md`; a task page links to its source lines and the link opens the right file and line in the preview
- [ ] Run it again without changing code → "0 page(s) written", `git status` stays clean, and no new Plane comments appear
- [ ] Change one file's fingerprint block and regenerate → only that task's page is rewritten and only that task gets a `Docs — …` comment in Plane
- [ ] Settings → `orqiva.docs.outputFolder` = `documentation/code` → the next run writes there and the Docs view follows; `orqiva.docs.postToPlane` off → pages are written, no comments
- [ ] On letterman: generate, open `docs/generated/README.md`, follow a task link into the code (sprint/task counts noted in PCODE-44)
- [ ] `npm run test:e2e` passes (10 tests)

## Sprint 09 — Version panel

- [ ] Docs view → Release (v0.1.0) → the Version panel shows the version large, "v0.1.0 · N commits since", the commit list and three bump buttons
- [ ] With an uncommitted change → "Commit or stash N changed files before bumping." and all three buttons are disabled; commit → they come back
- [ ] Set package.json to a different version → "Versions disagree: package.json says …" and bumping stays disabled
- [ ] Connected to Plane → the changelog preview lists the Done items since the last tag, grouped (Features/Fixes/Tests/Chores/Changes) plus "Other commits"; disconnected → "Changelog needs Plane" and the buttons are disabled
- [ ] Bump patch → modal "Bump 0.1.0 to 0.1.1? This writes CHANGELOG.md and package.json, commits and tags v0.1.1." → Cancel changes nothing; confirm → one commit holding CHANGELOG.md, package.json and .plane/project.json, tag v0.1.1, `git status` clean
- [ ] After the bump the status bar and the next fingerprint carry v0.1.1, and the notification offers "Open release item" → the Plane item "Release v0.1.1" holds the changelog and "- [ ] deployed to a target"
- [ ] Bump again with the same version present in Plane → no second Release item is created

## Sprint 10 — Docker panel

- [ ] Docs view → Docker → the panel shows "Docker 29.x · Compose v2.x" (or, with Docker Desktop stopped, "Docker is installed but not running" and a Get Docker Desktop link, with every button disabled)
- [ ] In a project without the files: "No Dockerfile and no compose file yet." and only Generate is offered → Generate with Claude creates a Plane task, starts it and opens Claude Code with the prompt; when Claude is done both files exist, carry the task's fingerprint and the panel lights up Build and Run
- [ ] Build → the output streams into the panel and into the "Orqiva Docker" channel (Open output), ends with "Built <name>:<version>"; a failing build shows the error with Open output and the previous state stays
- [ ] Run → compose up, the services appear ("api: running · healthy"), and the health section fills by itself within two minutes
- [ ] Logs → container output streams live, Stop logs ends it; the panel keeps the last lines and says how many earlier ones only the channel has
- [ ] Stop → compose down, the service list empties, Stop and Logs go quiet
- [ ] Close the panel during a build and reopen it → the build is still running and its output is back
- [ ] Settings → `orqiva.docker.healthUrl` / `healthTimeoutSeconds` (or `healthUrl` in `.plane/deploy.json`) → Check now reports "<url>: 200 in N ms" or the failure

## Sprint 11 — Deploy panel

- [ ] Docs view → Deploy → the version with its warnings ("N uncommitted change(s)…", "vX is not tagged yet…") and "No target yet — add the first one."
- [ ] Add target → Coolify: address, application uuid and the API token (password field) → Save → the row reads "token stored", `.plane/deploy.json` holds the target and **not** the token, and the token field is empty again
- [ ] Add target → SSH: host, user and the folder with docker-compose.yml; a missing field is marked red with its own message
- [ ] Deploy to <target> → modal "Deploy v0.1.1 to prod (Coolify)? This triggers a deployment on the server." → Cancel deploys nothing and records "Deploy cancelled …" on the Release item
- [ ] Confirm → the log fills with the adapter's lines (Coolify: queued → in progress → finished, or the ssh output) and ends with "Deployed v0.1.1 to prod in 1m 43s"
- [ ] A wrong Coolify token shows "401: token rejected — check the Coolify API token of this target."; an SSH host without your key shows "Permission denied by <host> — add your key to the agent…"
- [ ] History lists the attempts of this version, newest first, failures included; the same lines are comments on the Plane item "Release v0.1.1"
- [ ] No note or panel line ever shows the token or a `?uuid=…` query string

<!-- ── [PCODE-64 | S12 | v0.1.0] Add the Get Started walkthrough content and smoke checklist for Sprint 12 ── -->

## Sprint 12 — Security checklist, hardening, errors, offline and the walkthrough

- [ ] Docs view → **Security checklist** (`0/38`) → the panel opens with nine sections and native checkboxes; `.plane/security.md` now exists and holds the template
- [ ] Tick three items → the file changes as you tick (no Save button), the panel header reads "3 of 38 checked" and the Docs entry reads `3/38`
- [ ] `git diff .plane/security.md` shows three changed characters and nothing else — headings, hints and prose are byte-identical
- [ ] Edit the file by hand (add an item, tick another), press Refresh in the panel → both show up; reopen the panel → your ticks are still there, the template is **not** copied over them
- [ ] Open the checklist in a project that has none → it is created from the template; open it again → no second write, no lost ticks
- [ ] Errors: run Done on a task with no fingerprint → "Done failed. no file carries the fingerprint […]. Add the marker above the code you wrote for this task." with a **Copy fingerprint** button that puts the marker on the clipboard
- [ ] Start a task while another is active → "… is still active. Move it first: Status → Review, or Done." with **Open task**; no notification ever names `plane_task.py` or shows a stack trace
- [ ] Pull the network (or point `orqiva.plane.baseUrl` at a closed port) and leave the window for two minutes → **one** offline notification, not one per poll; the Output channel logs every attempt; the sidebar keeps showing the board from `sprints.md`
- [ ] A path with a space and an umlaut: copy `test/fixtures` to `…\Prüf Ordner\`, open `mein projekt`, run Sync, Start and Done → the engine is found and the calls go through
- [ ] Help → **Get Started with Orqiva**: six steps (Setup, Connect, Link, Plan, Develop, Release), each with its page and its command link
- [ ] On this machine all six steps show as completed; in a fresh profile without a key, only Setup is
- [ ] `npm run test:e2e` passes (16 tests) and `npm test` passes (350+)

<!-- ── [PCODE-67 | S13 | v0.1.0] Add Open folder from the dashboard and a recent projects list on Welcome ── -->

## Sprint 13 — Projects dashboard, audit runners, recent projects

- [ ] Sprints view title bar → **Projects dashboard** → the table fills row by row, not all at once; every project of the Plane workspace appears
- [ ] The counts match the boards: open / in progress / **review** / done, and a project whose work is all awaiting sign-off shows it under Review, not In progress
- [ ] "Today" names the sprint only for a project whose cycle covers today; "Last activity" reads `today` / `yesterday` / `N days ago`
- [ ] Refresh re-reads (the rows blank and refill); reopening the panel within five minutes is instant and makes no further requests — watch the Output channel
- [ ] Stop Plane (or point `orqiva.plane.baseUrl` at a closed port) → the panel says so once and keeps the rows it already had; one failing project shows its error in its own row while the others stay
- [ ] **Open board** opens the project in the browser; **Open folder** appears only for a project this machine has opened before, and opens it in this window (Ctrl/Cmd-click → new window)
- [ ] After opening a linked project once, it is remembered: the dashboard offers its folder from any other window
- [ ] Security panel → **Checks**: npm audit reports the same counts as `npm audit` in a terminal; in a project without package.json it says so instead of reporting a clean result
- [ ] pip-audit: in a Python project without the module it says "pip-audit is not installed"; with it installed it reports the count
- [ ] **Secret scan** on orqiva finds nothing across 400+ files; plant `PLANE_API_KEY=plane_api_<32 hex>` in a scratch file in the project → found, with path, line and the value masked to four characters; delete the file and re-run → clean again
- [ ] Every run writes one dated line under its checklist item (`_Last run <date>: …_`), replaces it on the next run, and **ticks nothing**
- [ ] A line marked `orqiva:allow-secret` is not reported; the line after it is
- [ ] Open an unlinked folder → the Sprints view welcome offers **Recent projects**; the list excludes the folder already open and any folder that has been deleted; choosing one switches this window and its board appears
- [ ] `npm run test:e2e` passes (16 tests) and `npm test` passes (400+)
