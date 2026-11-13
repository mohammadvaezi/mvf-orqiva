<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ── -->

# Orqiva

Orqiva is becoming a self-hosted engineering command center: one platform that carries every product
from idea to handover through gated stages, with people and AI agents working side by side and every
screen live. The plan is [docs/strategy/orqiva-2027-plan.md](docs/strategy/orqiva-2027-plan.md);
the short version and the sprint table are in [.orqiva/roadmap.md](.orqiva/roadmap.md).

**Ownership rule.** 100% our own code. The backend runs only on Node.js, PostgreSQL (through the `pg`
driver), Docker and Linux; nothing shipped may carry a licence that stops us selling it.

## Packages

| Package              | What it is                                                                            |
| -------------------- | ------------------------------------------------------------------------------------- |
| `packages/shared`    | Types, protocol and product identity used by every other package                      |
| `packages/server`    | The Orqiva server on Node.js built-ins (HTTP, live gateway, event bus, jobs)          |
| `packages/cli`       | `orq`: install, the task loop and the Claude Code hooks                               |
| `packages/web`       | The web app: the command center                                                       |
| `packages/extension` | The VS Code extension (v0.1.0, still on Plane until T05); see its own README and docs |

<!-- [PCODE-91 | S15 | v0.1.0] Package the server as a Docker Compose install started by `orq install` -->

Installing the server on a machine with Docker: [docs/install-server.md](docs/install-server.md)
(`orq install --build .`).

## Build, test, run

```
npm ci                    # installs and links every workspace
npm run check             # lint (tsc, eslint, prettier) + tests + build, for all packages
npm run build             # build only
node packages/server/dist/main.js          # server on :8080 (ORQIVA_PORT to change)
node packages/cli/dist/main.js --version   # pe
```

One package at a time: `npm test --workspace packages/server`. The extension's packaging and end-to-end
tests: `npm run package --workspace packages/extension`, `npm run test:e2e --workspace packages/extension`.

Development tools (TypeScript, esbuild, Vitest, ESLint, Prettier) never ship; they are `devDependencies`
of the root or of a package.
