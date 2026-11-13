-- ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
-- Why:  Web Push needs the server's own VAPID key pair (kept sealed with the server's key, made once), each
--       person's browsers that subscribed, which notifications each person wants, and how far the push
--       dispatcher has read every workspace's events (taken with SKIP LOCKED, so two servers never send the
--       same notification twice). push_sent keeps notifications that must not repeat, such as "gate ready".

CREATE TABLE instance_keys (
  name               text PRIMARY KEY,
  public_value       text NOT NULL,
  secret_ciphertext  text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint    text NOT NULL CHECK (length(endpoint) <= 2000),
  p256dh      text NOT NULL CHECK (length(p256dh) <= 200),
  auth        text NOT NULL CHECK (length(auth) <= 100),
  device      text NOT NULL DEFAULT '' CHECK (length(device) <= 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz
);
CREATE UNIQUE INDEX push_subscriptions_endpoint ON push_subscriptions (endpoint);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

CREATE TABLE push_preferences (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  approvals  boolean NOT NULL DEFAULT true,
  gates      boolean NOT NULL DEFAULT true,
  deploys    boolean NOT NULL DEFAULT true,
  mentions   boolean NOT NULL DEFAULT true
);

CREATE TABLE push_cursors (
  workspace_id   uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  last_sequence  bigint NOT NULL
);

CREATE TABLE push_sent (
  dedupe_key  text PRIMARY KEY,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

-- the cursors belong to a workspace: the same row-level security as every workspace table
ALTER TABLE push_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_cursors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON push_cursors
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON push_cursors TO prodengine_app;
