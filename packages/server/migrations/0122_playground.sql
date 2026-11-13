-- ── [PCODE-329 | S15 | v0.1.0] T33.2 Agent playground: rerun with other settings, compare runs, A/B experiments ──
-- Why:  a playground run tries an agent safely: it may read, but every action is only recorded as what it
--       would have done. It can be a rerun of another run, with its own model, prompt version and
--       temperature; an experiment runs one instruction with a few such variants, each a few times.

CREATE TABLE agent_experiments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  item_id       uuid REFERENCES items (id) ON DELETE SET NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  instruction   text NOT NULL CHECK (length(instruction) BETWEEN 1 AND 20000),
  -- [{ label, model, promptVersion, temperature }]
  variants      jsonb NOT NULL CHECK (jsonb_typeof(variants) = 'array'),
  repeats       integer NOT NULL DEFAULT 1 CHECK (repeats BETWEEN 1 AND 5),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_experiments_ws ON agent_experiments (workspace_id, created_at DESC);

ALTER TABLE agent_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_experiments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON agent_experiments
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON agent_experiments AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_experiments TO prodengine_app;

ALTER TABLE agent_runs
  ADD COLUMN playground    boolean NOT NULL DEFAULT false,
  ADD COLUMN rerun_of      uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  -- the run's own model, taking precedence over the connection's
  ADD COLUMN model_pinned  boolean NOT NULL DEFAULT false,
  ADD COLUMN temperature   real CHECK (temperature IS NULL OR temperature BETWEEN 0 AND 1),
  ADD COLUMN experiment_id uuid REFERENCES agent_experiments (id) ON DELETE CASCADE,
  ADD COLUMN variant       text NOT NULL DEFAULT '' CHECK (length(variant) <= 40);
CREATE INDEX agent_runs_experiment ON agent_runs (experiment_id) WHERE experiment_id IS NOT NULL;
