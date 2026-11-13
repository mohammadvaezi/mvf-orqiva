-- ── [PCODE-115 | S15 | v0.1.0] Add settings and user management: profile, password, tokens, members, invitations, project settings ──
-- Why:  a workspace grows by invitation: an admin invites an email address with a role and hands over a
--       single-use link (valid 7 days); the invited person sets name and password, or signs in, and joins.
--       Only the hash of the link's token is stored, like sessions and API tokens. Accepting happens
--       before the person is a member, so it runs in system mode; everything else is tenant-scoped.

CREATE TABLE invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  email         text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  role          text NOT NULL CHECK (role IN ('admin', 'member', 'guest')),
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  revoked_at    timestamptz
);
CREATE INDEX invitations_workspace ON invitations (workspace_id, created_at);
-- one open invitation per address and workspace
CREATE UNIQUE INDEX invitations_open ON invitations (workspace_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON invitations
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE ON invitations TO prodengine_app;
