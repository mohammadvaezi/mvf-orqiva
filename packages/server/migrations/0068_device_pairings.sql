-- ── [PCODE-224 | S15 | v0.1.0] T21.1 Phone sign-in by pairing code, device tokens, QR code in the web app ──
-- Why:  a phone signs in by a pairing code that a signed-in person makes in the web app, so SSO, MFA and
--       passwords stay in the browser. The code is kept only as a hash, lives 10 minutes and works once;
--       redeeming it makes a personal token bound to the workspace, with the expiry the token policy
--       allowed when the code was made. Only the server itself (system mode) reads or writes the table.

CREATE TABLE device_pairings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash         text NOT NULL UNIQUE,
  expires_at        timestamptz NOT NULL,
  token_expires_at  timestamptz,
  used_at           timestamptz,
  token_id          uuid REFERENCES api_tokens (id) ON DELETE SET NULL,
  device            text CHECK (length(device) BETWEEN 1 AND 60),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_pairings_user ON device_pairings (user_id, workspace_id);

ALTER TABLE device_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_pairings FORCE ROW LEVEL SECURITY;
CREATE POLICY system_only ON device_pairings USING (in_system_mode()) WITH CHECK (in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON device_pairings TO prodengine_app;
