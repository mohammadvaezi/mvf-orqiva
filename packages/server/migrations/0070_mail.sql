-- ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
-- Why:  email is one more channel next to in-app and push. Mails wait in a queue and go out with retries,
--       so a slow or absent mail server never holds up a request. Password resets work once, for an hour,
--       stored as a hash. Tokens about to expire and the daily digest are sent once each. Only the server
--       itself (system mode) reads or writes these tables: they hold addresses and links.

CREATE TABLE mail_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES workspaces (id) ON DELETE CASCADE,
  to_address    text NOT NULL CHECK (length(to_address) BETWEEN 3 AND 254),
  subject       text NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
  text_body     text NOT NULL CHECK (length(text_body) <= 100000),
  html_body     text NOT NULL DEFAULT '' CHECK (length(html_body) <= 200000),
  kind          text NOT NULL CHECK (kind IN ('test', 'reset', 'invitation', 'notice', 'digest', 'token', 'status')),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts      integer NOT NULL DEFAULT 0,
  next_at       timestamptz NOT NULL DEFAULT now(),
  last_error    text NOT NULL DEFAULT '' CHECK (length(last_error) <= 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);
CREATE INDEX mail_outbox_due ON mail_outbox (next_at) WHERE status = 'pending';
CREATE INDEX mail_outbox_workspace ON mail_outbox (workspace_id, created_at DESC);

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  -- 'mail' when the person asked; 'admin' when an admin made a link to hand over
  made_by     text NOT NULL CHECK (made_by IN ('mail', 'admin')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user ON password_resets (user_id);

CREATE TABLE mail_digests (
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  day           date NOT NULL,
  PRIMARY KEY (user_id, workspace_id, day)
);

ALTER TABLE api_tokens ADD COLUMN expiry_notice_at timestamptz;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mail_outbox', 'password_resets', 'mail_digests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY system_only ON %I USING (in_system_mode()) WITH CHECK (in_system_mode())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
