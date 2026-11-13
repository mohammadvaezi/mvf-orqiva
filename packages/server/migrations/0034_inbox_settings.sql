-- ── [PCODE-161 | S15 | v0.1.0] B0 data model v2: model for all approved screens and the foundation migrations ──
-- Why:  the shell's state that belongs to a person: the inbox (one row per person and thing that waits for
--       them, so done, snooze and undo survive devices), notification rules per kind and channel, settings
--       that inherit from workspace to team, project and person, and saved views for any list.

CREATE TABLE inbox_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('approval', 'review', 'mention', 'question', 'signoff', 'request', 'test', 'incident')),
  project_id    uuid REFERENCES projects (id) ON DELETE CASCADE,
  object_type   text NOT NULL CHECK (length(object_type) <= 40),
  object_id     text NOT NULL CHECK (length(object_id) <= 120),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  detail        text NOT NULL DEFAULT '' CHECK (length(detail) <= 4000),
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal')),
  state         text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'done', 'snoozed')),
  snooze_until  timestamptz,
  due_at        timestamptz,
  -- the activity event that put it here; one entry per person and event
  event_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz,
  done_at       timestamptz
);
CREATE INDEX inbox_items_open ON inbox_items (user_id, state, created_at DESC);
CREATE UNIQUE INDEX inbox_items_event ON inbox_items (user_id, event_id) WHERE event_id IS NOT NULL;

CREATE TABLE notification_rules (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_kind    text NOT NULL CHECK (length(event_kind) BETWEEN 1 AND 60),
  channels      text[] NOT NULL DEFAULT '{in_app}'
                  CHECK (channels <@ ARRAY['in_app', 'email', 'push', 'slack', 'teams', 'ide']::text[]),
  PRIMARY KEY (workspace_id, user_id, event_kind)
);

-- one value per scope; the most specific scope wins (person, project, team, workspace)
CREATE TABLE settings (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  scope_type    text NOT NULL CHECK (scope_type IN ('workspace', 'team', 'project', 'user')),
  scope_id      uuid NOT NULL,
  key           text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_.]{1,79}$'),
  value         jsonb NOT NULL,
  updated_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, scope_type, scope_id, key)
);

-- saved views for every list (items, activity, findings, time …), private or shared
ALTER TABLE saved_filters ADD COLUMN surface text NOT NULL DEFAULT 'items' CHECK (length(surface) BETWEEN 1 AND 40);
ALTER TABLE saved_filters ADD COLUMN shared boolean NOT NULL DEFAULT false;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inbox_items', 'notification_rules', 'settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;

CREATE POLICY client_scope ON settings AS RESTRICTIVE USING (current_client_id() IS NULL);
