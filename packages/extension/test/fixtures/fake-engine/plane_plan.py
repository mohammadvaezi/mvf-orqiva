# -- [PCODE-31 | S06 | v0.1.0] Build the plan panel: description status, Draft, Check and Publish --
# -- [PCODE-34 | S06 | v0.1.0] Publish the plan with confirmation, single-flight guard and result summary --
#    Fake plane_plan.py: `check` summarises the cwd's .plane/plan.json the way the engine does (errors when the
#    plan carries "fake_errors"), `draft --print-only` and `publish --yes` answer with canned lines.
"""Fake plane_plan.py for Orqiva tests. No network, no Claude."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def summary(plan):
    n = sum(len(s.get("items") or []) for s in plan["sprints"])
    return "%d sprint(s), %d item(s), %s to %s, version %s" % (
        len(plan["sprints"]), n, plan["sprints"][0].get("date"), plan["sprints"][-1].get("date"),
        plan.get("version", "0.1.0"))


# [PCODE-31 | S06 | v0.1.0] main: record the call, then answer like the real plane_plan.py would
def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    argv = sys.argv[1:]
    with open(os.path.join(HERE, "plan-calls.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"script": "plane_plan.py", "argv": argv, "cwd": os.getcwd(),
                            "has_key": bool(os.environ.get("PLANE_API_KEY"))}) + "\n")
    cmd = argv[0] if argv else ""
    root = os.getcwd()
    plan_file = os.path.join(root, ".plane", "plan.json")
    if cmd == "check":
        if not os.path.exists(plan_file):
            print("no plan.json yet")
            sys.exit(1)
        with open(plan_file, encoding="utf-8") as f:
            plan = json.load(f)
        pub = os.path.join(root, ".plane", "state", "published.json")
        at = None
        if os.path.exists(pub):
            with open(pub, encoding="utf-8") as f:
                at = json.load(f).get("at")
        print(summary(plan) + ("; published %s" % at if at else "; not yet published"))
        errs = plan.get("fake_errors") or []
        for e in errs:
            print("- " + e)
        sys.exit(1 if errs else 0)
    if cmd == "draft":
        print("claude --permission-mode acceptEdits --append-system-prompt-file .plane/state/plan_prompt.txt")
        return
    if cmd == "publish":
        # [PCODE-34 | S06 | v0.1.0] same lines as plane_plan.cmd_publish
        with open(plan_file, encoding="utf-8") as f:
            plan = json.load(f)
        print(summary(plan))
        n = 0
        for s in plan["sprints"]:
            print("%s: %d new item(s)" % (s["name"], len(s.get("items") or [])))
            n += len(s.get("items") or [])
        os.makedirs(os.path.join(root, ".plane", "state"), exist_ok=True)
        with open(os.path.join(root, ".plane", "state", "published.json"), "w", encoding="utf-8") as f:
            json.dump({"items": {}, "at": "2026-01-01T10:00:00"}, f)
        print("Published: %d sprint(s), %d item(s) created. Board: https://plane.example.test/ws/projects/0/issues/"
              % (len(plan["sprints"]), n))
        return
    print("unknown command %s" % cmd)
    sys.exit(2)


if __name__ == "__main__":
    main()
