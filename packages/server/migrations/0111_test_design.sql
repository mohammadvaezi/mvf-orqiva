-- ── [PCODE-313 | S15 | v0.1.0] T32.1 Test repository: shared steps, parameters in the screen, structured BDD ──
-- Why:  steps many cases share (log in, open the cart) are written once per project and referenced from the
--       cases (a step {"shared": id} in step_list); a BDD case keeps its Gherkin, from which its steps and
--       parameters are made.

CREATE TABLE test_shared_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  -- [{ "action": "...", "expected": "..." }]
  steps         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(steps) = 'array'),
  version       integer NOT NULL DEFAULT 1,
  updated_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

ALTER TABLE test_shared_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_shared_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON test_shared_steps
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON test_shared_steps AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON test_shared_steps TO prodengine_app;

ALTER TABLE test_cases ADD COLUMN gherkin text NOT NULL DEFAULT '' CHECK (length(gherkin) <= 50000);
