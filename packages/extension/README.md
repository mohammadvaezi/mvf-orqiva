<!-- [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names -->
<!-- [PCODE-222 | S15 | v0.1.0] T20.4 Marketplace listings prepared: single-file orq, release assembly, VS Code, container image and Helm listings -->

# Orqiva for VS Code

Your Orqiva tasks, inbox, agents and findings in the editor, with your code. Orqiva is a self-hosted
engineering command center. This extension connects VS Code to your team's Orqiva server.

**The rule it helps you keep:** no code without a task, the task's state follows the work, and every block
of code carries the task, sprint and version it was written for.

## What you get

- **The task loop.** Sync, start a task, write the code, mark it done. Each step is one click in the
  sidebar, and it runs the same loop as the `orq` command line and the Claude Code hooks, so all three share
  one active task.
- **Fingerprints.** Insert the active task's fingerprint above a block. Lenses above fingerprints show the
  task, and who else is working on it.
- **The task panel.** The description, acceptance criteria with their test results, and comments, which
  can also be written for the client to read.
- **Inbox.** What waits for you: approvals your agents ask for, mentions, gates to sign and incidents.
  Approve or decline an agent without leaving the editor.
- **Agents.** This project's agent runs, step by step. Ask an agent to work on the active task, or stop a
  run.
- **Findings in the Problems panel.** Secrets, code rules and dependency findings appear as squiggles on
  their line, with a quick fix that turns one into a task.
- **Code map lenses.** Each file's hot-spot score, health, how often it changed and the tasks behind it.
- **Tests.** Run the test command once; every result goes to Orqiva and shows next to its acceptance
  criterion.
- **Timer, ideas, releases.** The timer in the status bar, ideas with the interviewer, handover status,
  and promotions between environments.

Everything updates live from the server. There is no refresh timer.

## Get started

1. You need an Orqiva server (self-hosted; free for up to 5 people) and the `orq` command line.
2. In a terminal, sign in once: `orq login --server https://orqiva.your-company.example`
3. In your repository: `orq link APP`, using your project's key.
4. Open the folder in VS Code. The Orqiva sidebar shows the project's board, and the status bar shows the
   active task.

The extension reads the same two files as the command line: `.orqiva/project.json` in the folder, and the
sign-in token from `orq login`. It never asks for a password.

## Commands

All commands start with **Orqiva:** in the Command Palette. The most used ones:

| Command                                        | What it does                                              |
| ---------------------------------------------- | --------------------------------------------------------- |
| Orqiva: Sync                                   | Sends waiting updates and recovers the active task        |
| Orqiva: Start / Done                           | Starts a task, or finishes it after a fingerprint scan    |
| Orqiva: Insert fingerprint for the active task | Writes the fingerprint comment at the cursor              |
| Orqiva: Ask an agent                           | Asks an agent to work on the active task                  |
| Orqiva: Run the tests and report them          | Runs your test command and sends every result             |
| Orqiva: Note an idea                           | Writes an idea down; the interviewer asks what is missing |

## Requirements

- VS Code 1.90 or newer.
- An Orqiva server you can reach, and the `orq` command line for `login` and `link`.

## Privacy

In a linked folder the extension talks to your Orqiva server. It calls other addresses only for features
you set up yourself: a deploy target, or a health URL to check. It collects no usage data.

Folders that still use the earlier setup (the legacy tracker and the Python engine) keep working as before; see the
extension's own guide.
