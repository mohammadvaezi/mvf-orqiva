-- ── [PCODE-264 | S15 | v0.1.0] T27.6 Canvas pictures and sharing: PNG and PDF with page fitting, read-only share link with iCal subscription ──
-- Why:  a project's plan shown to people without an account (a client, a steering board, a calendar): a link
--       with a secret token, kept only as its hash, that can end on a day or be withdrawn.

CREATE TABLE plan_shares (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label         text NOT NULL DEFAULT '' CHECK (length(label) <= 80),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_on    date,
  revoked_at    timestamptz,
  last_used_at  timestamptz
);
CREATE INDEX plan_shares_project ON plan_shares (project_id, created_at);
ALTER TABLE plan_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON plan_shares
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_shares TO prodengine_app;
