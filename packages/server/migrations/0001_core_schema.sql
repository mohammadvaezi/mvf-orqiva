-- ── [PCODE-87 | S15 | v0.1.0] Create the PostgreSQL schema v1 with our own migration runner and row-level security ──
-- Why:  the first tables of the platform. Every tenant table carries workspace_id and is protected by
--       row-level security that is FORCED (it applies to the table owner too). The server reaches tenant
--       data only as the role prodengine_app with app.workspace_id set for the transaction, so a query
--       that forgets its WHERE clause still sees one workspace only. No extensions: gen_random_uuid() is
--       core PostgreSQL since version 13.

-- the role every workspace-scoped transaction switches to (SET LOCAL ROLE); it cannot log in
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'prodengine_app') THEN
    CREATE ROLE prodengine_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
GRANT prodengine_app TO CURRENT_USER;

-- the workspace of the running transaction, or NULL when none is set (then no tenant row is visible)
CREATE FUNCTION current_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid $$;

-- system mode: global operations (sign-up, login lookup) by the owner, never by prodengine_app.
-- The server connects as a NON-superuser owner, so FORCE ROW LEVEL SECURITY binds it too: a stray
-- RESET ROLE inside a workspace transaction still sees that one workspace, not all of them.
CREATE FUNCTION in_system_mode() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT current_user <> 'prodengine_app' AND current_setting('app.system', true) = 'on' $$;

CREATE TABLE workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- people are global: one account can belong to several workspaces
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  password_hash  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE workspace_members (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user ON workspace_members (user_id);

CREATE TABLE projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  key           text NOT NULL CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

CREATE TABLE items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  sequence      integer NOT NULL CHECK (sequence > 0),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
  description   text NOT NULL DEFAULT '',
  state         text NOT NULL DEFAULT 'backlog',
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, sequence)
);
CREATE INDEX items_workspace ON items (workspace_id);

-- ── row-level security: every table with a workspace_id, forced, one policy each ──
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON workspaces
  USING (id = current_workspace_id() OR in_system_mode())
  WITH CHECK (id = current_workspace_id() OR in_system_mode());

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON workspace_members
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON projects
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON items
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

-- the app role works on rows; it never changes the schema
GRANT USAGE ON SCHEMA public TO prodengine_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspaces, workspace_members, projects, items TO prodengine_app;
GRANT SELECT ON users TO prodengine_app;
GRANT EXECUTE ON FUNCTION current_workspace_id(), in_system_mode() TO prodengine_app;
