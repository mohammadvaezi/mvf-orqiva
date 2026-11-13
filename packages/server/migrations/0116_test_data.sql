-- ── [PCODE-318 | S15 | v0.1.0] T32.4b Masking of personal data in test results and the test-data vault ──
-- Why:  the values tests need (accounts, test cards, sample data) kept once per project, sealed with the
--       server key like environment secrets. Steps name them as {{data:name}}; a sensitive value is shown
--       only when a tester reveals it, and who did last is kept.

CREATE TABLE test_data (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_.-]{0,40}$'),
  value_sealed  text NOT NULL,
  sensitive     boolean NOT NULL DEFAULT true,
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  updated_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  revealed_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  revealed_at   timestamptz,
  UNIQUE (project_id, name)
);

ALTER TABLE test_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_data FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON test_data
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON test_data AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON test_data TO prodengine_app;
