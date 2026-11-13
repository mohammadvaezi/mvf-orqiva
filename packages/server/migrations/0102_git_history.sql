-- ── [PCODE-300 | S15 | v0.1.0] T31.2a Git history from the webhooks: commits, branches, tags; close on merge; revert detection ──
-- Why:  the history of a connected repository as the webhooks tell it: every commit, the branches and tags
--       with the commit they point at, the default branch; which commit reverted which.

ALTER TABLE git_connections ADD COLUMN default_branch text CHECK (default_branch IS NULL OR length(default_branch) <= 250);

CREATE TABLE git_commits (
  connection_id  uuid NOT NULL REFERENCES git_connections (id) ON DELETE CASCADE,
  sha            text NOT NULL CHECK (sha ~ '^[0-9a-f]{7,64}$'),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  message        text NOT NULL DEFAULT '' CHECK (length(message) <= 10000),
  author         text NOT NULL DEFAULT '' CHECK (length(author) <= 200),
  committed_at   timestamptz NOT NULL,
  url            text NOT NULL DEFAULT '' CHECK (length(url) <= 500),
  -- the branch it was first pushed to
  branch         text NOT NULL DEFAULT '' CHECK (length(branch) <= 250),
  -- added, modified and removed paths, when the host says
  files          jsonb,
  reverts        text CHECK (reverts IS NULL OR reverts ~ '^[0-9a-f]{7,64}$'),
  reverted_by    text CHECK (reverted_by IS NULL OR reverted_by ~ '^[0-9a-f]{7,64}$'),
  seen_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, sha)
);
CREATE INDEX git_commits_time ON git_commits (project_id, committed_at DESC);

CREATE TABLE git_refs (
  connection_id  uuid NOT NULL REFERENCES git_connections (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('branch', 'tag')),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 250),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  sha            text NOT NULL DEFAULT '' CHECK (sha = '' OR sha ~ '^[0-9a-f]{7,64}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, kind, name)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['git_commits', 'git_refs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
