-- ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
-- Why:  the server does not hold the repository; `orq docs scan` sends the text of the few files pages need:
--       those code embeds name, and the README files the docs import. Kept per project, replaced by each
--       full scan.

CREATE TABLE code_texts (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  path          text NOT NULL CHECK (length(path) BETWEEN 1 AND 500),
  text          text NOT NULL CHECK (length(text) <= 300000),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  scanned_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, path)
);
ALTER TABLE code_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_texts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON code_texts
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON code_texts AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON code_texts TO prodengine_app;
