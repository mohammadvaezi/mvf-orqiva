-- ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
-- Why:  from the first alert to the postmortem. Monitoring sends alerts, grouped by a key; a serious one
--       opens an incident with a numbered timeline, roles and status updates (for the team, or for the
--       client's status page). On-call rotations say who is paged, overrides swap a shift, absences from
--       Time skip a person, and escalation steps page the next one when nobody acknowledges. Service level
--       objectives keep their error budget. All of it is the team's; the client's status page reads only
--       what is meant for the client.

ALTER TABLE workspaces ADD COLUMN next_incident_no integer NOT NULL DEFAULT 1;

CREATE TABLE incidents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  number           integer NOT NULL,
  project_id       uuid REFERENCES projects (id) ON DELETE SET NULL,
  environment_id   uuid REFERENCES environments (id) ON DELETE SET NULL,
  severity         text NOT NULL CHECK (severity IN ('sev1', 'sev2', 'sev3', 'sev4')),
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  state            text NOT NULL DEFAULT 'investigating'
                   CHECK (state IN ('investigating', 'identified', 'mitigated', 'resolved')),
  commander_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  comms_id         uuid REFERENCES users (id) ON DELETE SET NULL,
  declared_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  declared_at      timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  mitigated_at     timestamptz,
  resolved_at      timestamptz,
  -- the deploy the team found to be the cause
  cause_deploy_id  uuid REFERENCES deploy_runs (id) ON DELETE SET NULL,
  -- how far escalation has gone: the step last paged (0: the primary)
  escalation_step  integer NOT NULL DEFAULT 0,
  escalated_at     timestamptz NOT NULL DEFAULT now(),
  postmortem       text NOT NULL DEFAULT '' CHECK (length(postmortem) <= 100000),
  postmortem_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  postmortem_shared boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, number)
);
CREATE INDEX incidents_open ON incidents (workspace_id, declared_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX incidents_project ON incidents (project_id, declared_at DESC);

CREATE TABLE alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid REFERENCES projects (id) ON DELETE SET NULL,
  environment_id uuid REFERENCES environments (id) ON DELETE SET NULL,
  source        text NOT NULL CHECK (length(source) BETWEEN 1 AND 60),
  -- alerts with the same key while one is open are one alert seen more often
  dedupe_key    text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  severity      text NOT NULL CHECK (severity IN ('sev1', 'sev2', 'sev3', 'sev4')),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  count         integer NOT NULL DEFAULT 1,
  first_at      timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  incident_id   uuid REFERENCES incidents (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX alerts_open_key ON alerts (workspace_id, dedupe_key) WHERE status = 'open';

CREATE TABLE incident_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  incident_id   uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  at            timestamptz NOT NULL DEFAULT now(),
  author_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('alert', 'declared', 'ack', 'note', 'state', 'role', 'update',
                  'suspect', 'rollback', 'escalated', 'resolved')),
  text          text NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
  data          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX incident_events_incident ON incident_events (incident_id, at);

CREATE TABLE incident_updates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  incident_id     uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  audience        text NOT NULL CHECK (audience IN ('team', 'client')),
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  next_update_at  timestamptz,
  author_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incident_updates_incident ON incident_updates (incident_id, created_at DESC);

CREATE TABLE oncall_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- the projects whose incidents page this rotation; empty: all
  project_ids    uuid[] NOT NULL DEFAULT '{}',
  -- people in turn; the next one is the backup
  member_ids     uuid[] NOT NULL DEFAULT '{}',
  rotation_days  integer NOT NULL DEFAULT 7 CHECK (rotation_days BETWEEN 1 AND 28),
  handoff_time   time NOT NULL DEFAULT '09:00',
  timezone       text NOT NULL DEFAULT 'Europe/Berlin' CHECK (length(timezone) <= 64),
  -- the first turn starts here
  starts_on      date NOT NULL DEFAULT current_date,
  -- [{ "afterMinutes": 10, "target": "backup" }, { "afterMinutes": 20, "target": "user", "userId": "…" }]
  escalation     jsonb NOT NULL DEFAULT '[{"afterMinutes": 10, "target": "backup"}, {"afterMinutes": 20, "target": "admins"}]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX oncall_schedules_name ON oncall_schedules (workspace_id, lower(name));

-- a swap: someone takes over a span of a rotation
CREATE TABLE oncall_shifts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  schedule_id   uuid NOT NULL REFERENCES oncall_schedules (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  reason        text NOT NULL DEFAULT '' CHECK (length(reason) <= 200),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX oncall_shifts_schedule ON oncall_shifts (schedule_id, starts_at);

CREATE TABLE slos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  -- availability: minutes without a SEV-1/2 incident; deploys: share of successful deploys
  indicator      text NOT NULL CHECK (indicator IN ('availability', 'deploys')),
  objective_pct  numeric(6, 3) NOT NULL CHECK (objective_pct > 0 AND objective_pct < 100),
  window_days    integer NOT NULL DEFAULT 30 CHECK (window_days BETWEEN 1 AND 365),
  created_at     timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incidents', 'alerts', 'incident_events', 'incident_updates', 'oncall_schedules',
      'oncall_shifts', 'slos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
