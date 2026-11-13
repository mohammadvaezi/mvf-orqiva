# -- [PCODE-8 | S02 | v0.1.0] Implement the engine runner: spawn, cwd, env passthrough, output, cancellation --
#    Fake engine: canned output per subcommand, every call recorded to calls.jsonl (never a key value).
"""Fake engine for Orqiva tests: prints canned output per subcommand, records every call.

No network, no Plane, no git. Each invocation appends one JSON line to calls.jsonl next to this
file: argv, cwd and whether PLANE_API_KEY was present (never its value).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

CANNED = {
    "sync": "Synced. 1 carried over, 0 moved to Todo. No active task.\n",
    "list": (
        "## Sprint 01 - Foundation (2026-01-01)\n"
        "- FIX-2 [In Progress] (medium) Add the greeting function\n"
        "- FIX-3 [Todo] (low) Add a farewell function\n"
        "\n"
        "Active: FIX-2 Add the greeting function\n"
    ),
    "show": (
        "# FIX-2 Add the greeting function\n"
        "State: In Progress | Priority: medium | https://plane.example.test/ws/projects/0/issues/2/\n"
        "\n"
        "Add greet(name) to src/sample.ts so the fixture has one function.\n"
        "\n"
        "Acceptance\n"
        "- ☐ greet('x') returns 'Hello x'\n"
        "\n"
        "## Comments (1, latest last)\n"
        "- 2026-01-01: Started by Claude Code on fixture-host (session 12345678). Version v0.1.0, Sprint 01 - Foundation.\n"
        "\n"
        "## Code fingerprinted for this task\n"
        "- src/sample.ts:2 (header)\n"
        "- src/sample.ts:8 (block)\n"
    ),
    "start": (
        "Active: FIX-2 Add the greeting function  [Todo -> In Progress]\n"
        "Fingerprint for every file/block you write: [FIX-2 | S01 | v0.1.0] Add the greeting function\n"
        "Description:\nAdd greet(name) to src/sample.ts so the fixture has one function.\n"
    ),
    "done": "Plane queue: 1 sent, 0 pending\nFIX-2 -> Review. 4 file(s), commit a1b2c3d. Index: .plane/fingerprints.md\n",
    "status": "FIX-2 -> Blocked. No active task now.\n",
    "note": "Noted on FIX-2.\n",
    "new": "Created FIX-9 New thing in Sprint 01 - Foundation -> https://plane.example.test/ws/projects/0/issues/9/\nNext: plane start FIX-9\n",
    "active": '{"task": "FIX-2", "issue_id": "00000000-0000-4000-8000-000000000002", "title": "Add the greeting function", "sprint": "S01", "sprint_name": "Sprint 01 - Foundation", "version": "0.1.0", "session_id": "fixture-session", "host": "fixture-host", "started_at": "2026-01-01T09:00:00", "files": ["src/sample.ts"], "url": "https://plane.example.test/ws/projects/0/issues/2/"}\n',
    "version": "Version 0.1.0 -> 0.1.1 (tag v0.1.1)\n",
}


# [PCODE-8 | S02 | v0.1.0] main: record the call, then answer like the real plane_task.py would
def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    argv = sys.argv[1:]
    with open(os.path.join(HERE, "calls.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"script": "plane_task.py", "argv": argv, "cwd": os.getcwd(),
                            "has_key": bool(os.environ.get("PLANE_API_KEY"))}) + "\n")
    cmd = argv[0] if argv else ""
    if cmd == "fail":
        print("ERROR: no task FIX-99 in Plane")
        sys.exit(2)
    if cmd == "sleep":
        import time
        time.sleep(float(argv[1]) if len(argv) > 1 else 30)
        return
    if cmd == "echo-env":
        print("key-present" if os.environ.get("PLANE_API_KEY") else "key-missing")
        return
    sys.stdout.write(CANNED.get(cmd, "unknown command %s\n" % cmd))


if __name__ == "__main__":
    main()
