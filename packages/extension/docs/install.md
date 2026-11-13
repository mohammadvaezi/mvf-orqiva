<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- ── [PCODE-6 | S01 | v0.1.0] Write README, docs/install.md and the docs/smoke.md sprint checklist ── -->
<!-- ── [PCODE-68 | S14 | v0.1.0] Write the user documentation: install, setup, daily loop, release and deploy ── -->

# Install Orqiva

Twenty minutes from a fresh machine to a running loop. You need a Plane instance you can reach and an
account on it; everything else is installed here.

The extension never talks to Plane for anything the engine can do, so the engine goes on first.

## 1. The engine

Orqiva drives the Python engine in the `plane\claude` folder — `plane sync`, `start`, `done`, the
planning run, the fingerprint scanner, and the Claude Code hooks that enforce the loop.

Copy that folder anywhere (`C:\Tools\plane-claude` is fine) and double-click **`PlaneClaude.bat`**:

1. **Programs** — installs Python 3, Node.js and Claude Code if they are missing. Sign in to Claude
   Code once, in its own window.
2. **Connect** — the Plane address, the workspace slug, and an API key from
   _Plane → Profile → Personal access tokens_.

The key is stored encrypted with Windows DPAPI in `secrets.bin`, readable only by the Windows user who
stored it. It is never written to a settings file, a log, or this repository. **Type it into the
Connect field — never into a terminal command, a chat window or a file**, because each of those keeps
a copy you will forget about.

Connect also sets `PLANE_CLAUDE_HOME`, installs the `plane` command on your PATH and registers the
Claude Code hooks. Close and reopen any terminal afterwards so it picks up the new environment.

## 2. The extension

Take `orqiva-<version>.vsix` from the CI artifact (or build it with `npm run package`) and either

- VS Code → Extensions view → `···` → **Install from VSIX…**, or
- `code --install-extension orqiva-<version>.vsix`

Reload the window. A **Orqiva** icon appears in the activity bar.

## 3. Check the machine

Command Palette → **Orqiva: Check this computer**. It reports Python, Node.js, git, Claude Code and
the engine folder, and links to the installer for anything missing. Everything it lists is required
except Docker, which only the Docker and Deploy panels use.

If the engine lives somewhere unusual, or the report cannot find it:

```jsonc
// Settings (JSON)
"orqiva.engineHome": "C:\\Tools\\plane-claude",
"orqiva.pythonPath": "python"        // optional: only when `py -3` / `python3` is wrong
```

## 4. Connect the extension

**Orqiva: Connect Plane** asks for the same three things. The address and the workspace are ordinary
settings (`orqiva.plane.baseUrl`, `orqiva.plane.workspace`); the key goes to the editor's own
SecretStorage, which is separate from the engine's copy on purpose — neither can read the other's.

**Orqiva: Forget the legacy tracker key** removes it again.

## 5. A project

Open the folder you want to work in, then either

- **Orqiva: New project** — creates the project in Plane with the state set the loop needs
  (Backlog, Todo, In Progress, Review, Test, Blocked, Done, Cancelled) and scaffolds `.plane/` here, or
- **Orqiva: Link this folder to a Plane project** — points this folder at a project that exists.

Either writes `.plane/project.json`, which is committed: everyone who clones the repository works
against the same board.

A folder without a plan yet: **Orqiva: Plan the project** — see
[the guide](guide.md#planning-a-new-project).

## 6. Run it

Open the folder in VS Code. The Sprints view lists today's items; **Start development** opens Claude
Code in the integrated terminal with the engine's environment, and the loop runs from there.

Carry on with **[the daily guide](guide.md)**.

## Upgrading

Install the newer `.vsix` over the old one and reload. Settings, the stored key and every `.plane/`
folder are untouched. The engine upgrades separately: replace its folder and run `install.py` again.

## Uninstalling

Uninstall the extension in VS Code, and **Forget the legacy tracker key** first if you want the key gone from
SecretStorage. `.plane/` stays in your repositories — it is part of them, not of the extension.
