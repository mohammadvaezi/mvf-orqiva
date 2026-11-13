-- ── [PCODE-187 | S15 | v0.1.0] B7.3 Time live: timer from the active task, weekly timesheets with approval and lock, rates, absences, reports per client ──
-- Why:  time without typing it twice. Work in the IDE (pe start … pe done) already leaves a work session;
--       when one ends, the database turns it into a time entry on the task, whoever ended it. A web timer
--       is an entry that is still running. Weeks are submitted and approved, which locks them and keeps
--       the rates of that moment. Absences feed capacity. Time is the team's: clients see it only as the
--       totals the portal chooses to show.

CREATE TABLE time_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id          uuid REFERENCES items (id) ON DELETE SET NULL,
  project_id       uuid REFERENCES projects (id) ON DELETE SET NULL,
  -- work for no task: "Reviews and pairing"
  label            text NOT NULL DEFAULT '' CHECK (length(label) <= 200),
  day              date NOT NULL,
  minutes          integer NOT NULL DEFAULT 0 CHECK (minutes BETWEEN 0 AND 1440),
  billable         boolean NOT NULL DEFAULT false,
  note             text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  source           text NOT NULL CHECK (source IN ('timer', 'ide', 'manual')),
  work_session_id  uuid UNIQUE REFERENCES work_sessions (id) ON DELETE SET NULL,
  -- a running timer has started_at and no ended_at
  started_at       timestamptz,
  ended_at         timestamptz,
  auto_stopped     boolean NOT NULL DEFAULT false,
  -- booked into a week that was already approved (from the IDE): the manager sees it
  after_lock       boolean NOT NULL DEFAULT false,
  -- kept when the week is approved
  rate_cents       bigint CHECK (rate_cents >= 0),
  cost_cents       bigint CHECK (cost_cents >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (item_id IS NOT NULL OR project_id IS NOT NULL OR label <> '')
);
CREATE UNIQUE INDEX time_entries_one_timer ON time_entries (user_id) WHERE started_at IS NOT NULL AND ended_at IS NULL;
CREATE INDEX time_entries_user_day ON time_entries (workspace_id, user_id, day);
CREATE INDEX time_entries_project_day ON time_entries (project_id, day);

CREATE TABLE timesheets (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- the Monday of the week
  week          date NOT NULL CHECK (extract(isodow FROM week) = 1),
  state         text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'submitted', 'approved', 'returned')),
  submitted_at  timestamptz,
  decided_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at    timestamptz,
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  PRIMARY KEY (workspace_id, user_id, week)
);

CREATE TABLE absences (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  -- an afternoon off counts as half a day
  half_day      boolean NOT NULL DEFAULT false,
  kind          text NOT NULL CHECK (kind IN ('holiday', 'sick', 'appointment', 'other')),
  state         text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'approved', 'declined')),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  decided_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK (NOT half_day OR starts_on = ends_on)
);
CREATE INDEX absences_user ON absences (workspace_id, user_id, starts_on);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['time_entries', 'timesheets', 'absences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;

-- an IDE session that ends becomes time on its task (billable when the project has a client)
CREATE FUNCTION work_session_time() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    mins integer;
    d date;
    proj uuid;
    has_client boolean;
    locked boolean;
  BEGIN
    IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL THEN
      RETURN NEW;
    END IF;
    mins := least(720, ceil(extract(epoch FROM (NEW.ended_at - NEW.started_at)) / 60.0))::integer;
    IF mins < 1 THEN
      RETURN NEW;
    END IF;
    d := (NEW.started_at AT TIME ZONE 'Europe/Berlin')::date;
    SELECT i.project_id, p.client_id IS NOT NULL INTO proj, has_client
      FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = NEW.item_id;
    SELECT EXISTS (
      SELECT 1 FROM timesheets s WHERE s.workspace_id = NEW.workspace_id AND s.user_id = NEW.user_id
        AND s.week = d - (extract(isodow FROM d)::integer - 1) AND s.state IN ('submitted', 'approved')
    ) INTO locked;
    INSERT INTO time_entries (workspace_id, user_id, item_id, project_id, day, minutes, billable, source,
        work_session_id, started_at, ended_at, after_lock)
      VALUES (NEW.workspace_id, NEW.user_id, NEW.item_id, proj, d, mins, coalesce(has_client, false), 'ide',
        NEW.id, NEW.started_at, NEW.ended_at, locked)
      ON CONFLICT (work_session_id) DO NOTHING;
    RETURN NEW;
  END $$;

CREATE TRIGGER work_session_time AFTER UPDATE OF ended_at ON work_sessions
  FOR EACH ROW EXECUTE FUNCTION work_session_time();
