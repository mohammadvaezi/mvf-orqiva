-- ── [PCODE-161 | S15 | v0.1.0] B0 data model v2: model for all approved screens and the foundation migrations ──
-- Why:  clients become first-class: a workspace works for several clients, each with contacts in portal
--       roles, its own portal domain and branding, and a say in what it is shown. A project belongs to at
--       most one client. Isolation is enforced by PostgreSQL itself: a transaction opened for a client
--       contact carries app.client_id, and restrictive policies then hide every row of other clients and
--       every comment meant for the team only, whatever the API code asks for.

CREATE FUNCTION current_client_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.client_id', true), '')::uuid $$;

CREATE TABLE clients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name                text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  short_name          text NOT NULL CHECK (length(short_name) BETWEEN 1 AND 40),
  owner_id            uuid REFERENCES users (id) ON DELETE SET NULL,
  -- logo file, colours from the client's UI kit
  branding            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- the portal at the client's own domain (owner's decision at gate A1)
  portal_domain       text CHECK (portal_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  domain_verified_at  timestamptz,
  language            text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'de')),
  -- what the portal shows: roadmap, sprint summary, tests, release notes, budget, AI cost line …
  shares              jsonb NOT NULL DEFAULT '{"roadmap": true, "sprint_summary": true, "requested_tasks": true, "acceptance_tests": true, "release_notes": true, "budget": true, "ai_cost_line": true}'::jsonb,
  retention_days      integer CHECK (retention_days > 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz
);
CREATE UNIQUE INDEX clients_name ON clients (workspace_id, lower(name));
CREATE UNIQUE INDEX clients_domain ON clients (portal_domain) WHERE portal_domain IS NOT NULL;

CREATE TABLE client_contacts (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  portal_role   text NOT NULL CHECK (portal_role IN ('sponsor', 'approver', 'product_owner', 'tester', 'requester', 'viewer')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_id, portal_role)
);
CREATE INDEX client_contacts_user ON client_contacts (user_id);

ALTER TABLE projects ADD COLUMN client_id uuid REFERENCES clients (id) ON DELETE SET NULL;
CREATE INDEX projects_client ON projects (client_id) WHERE client_id IS NOT NULL;

-- a comment is for the team unless it is written for the client; internal notes never leave the team
ALTER TABLE comments ADD COLUMN visibility text NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'client'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients', 'client_contacts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;

-- client isolation: restrictive, so it narrows the tenant policy; without app.client_id nothing changes
CREATE POLICY client_scope ON clients AS RESTRICTIVE
  USING (current_client_id() IS NULL OR id = current_client_id());
CREATE POLICY client_scope ON client_contacts AS RESTRICTIVE
  USING (current_client_id() IS NULL OR client_id = current_client_id());
CREATE POLICY client_scope ON projects AS RESTRICTIVE
  USING (current_client_id() IS NULL OR client_id = current_client_id());
CREATE POLICY client_scope ON items AS RESTRICTIVE
  USING (current_client_id() IS NULL OR project_id IN (SELECT id FROM projects WHERE client_id = current_client_id()));
CREATE POLICY client_scope ON comments AS RESTRICTIVE
  USING (
    current_client_id() IS NULL
    OR (visibility = 'client'
        AND item_id IN (SELECT i.id FROM items i JOIN projects p ON p.id = i.project_id WHERE p.client_id = current_client_id()))
  );
