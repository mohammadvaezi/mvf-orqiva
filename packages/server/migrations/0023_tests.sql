-- ── [PCODE-135 | S15 | v0.1.0] Add test cases from acceptance criteria and test runs ──
-- Why:  test management inside the project: cases tied to the task and the acceptance criterion they
--       check, so coverage of requirements can be counted; runs that collect a result per case, whether
--       a person enters them, a report is imported, or a suite streams them while it runs.

CREATE TABLE test_cases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  item_id       uuid REFERENCES items (id) ON DELETE SET NULL,
  criterion_id  uuid REFERENCES item_criteria (id) ON DELETE SET NULL,
  -- how automated results find the case: "suite > test name"; empty for hand-written cases
  key           text NOT NULL DEFAULT '' CHECK (length(key) <= 500),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  steps         text NOT NULL DEFAULT '' CHECK (length(steps) <= 20000),
  expected      text NOT NULL DEFAULT '' CHECK (length(expected) <= 5000),
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'criteria', 'agent', 'import')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX test_cases_key ON test_cases (project_id, key) WHERE key <> '';
CREATE INDEX test_cases_item ON test_cases (item_id);

CREATE TABLE test_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'stream', 'junit')),
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'cancelled')),
  started_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX test_runs_project ON test_runs (project_id, started_at);

CREATE TABLE test_results (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  run_id        uuid NOT NULL REFERENCES test_runs (id) ON DELETE CASCADE,
  case_id       uuid NOT NULL REFERENCES test_cases (id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('passed', 'failed', 'skipped', 'blocked')),
  duration_ms   integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  message       text NOT NULL DEFAULT '' CHECK (length(message) <= 20000),
  at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, case_id)
);
CREATE INDEX test_results_case ON test_results (case_id, at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['test_cases', 'test_runs', 'test_results'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
