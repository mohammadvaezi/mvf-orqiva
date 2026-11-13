-- ── [PCODE-331 | S15 | v0.1.0] T33.3b Evals: saved cases with checks, eval runs per model or prompt version, pass rates over time ──
-- Why:  an agent's saved cases with what a good answer must and must not say, and how high the judge must
--       score it; each eval run runs every case in the playground with one set of settings, so a set's
--       history shows whether a change made the agent better.

CREATE TABLE agent_eval_sets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_eval_cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  set_id            uuid NOT NULL REFERENCES agent_eval_sets (id) ON DELETE CASCADE,
  instruction       text NOT NULL CHECK (length(instruction) BETWEEN 1 AND 20000),
  item_id           uuid REFERENCES items (id) ON DELETE SET NULL,
  must_contain      text[] NOT NULL DEFAULT '{}' CHECK (cardinality(must_contain) <= 20),
  must_not_contain  text[] NOT NULL DEFAULT '{}' CHECK (cardinality(must_not_contain) <= 20),
  min_judge         smallint CHECK (min_judge IS NULL OR min_judge BETWEEN 1 AND 5),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_eval_cases_set ON agent_eval_cases (set_id, created_at);

CREATE TABLE agent_eval_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  set_id        uuid NOT NULL REFERENCES agent_eval_sets (id) ON DELETE CASCADE,
  label         text NOT NULL DEFAULT '' CHECK (length(label) <= 60),
  -- { model, promptVersion, temperature } as the runs got them
  settings      jsonb NOT NULL DEFAULT '{}',
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_eval_runs_set ON agent_eval_runs (set_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_eval_sets', 'agent_eval_cases', 'agent_eval_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;

ALTER TABLE agent_runs
  ADD COLUMN eval_run_id  uuid REFERENCES agent_eval_runs (id) ON DELETE CASCADE,
  ADD COLUMN eval_case_id uuid REFERENCES agent_eval_cases (id) ON DELETE SET NULL;
CREATE INDEX agent_runs_eval ON agent_runs (eval_run_id) WHERE eval_run_id IS NOT NULL;
