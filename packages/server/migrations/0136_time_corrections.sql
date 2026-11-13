-- ── [PCODE-344 | S15 | v0.1.0] T34.3b Timer idle detection, time reminders, correction reasons for locked weeks ──
-- Why:  minutes away from a running timer are taken off it; a submitted or approved week is corrected only
--       with a reason, kept with the hours before and after; and each time reminder is sent once.

ALTER TABLE time_entries ADD COLUMN idle_minutes integer NOT NULL DEFAULT 0 CHECK (idle_minutes BETWEEN 0 AND 1440);

CREATE TABLE time_corrections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day             date NOT NULL,
  item_id         uuid REFERENCES items (id) ON DELETE SET NULL,
  project_id      uuid REFERENCES projects (id) ON DELETE SET NULL,
  label           text NOT NULL DEFAULT '',
  before_minutes  integer NOT NULL CHECK (before_minutes >= 0),
  after_minutes   integer NOT NULL CHECK (after_minutes >= 0),
  reason          text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  sheet_state     text NOT NULL CHECK (sheet_state IN ('submitted', 'approved')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_corrections_user_day ON time_corrections (workspace_id, user_id, day);

CREATE TABLE time_reminders (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('day', 'week')),
  key           text NOT NULL CHECK (length(key) <= 20),
  at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, kind, key)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['time_corrections', 'time_reminders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode())
      WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())', t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
