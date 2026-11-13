-- ── [PCODE-92 | S15 | v0.1.0] Add workspaces, projects, members and roles to the API ──
-- Why:  people see each other only through a shared workspace: users get row-level security too, so a
--       workspace transaction can read the people of that workspace and no one else. Guests are invited to
--       single projects. Every project gets the default states of the board, and the item counter that
--       numbers its items (PCODE-1, PCODE-2 …) lives on the project row, so numbering is safe under load.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY people ON users FOR SELECT
  USING (id IN (SELECT user_id FROM workspace_members WHERE workspace_id = current_workspace_id()));
-- sign-up, login and profile changes run in system mode, which sees and changes everyone
CREATE POLICY people_system ON users
  USING (in_system_mode()) WITH CHECK (in_system_mode());

ALTER TABLE projects ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN next_item_seq integer NOT NULL DEFAULT 1 CHECK (next_item_seq > 0);
ALTER TABLE projects ADD COLUMN archived_at timestamptz;

-- a guest sees only the projects listed here; members and above see every project of the workspace
CREATE TABLE project_guests (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
ALTER TABLE project_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_guests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON project_guests
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

-- the board's states, per project, in the groups the loop has used since v0.1.0
CREATE TABLE project_states (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  grp           text NOT NULL CHECK (grp IN ('backlog', 'unstarted', 'started', 'completed', 'cancelled')),
  color         text NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  position      integer NOT NULL,
  UNIQUE (project_id, name)
);
ALTER TABLE project_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_states FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON project_states
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

-- activity events name the object they happened within (the project of an item, the item of a comment),
-- so a project's or an item's history is one indexed query
ALTER TABLE activity_events ADD COLUMN parent_type text;
ALTER TABLE activity_events ADD COLUMN parent_id text;
CREATE INDEX activity_events_parent ON activity_events (workspace_id, parent_type, parent_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_guests, project_states TO prodengine_app;
