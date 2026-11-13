-- ── [PCODE-148 | S15 | v0.1.0] Add signed licence keys with seats, features and expiry ──
-- Why:  a workspace's licence: the signed token as it was given, and its content as verified when it was
--       installed. The token is checked again whenever it is read, so a changed row is no licence at all.

CREATE TABLE workspace_licences (
  workspace_id  uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  token         text NOT NULL CHECK (length(token) BETWEEN 10 AND 5000),
  installed_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  installed_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspace_licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_licences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON workspace_licences
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_licences TO prodengine_app;
