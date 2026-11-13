-- ── [PCODE-128 | S15 | v0.1.0] Add capacity, velocity and the sprint planning agent ──
-- Why:  a sprint is planned against what the team can do: each person's capacity in points for the sprint.
--       Velocity is not stored; it is measured from finished sprints whenever it is asked for.

CREATE TABLE sprint_capacity (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  sprint_id     uuid NOT NULL REFERENCES sprints (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  points        integer NOT NULL CHECK (points BETWEEN 0 AND 1000),
  PRIMARY KEY (sprint_id, user_id)
);

ALTER TABLE sprint_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE sprint_capacity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON sprint_capacity
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON sprint_capacity TO prodengine_app;
