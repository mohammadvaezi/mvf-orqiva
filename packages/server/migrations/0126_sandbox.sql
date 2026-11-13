-- ── [PCODE-333 | S15 | v0.1.0] T33.4b Sandbox per run with repo tools, pull requests by a bot Git identity ──
-- Why:  what a run writes stays in its own sandbox until a pull request takes it to a branch; the files go
--       with the run.

CREATE TABLE agent_run_files (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  run_id        uuid NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  path          text NOT NULL CHECK (length(path) BETWEEN 1 AND 300),
  text          text NOT NULL CHECK (length(text) <= 500000),
  -- the repository's text when the run first wrote the file, null for a new file
  base_text     text CHECK (base_text IS NULL OR length(base_text) <= 500000),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, path)
);
ALTER TABLE agent_run_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON agent_run_files
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON agent_run_files AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_run_files TO prodengine_app;

-- the pull request a run opened from its sandbox
ALTER TABLE agent_runs
  ADD COLUMN sandbox_pr_url text NOT NULL DEFAULT '' CHECK (length(sandbox_pr_url) <= 500),
  ADD COLUMN sandbox_branch text NOT NULL DEFAULT '' CHECK (length(sandbox_branch) <= 250);
