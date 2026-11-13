<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->

# CLAUDE.md

<!-- [PCODE-109 | S15 | v0.1.0] Move PCODE into Orqiva and retire Plane for this project -->

## Project management: Orqiva is the single source of truth

Tracked on our own Orqiva server as **Orqiva** (`PCODE`): http://localhost:8480 (installed on this
machine with `pe install` before the rename, Docker Compose in `~/prodengine`; `orq install` keeps using that
folder, its database and volumes). Plane holds the history up to 3 Oct 2026 as a
**read-only archive** (`.orqiva/legacy/plane-archive.json`); nothing writes to it any more.
Rules, criticals, architecture and design system: `.orqiva/` (read `.orqiva/rules.md` first; where it says
`plane`, use `orq`).

**The loop (the orq hooks in `.claude/settings.json` enforce it):** `sync` → `start <ID>` or
`new "title" --desc-file f.md --start` → code with fingerprints → `done <ID>`. Editing a code file without
an active task is refused.

`orq` is `node "C:/Broszio Apps/planecode/packages/cli/dist/main.js"` (rebuild with `npm run build`).

```
orq sync                            # send waiting updates, recover the active task
orq list                            # open tasks, active sprint first
orq show PCODE-12
orq new "Title" --desc-file desc.md [--start]
orq start PCODE-12
orq status PCODE-12 review|test|blocked|todo  [--note "why"]
orq note PCODE-12 "decision or blocker"
orq done PCODE-12 [--force]         # scan fingerprints, commit, report; --force for a task without code
```

**Fingerprint** (one per file header per task, one above every block written for the task):
`[PCODE-12 | S15 | v0.1.0] short title` inside the language's comment syntax, e.g.
`# ── [PCODE-12 | S15 | v0.1.0] Order editing: reprice from POS payload ──`. `orq start` prints the exact one.

## Product direction

<!-- [PCODE-81 | S08 | v0.1.0] Commit the Orqiva 2027 strategy, development plan and sprint plan to the repository -->

**Product direction (from 2 Oct 2026):** Orqiva becomes a self-hosted, real-time engineering command
center with its own server, replacing Plane at M1 (23 Dec 2026). Full plan:
`docs/strategy/orqiva-2027-plan.md`; short roadmap and sprint table: `.orqiva/roadmap.md`. Read both
before planning or starting work on the new platform.
