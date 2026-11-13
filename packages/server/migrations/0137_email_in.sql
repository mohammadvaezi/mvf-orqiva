-- ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
-- Why:  mail comes in through the mail provider's webhook with a workspace key; a notice about a message
--       carries a Reply-To address whose token says the conversation and the person; a project has an
--       address for ideas; and each mail received is logged with what became of it.

CREATE TABLE email_inbound (
  workspace_id  uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  domain        text NOT NULL CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  key_hash      text NOT NULL,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_tokens (
  token         text PRIMARY KEY CHECK (token ~ '^[a-z0-9]{16,64}$'),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('reply', 'ideas')),
  user_id       uuid REFERENCES users (id) ON DELETE CASCADE,
  channel_id    uuid REFERENCES channels (id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES messages (id) ON DELETE CASCADE,
  project_id    uuid REFERENCES projects (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'reply') = (user_id IS NOT NULL AND channel_id IS NOT NULL)),
  CHECK ((kind = 'ideas') = (project_id IS NOT NULL))
);
CREATE UNIQUE INDEX email_tokens_reply ON email_tokens (user_id, channel_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE kind = 'reply';
CREATE UNIQUE INDEX email_tokens_ideas ON email_tokens (project_id) WHERE kind = 'ideas';

CREATE TABLE email_inbound_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  at            timestamptz NOT NULL DEFAULT now(),
  sender        text NOT NULL DEFAULT '' CHECK (length(sender) <= 254),
  recipient     text NOT NULL DEFAULT '' CHECK (length(recipient) <= 254),
  subject       text NOT NULL DEFAULT '' CHECK (length(subject) <= 300),
  outcome       text NOT NULL CHECK (outcome IN ('message', 'idea', 'refused')),
  detail        text NOT NULL DEFAULT '' CHECK (length(detail) <= 500)
);
CREATE INDEX email_inbound_log_ws ON email_inbound_log (workspace_id, at DESC);

ALTER TABLE mail_outbox ADD COLUMN reply_to text NOT NULL DEFAULT '' CHECK (length(reply_to) <= 254);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_inbound', 'email_tokens', 'email_inbound_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode())
      WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())', t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
