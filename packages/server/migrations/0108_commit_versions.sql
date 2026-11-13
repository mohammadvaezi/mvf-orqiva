-- ── [PCODE-306 | S15 | v0.1.0] T31.6 Versions from commits: conventional commits, tags and components per path ──
-- Why:  a monorepo's components each have a folder and a tag prefix and get their own versions; a release
--       belongs to a component (empty for the whole project), so two components may both have 1.2.0.

CREATE TABLE version_components (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES git_connections (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  -- the folder, without slashes at either end; empty for the whole repository
  folder        text NOT NULL DEFAULT '' CHECK (length(folder) <= 250 AND folder !~ '^/|/$'),
  tag_prefix    text NOT NULL DEFAULT 'v' CHECK (length(tag_prefix) <= 60),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

ALTER TABLE version_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE version_components FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON version_components
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON version_components AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON version_components TO prodengine_app;

ALTER TABLE releases ADD COLUMN component text NOT NULL DEFAULT '' CHECK (length(component) <= 60);
ALTER TABLE releases DROP CONSTRAINT releases_project_id_version_key;
ALTER TABLE releases ADD CONSTRAINT releases_project_component_version UNIQUE (project_id, component, version);
