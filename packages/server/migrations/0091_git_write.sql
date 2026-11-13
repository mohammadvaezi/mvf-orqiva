-- ── [PCODE-288 | S15 | v0.1.0] T30.2 Design tokens exported as a pull request (GitHub, Gitea) ──
-- Why:  a connection can write to its repository when an admin gives it an API token (kept sealed with
--       the server key, never shown again) and, for a self-hosted host, the API address; every token
--       export that opened a pull request is kept with its link.

ALTER TABLE git_connections
  ADD COLUMN api_url    text CHECK (api_url IS NULL OR api_url ~ '^https?://[^\s]+$'),
  ADD COLUMN api_token  text;

CREATE TABLE token_exports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  connection_id  uuid REFERENCES git_connections (id) ON DELETE SET NULL,
  repo           text NOT NULL,
  branch         text NOT NULL,
  pull_number    integer,
  pull_url       text NOT NULL DEFAULT '',
  files          text[] NOT NULL DEFAULT '{}',
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX token_exports_project ON token_exports (project_id, created_at DESC);

ALTER TABLE token_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON token_exports
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON token_exports AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON token_exports TO prodengine_app;
