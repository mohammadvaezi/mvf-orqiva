-- ── [PCODE-161 | S15 | v0.1.0] B0 data model v2: model for all approved screens and the foundation migrations ──
-- Why:  the People section: more built-in roles (tester, designer, billing, auditor), custom roles made of
--       permissions with optional conditions, teams, a role per project that overrides the workspace role,
--       and a profile per member (skills, capacity, time zone, working and quiet hours, manager, cost rate)
--       that Planning, Canvas, Time and notifications read.

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'workspace_members'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%role%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE workspace_members DROP CONSTRAINT %I', c);
  END IF;
END $$;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('owner', 'admin', 'member', 'tester', 'designer', 'billing', 'auditor', 'guest'));

CREATE TABLE roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  -- what the role starts from; permissions add to or narrow it
  base_role     text NOT NULL CHECK (base_role IN ('admin', 'member', 'tester', 'designer', 'billing', 'auditor', 'guest')),
  permissions   text[] NOT NULL DEFAULT '{}',
  -- e.g. {"deploy_production": {"weekdays": [1,2,3,4,5], "hours": [8, 18]}}
  conditions    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX roles_name ON roles (workspace_id, lower(name));

ALTER TABLE workspace_members ADD COLUMN custom_role_id uuid REFERENCES roles (id) ON DELETE SET NULL;

CREATE TABLE teams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  parent_id     uuid REFERENCES teams (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX teams_name ON teams (workspace_id, lower(name));

CREATE TABLE team_members (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  is_lead       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE project_members (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('lead', 'member', 'tester', 'designer', 'viewer')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user ON project_members (user_id);

CREATE TABLE member_profiles (
  workspace_id          uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title                 text NOT NULL DEFAULT '' CHECK (length(title) <= 120),
  skills                text[] NOT NULL DEFAULT '{}',
  capacity_hours_week   numeric(5, 2) NOT NULL DEFAULT 40 CHECK (capacity_hours_week BETWEEN 0 AND 80),
  focus_factor          numeric(3, 2) NOT NULL DEFAULT 0.75 CHECK (focus_factor BETWEEN 0 AND 1),
  timezone              text NOT NULL DEFAULT 'Europe/Berlin' CHECK (length(timezone) <= 64),
  -- {"mon": ["08:00", "17:00"], …}; quiet hours for notifications
  working_hours         jsonb NOT NULL DEFAULT '{}'::jsonb,
  quiet_hours           jsonb NOT NULL DEFAULT '{"from": "20:00", "to": "07:30", "except": ["incident"]}'::jsonb,
  manager_id            uuid REFERENCES users (id) ON DELETE SET NULL,
  -- internal cost per hour in euro cents, for budgets and margins
  cost_rate_cents       bigint CHECK (cost_rate_cents >= 0),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles', 'teams', 'team_members', 'project_members', 'member_profiles'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;

-- a client contact never sees the team's internal structure
CREATE POLICY client_scope ON roles AS RESTRICTIVE USING (current_client_id() IS NULL);
CREATE POLICY client_scope ON teams AS RESTRICTIVE USING (current_client_id() IS NULL);
CREATE POLICY client_scope ON team_members AS RESTRICTIVE USING (current_client_id() IS NULL);
CREATE POLICY client_scope ON member_profiles AS RESTRICTIVE USING (current_client_id() IS NULL);
CREATE POLICY client_scope ON project_members AS RESTRICTIVE
  USING (current_client_id() IS NULL OR project_id IN (SELECT id FROM projects WHERE client_id = current_client_id()));
