-- ── [PCODE-302 | S15 | v0.1.0] T31.3 PR review queue (riskiest first) and side-by-side diff with fingerprints and viewed files ──
-- Why:  a pull request's changed files are read through the host's API once per head commit and kept, so
--       reviewers do not wait on the host and the queue knows which paths a change touches. Each person marks
--       files viewed; the mark keeps the patch's hash and lapses when a new push changes that file.

ALTER TABLE pull_requests
  ADD COLUMN files_sha text CHECK (files_sha IS NULL OR length(files_sha) <= 64),
  ADD COLUMN files_read_at timestamptz,
  -- the host had more files than are kept
  ADD COLUMN files_truncated boolean NOT NULL DEFAULT false;

CREATE TABLE pull_request_files (
  pull_request_id uuid NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
  path            text NOT NULL CHECK (length(path) BETWEEN 1 AND 1000),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  position        integer NOT NULL,
  old_path        text CHECK (old_path IS NULL OR length(old_path) <= 1000),
  status          text NOT NULL CHECK (status IN ('added', 'modified', 'deleted', 'renamed')),
  additions       integer NOT NULL DEFAULT 0,
  deletions       integer NOT NULL DEFAULT 0,
  is_binary       boolean NOT NULL DEFAULT false,
  -- the hunks as unified text; empty for a binary file, a pure rename or a patch too big to keep
  patch           text NOT NULL DEFAULT '' CHECK (length(patch) <= 400000),
  too_big         boolean NOT NULL DEFAULT false,
  patch_hash      text NOT NULL,
  PRIMARY KEY (pull_request_id, path)
);

CREATE TABLE pull_request_views (
  pull_request_id uuid NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  path            text NOT NULL CHECK (length(path) BETWEEN 1 AND 1000),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  patch_hash      text NOT NULL,
  viewed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pull_request_id, user_id, path)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pull_request_files', 'pull_request_views'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
