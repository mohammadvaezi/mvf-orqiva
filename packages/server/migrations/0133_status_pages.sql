-- ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
-- Why:  a client's status page can be open to everyone at its own short name; and the words of incident
--       updates come from templates a workspace keeps.

ALTER TABLE clients
  ADD COLUMN status_public boolean NOT NULL DEFAULT false,
  ADD COLUMN status_slug   text UNIQUE CHECK (status_slug IS NULL OR status_slug ~ '^[a-z0-9][a-z0-9-]{1,40}$');

CREATE TABLE incident_update_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  audience      text NOT NULL DEFAULT 'client' CHECK (audience IN ('team', 'client')),
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
ALTER TABLE incident_update_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_update_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON incident_update_templates
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON incident_update_templates AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON incident_update_templates TO prodengine_app;
