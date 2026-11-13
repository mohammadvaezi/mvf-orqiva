-- ── [PCODE-339 | S15 | v0.1.0] T34.1d Portal magic-link sign-in and passwordless invitations, MFA required per client ──
-- Why:  a client contact signs in with a link sent by email, single use and short-lived; a client can
--       require its contacts to use a second factor, set up during that sign-in.

CREATE TABLE login_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash       text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  kind             text NOT NULL CHECK (kind IN ('signin', 'enrol')),
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_links_user ON login_links (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON login_links TO prodengine_app;

ALTER TABLE clients ADD COLUMN require_mfa boolean NOT NULL DEFAULT false;

ALTER TABLE mail_outbox DROP CONSTRAINT mail_outbox_kind_check;
ALTER TABLE mail_outbox ADD CONSTRAINT mail_outbox_kind_check
  CHECK (kind IN ('test', 'reset', 'invitation', 'notice', 'digest', 'token', 'status', 'signin'));
