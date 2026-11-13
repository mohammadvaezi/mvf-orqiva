-- ── [PCODE-132 | S15 | v0.1.0] Run deploys through our own runner and stream each step ──
-- Why:  a deploy is queued here and done by a runner on the customer's machine (pe runner), which drives
--       their own tools. Runners sign in with a token of their own (only its hash is kept). Every step a
--       runner takes is written as it happens, so people can watch a deploy step by step.

CREATE TABLE runners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_hash    text NOT NULL UNIQUE,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);

CREATE TABLE deploy_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  environment_id  uuid NOT NULL REFERENCES environments (id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  ref             text NOT NULL DEFAULT '' CHECK (length(ref) <= 200),
  -- 'manual', or the gate whose signature started it ('gate:g1')
  trigger         text NOT NULL DEFAULT 'manual' CHECK (length(trigger) <= 60),
  requested_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  runner_id       uuid REFERENCES runners (id) ON DELETE SET NULL,
  error           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
CREATE INDEX deploy_runs_queue ON deploy_runs (workspace_id, status, created_at);
CREATE INDEX deploy_runs_env ON deploy_runs (environment_id, created_at);

CREATE TABLE deploy_steps (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  run_id        uuid NOT NULL REFERENCES deploy_runs (id) ON DELETE CASCADE,
  seq           integer NOT NULL CHECK (seq > 0),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  command       text NOT NULL DEFAULT '' CHECK (length(command) <= 2000),
  status        text NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'skipped')),
  output        text NOT NULL DEFAULT '',
  exit_code     integer,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  PRIMARY KEY (run_id, seq)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['runners', 'deploy_runs', 'deploy_steps'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
