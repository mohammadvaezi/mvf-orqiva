# Rules (fixture)

<!-- fixed:start -->
## The development loop (enforced by hooks)

1. **Sync first.** Every session starts with `plane sync`.
2. **No code without a task.** Start or create a Plane item before editing code.
3. **One active task per session.**

```settings
review_before_done: false
auto_test_state: true
unguarded_paths: [.plane/, docs/, CLAUDE.md, .gitignore, README]
```
<!-- fixed:end -->

## Project rules

Fixture project used by the Orqiva e2e tests. Nothing here is real.
