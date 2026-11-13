<!-- [PCODE-222 | S15 | v0.1.0] the developer notes, moved out of the README (which is now the Marketplace listing) -->

# Developing the extension

## Documentation

|                                    |                                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[install.md](install.md)**       | From a fresh machine to a running loop: the engine, the extension, the connection, the first project                                                 |
| **[guide.md](guide.md)**           | The sidebar and the daily loop — sync, start, fingerprints, done — plus planning, code documentation, the security checks and the projects dashboard |
| **[release.md](release.md)**       | Version bump and changelog, Docker packaging, and deploying over Coolify or SSH                                                                      |
| [smoke.md](smoke.md)               | The manual checklist every sprint must pass on the packaged `.vsix`                                                                                  |
| [known-issues.md](known-issues.md) | What is not finished at v0.1.0, what is untested, and the candidates for the next release                                                            |
| `.plane/`                          | This project's own rules, criticals, architecture and design system                                                                                  |

## Build, run, test, package

```
npm ci && npm run build          # dist/extension.js (+ webviews)
npm run watch                    # rebuild on change; then F5 "Run Extension" (fixture workspace)
```

```
npm test                         # vitest: unit + fake-engine integration (npm test -- --coverage)
npm run test:e2e                 # @vscode/test-electron on test/fixtures/workspace (downloads VS Code once)
npm run lint                     # tsc --noEmit, eslint, prettier --check
```

<!-- [PCODE-61 | S12 | v0.1.0] Harden engine spawning for paths with spaces and non-Windows shells -->

`ORQIVA_TEST_WORKSPACE` points the e2e suite at another copy of the fixture — copy all of
`test/fixtures/` (the suite reaches a sibling `fake-engine`) somewhere whose path has a space and a
non-ASCII character, and run the suite against it before a release.

```
npm run package                  # orqiva-<version>.vsix
code --install-extension orqiva-0.1.0.vsix
```

`npm run check` = lint + test + build; CI runs it on Windows and Ubuntu and uploads the `.vsix`.

## Where the engine lives

The extension spawns the Python engine; it never reimplements it. It is found through the
`orqiva.engineHome` setting, else the `PLANE_CLAUDE_HOME` environment variable that the engine's
`install.py` sets. Python comes from `orqiva.pythonPath`, else `py -3` / `python3` / `python`.

More: [docs/install.md](install.md) (install and connect), [docs/smoke.md](smoke.md) (the
manual checklist every sprint must pass), `.plane/` (rules, criticals, architecture, design system).
