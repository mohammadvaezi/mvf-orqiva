-- ── [PCODE-234 | S15 | v0.1.0] T23.1 Messaging core on the server: channels, direct messages, threads, mentions, live delivery ──
-- Why:  the team's conversations live in Orqiva itself (owner decision, 11 Oct 2026): channels for the
--       workspace, a project or a client, private channels, and direct and group messages, with threads,
--       reactions, mentions and files. Messages never enter the activity feed, so a private conversation
--       stays private. Who sees a channel:
--         * a workspace channel: every member except guests;
--         * a project channel: the members, and the guests invited to that project;
--         * a client channel: the team and that client's contacts;
--         * a private channel or a direct message: its members only.
--       A client contact (app.client_id set) sees nothing but its client's channels, enforced here.

CREATE TABLE channels (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('channel', 'direct')),
  name             text CHECK (name IS NULL OR name ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  topic            text NOT NULL DEFAULT '' CHECK (length(topic) <= 500),
  project_id       uuid REFERENCES projects (id) ON DELETE CASCADE,
  client_id        uuid REFERENCES clients (id) ON DELETE CASCADE,
  private          boolean NOT NULL DEFAULT false,
  -- a direct message's people, sorted: one conversation per set of people
  dm_key           text,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz,
  archived_at      timestamptz,
  CHECK ((kind = 'channel') = (name IS NOT NULL)),
  CHECK ((kind = 'direct') = (dm_key IS NOT NULL)),
  CHECK (kind = 'channel' OR (private AND project_id IS NULL AND client_id IS NULL))
);
CREATE UNIQUE INDEX channels_name ON channels (workspace_id, name) WHERE kind = 'channel';
CREATE UNIQUE INDEX channels_dm ON channels (workspace_id, dm_key) WHERE kind = 'direct';
CREATE INDEX channels_project ON channels (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX channels_client ON channels (client_id) WHERE client_id IS NOT NULL;

CREATE TABLE channel_members (
  channel_id    uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  last_read_at  timestamptz NOT NULL DEFAULT now(),
  muted         boolean NOT NULL DEFAULT false,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX channel_members_user ON channel_members (user_id, workspace_id);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  channel_id       uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  -- a reply in a thread names the message the thread hangs on
  parent_id        uuid REFERENCES messages (id) ON DELETE CASCADE,
  author_id        uuid REFERENCES users (id) ON DELETE SET NULL,
  body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  file_ids         uuid[] NOT NULL DEFAULT '{}',
  -- the task this message became
  item_id          uuid REFERENCES items (id) ON DELETE SET NULL,
  reply_count      integer NOT NULL DEFAULT 0,
  last_reply_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  search           tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
);
CREATE INDEX messages_channel ON messages (channel_id, created_at DESC) WHERE parent_id IS NULL;
CREATE INDEX messages_thread ON messages (parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX messages_search ON messages USING gin (search);

CREATE TABLE message_reactions (
  message_id    uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  emoji         text NOT NULL CHECK (length(emoji) BETWEEN 1 AND 32),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE message_mentions (
  message_id    uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX message_mentions_user ON message_mentions (user_id, workspace_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['channels', 'channel_members', 'messages', 'message_reactions', 'message_mentions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;

-- a client contact sees its client's channels and what is in them, nothing else
CREATE POLICY client_scope ON channels AS RESTRICTIVE
  USING (current_client_id() IS NULL OR client_id = current_client_id());
CREATE POLICY client_scope ON channel_members AS RESTRICTIVE
  USING (current_client_id() IS NULL
         OR channel_id IN (SELECT id FROM channels WHERE client_id = current_client_id()));
CREATE POLICY client_scope ON messages AS RESTRICTIVE
  USING (current_client_id() IS NULL
         OR channel_id IN (SELECT id FROM channels WHERE client_id = current_client_id()));
CREATE POLICY client_scope ON message_reactions AS RESTRICTIVE
  USING (current_client_id() IS NULL
         OR message_id IN (SELECT m.id FROM messages m JOIN channels c ON c.id = m.channel_id
                           WHERE c.client_id = current_client_id()));
CREATE POLICY client_scope ON message_mentions AS RESTRICTIVE
  USING (current_client_id() IS NULL
         OR message_id IN (SELECT m.id FROM messages m JOIN channels c ON c.id = m.channel_id
                           WHERE c.client_id = current_client_id()));

-- who may see a channel: the rule above, in one place for every query and the live gateway
CREATE FUNCTION sees_channel(ch channels, u uuid, member_role text) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (SELECT 1 FROM channel_members m WHERE m.channel_id = ch.id AND m.user_id = u)
        OR (ch.kind = 'channel' AND NOT ch.private AND (
              (ch.project_id IS NULL AND ch.client_id IS NULL AND member_role <> 'guest')
           OR (ch.project_id IS NOT NULL AND (member_role <> 'guest'
                 OR EXISTS (SELECT 1 FROM project_guests g WHERE g.project_id = ch.project_id AND g.user_id = u)))
           OR (ch.project_id IS NULL AND ch.client_id IS NOT NULL AND (member_role <> 'guest'
                 OR EXISTS (SELECT 1 FROM client_contacts cc WHERE cc.client_id = ch.client_id AND cc.user_id = u)))
        ))
  $$;
GRANT EXECUTE ON FUNCTION sees_channel(channels, uuid, text) TO prodengine_app;

-- direct messages notify through the inbox as their own kind
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'inbox_items'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%approval%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE inbox_items DROP CONSTRAINT %I', c);
  END IF;
END $$;
ALTER TABLE inbox_items ADD CONSTRAINT inbox_items_kind_check
  CHECK (kind IN ('approval', 'review', 'mention', 'question', 'signoff', 'request', 'test', 'incident', 'message'));
