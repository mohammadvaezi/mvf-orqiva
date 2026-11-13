-- ── [PCODE-342 | S15 | v0.1.0] T34.2c AI postmortems and runbooks matched to incidents ──
-- Why:  a runbook says what to do when a known problem comes back; its trigger words match it to the
--       incidents whose title or alerts carry them, for one project or all.

CREATE TABLE runbooks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid REFERENCES projects (id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  pattern       text NOT NULL CHECK (length(pattern) BETWEEN 2 AND 500),
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runbooks_workspace ON runbooks (workspace_id, title);
ALTER TABLE runbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE runbooks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON runbooks
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON runbooks AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON runbooks TO prodengine_app;
