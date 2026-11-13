<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- ── [PCODE-72 | S14 | v0.1.0] Handover: refresh architecture.md, list known issues and next-release candidates ── -->

# Known issues and what is not finished

Written at v0.1.0, as the input for the next planning run. Everything here is a deliberate gap or an
untested claim, not a surprise — the point of writing it down is that the next person does not
rediscover it by being bitten.

## Known issues

|     | What                                                                                                                                                                                                                                                                                                        | Where it bites                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **The smoke checklist has never been run on a packaged `.vsix` in a clean profile.** Sprints 01–13 each have a section in [smoke.md](smoke.md); none is ticked. Every claim in this repository rests on 419 unit tests and 16 e2e tests, which is not the same as a person using it                         | Anything that only breaks in a real installed extension: the icon, the walkthrough, the Marketplace metadata, menu placement, the first-run experience |
| 2   | **The Marketplace step is untaken.** The manifest is complete and the `.vsix` packages without warnings, but nothing has been published, so `publisher: broszio` is unverified and the extension installs only from a file                                                                                  | Distribution. Also the Personal Access Token and the publisher account, which are owner-side                                                           |
| 3   | **CI lives in the wrong place for the new repository.** The code moved into `Orqiva/extension/`, but GitHub Actions only runs workflows at the repository root, so `.github/workflows/ci.yml` under `extension/` will not run and the README badge will stay grey until it moves and its paths are adjusted | Every push. The workflow itself is correct; only its location is wrong                                                                                 |
| 4   | **Screenshots were never taken.** `docs/guide.md` describes every panel in prose and `docs/img/` does not exist                                                                                                                                                                                             | A reader who wants to recognise a panel before opening it                                                                                              |
| 5   | **`extension/.gitignore` ships inside the `.vsix`** (about 200 bytes). Harmless, but it is noise that a `.vscodeignore` line would remove                                                                                                                                                                   | Nothing functional                                                                                                                                     |
| 6   | **The dashboard reads three endpoints per project with no incremental refresh.** Ten projects cost 31 requests; the five-minute cache hides it, but a workspace with fifty projects will feel it, and the throttle will pace it at 20/min                                                                   | Large workspaces                                                                                                                                       |
| 7   | **The secret scan reads every text file under 512 KB on each run**, with no caching and no incremental mode. On this repository that is fast; on a monorepo with a large `docs/` it will not be                                                                                                             | The Checks section in a big repository                                                                                                                 |
| 8   | **`pip-audit` is probed by running it.** On a machine where the probe is slow, the Checks button feels unresponsive for a second or two before anything is reported                                                                                                                                         | Python projects                                                                                                                                        |

No open bug tasks in Plane at v0.1.0 — the two items labelled `bug` (PCODE-73, PCODE-74) are closed.
If that changes, list the references here.

## Not tested on

| Platform                                        | State                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows 11**                                  | Where everything was built and run. The e2e suite also passes from a path with a space and an umlaut, and through an 8.3 short path                                                                                                   |
| **Ubuntu**                                      | CI runs lint, unit, build, package and the e2e suite under xvfb on every push. Nobody has used it interactively                                                                                                                       |
| **macOS**                                       | CI runs lint and unit tests only — **no e2e, no manual use, ever**. The POSIX-specific code (`python3` rather than `py -3`, POSIX quoting, case-sensitive paths) is unit-tested but has never run on a Mac. Treat macOS as unverified |
| **VS Code forks** (Cursor, Windsurf, VS Codium) | Untried. The extension uses no proprietary API, so it should work, but "should" is the operative word                                                                                                                                 |
| **Remote / WSL / Codespaces**                   | `extensionKind: ["workspace"]` is set, which is the right answer for an extension that spawns a local engine, but no remote scenario has been exercised                                                                               |

## Candidates for the next release

Roughly in the order that would repay the effort.

1. **A Windows installer.** One `Orqiva-Setup.exe` (Inno Setup) that installs the engine, checks
   Python/Node/Claude Code, sets `PLANE_CLAUDE_HOME`, registers the hooks, installs the bundled
   `.vsix` and adds a Start-menu entry. Most of the logic exists in `install.py`; this is packaging,
   not new behaviour, and it is what makes a clean-machine test possible at all.
2. **Publish to the Marketplace**, and add a release workflow that attaches the `.vsix` to a GitHub
   release on a tag.
3. **Automated security tests** rather than a checklist a person ticks: run the secret scan and
   `npm audit` in CI and fail the build on a high finding, and add a test that the CSP of every panel
   carries a nonce and no remote origin (today only `host.ts` is covered directly).
4. **Team features.** Everything assumes one developer on one machine: the active task is a local file,
   the folder map is per machine, and nothing shows who else has a task open. Multi-developer would
   need the engine to answer "who has this" and the board to show it.
5. **Incremental refresh** for the dashboard and the secret scan (issue 6 and 7 above).
6. **Screenshots and a short screencast** for the guide (issue 4).
7. **A VS Code fork of one's own** — the idea from the original description, worth revisiting only if
   the extension turns out to be constrained by the editor rather than by its own scope. Nothing found
   in v0.1.0 argues for it yet.
8. **Plane webhooks instead of polling**, so the board reacts immediately and the 20 req/min ceiling
   stops mattering. Depends on the Plane instance exposing them.

## What was deliberately left out

- **The extension never writes to Plane.** Anything that looks like a missing feature (edit an item's
  title, drag between states) is that rule, not an oversight — it belongs in the engine.
- **No credential is ever stored outside SecretStorage or the engine's DPAPI store**, which is why
  there is no "remember my token" anywhere and why deploy targets are committed without their tokens.
- **Automated checks never tick a checklist item.** A machine can report; a person decides.
