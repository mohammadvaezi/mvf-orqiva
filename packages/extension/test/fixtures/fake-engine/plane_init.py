# -- [PCODE-30 | S06 | v0.1.0] Add New project and Link project commands calling plane_init.py --
#    Fake plane_init.py: --list prints two projects; --name/--project write a real .plane/project.json into
#    the cwd (no fixture flag, so the store picks it up) and print the same lines as the engine.
"""Fake plane_init.py for Orqiva tests. No network, no git."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECTS = [{"identifier": "FIX", "name": "Fixture"}, {"identifier": "LTR", "name": "Letterman"}]


# [PCODE-30 | S06 | v0.1.0] main: record the call, then answer like the real plane_init.py would
def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    argv = sys.argv[1:]
    # own file: run.test.ts reads calls.jsonl's last line, and vitest runs the files in parallel
    with open(os.path.join(HERE, "init-calls.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"script": "plane_init.py", "argv": argv, "cwd": os.getcwd(),
                            "has_key": bool(os.environ.get("PLANE_API_KEY"))}) + "\n")
    if "--list" in argv:
        print(json.dumps(PROJECTS))
        return
    opts = {argv[i]: argv[i + 1] for i in range(0, len(argv) - 1, 2) if argv[i].startswith("--")}
    if "--project" in opts:
        wanted = opts["--project"].upper()
        found = next((p for p in PROJECTS if p["identifier"] == wanted), None)
        if not found:
            print("No Plane project with identifier %s. Existing: FIX, LTR" % wanted, file=sys.stderr)
            sys.exit(1)
        print("Linked Plane project %s (%s)" % (found["name"], found["identifier"]))
        ident, name = found["identifier"], found["name"]
    else:
        name = opts.get("--name") or os.path.basename(os.getcwd())
        ident = (opts.get("--identifier") or name[:5]).upper()
        print("Created Plane project %s (%s)" % (name, ident))
        print("States added: Backlog, Todo, In Progress, Review, Test, Blocked, Done, Cancelled")
        print("Labels added: feature, bug, chore, test, hotfix")
    root = os.getcwd()
    os.makedirs(os.path.join(root, ".plane", "state"), exist_ok=True)
    with open(os.path.join(root, ".plane", "project.json"), "w", encoding="utf-8") as f:
        json.dump({"workspace": "ws", "project_id": "00000000-0000-4000-8000-0000000000aa",
                   "identifier": ident, "name": name, "version": "0.1.0"}, f, indent=2)
    print("Scaffolded: .plane/project.json, .plane/rules.md")
    print("Ready: %s" % os.path.join(root, ".plane"))
    print("Board: https://plane.example.test/ws/projects/0/issues/")


if __name__ == "__main__":
    main()
