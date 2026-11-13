-- ── [PCODE-297 | S15 | v0.1.0] T30.10 Figma two-way sync: variables and components, tested against recorded Figma answers ──
-- Why:  a project's link to a Figma file: the access token (sealed), the state both sides last agreed on
--       (the base of the three-way comparison), and the last comparison to show.

CREATE TABLE figma_links (
  project_id         uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  file_key           text NOT NULL CHECK (file_key ~ '^[A-Za-z0-9]{10,64}$'),
  api_token          text,
  api_url            text CHECK (api_url IS NULL OR length(api_url) <= 500),
  snapshot           jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan               jsonb,
  skipped            jsonb NOT NULL DEFAULT '[]'::jsonb,
  components_linked  integer NOT NULL DEFAULT 0,
  checked_at         timestamptz,
  pulled_at          timestamptz,
  pushed_at          timestamptz,
  linked_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE figma_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE figma_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON figma_links
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON figma_links AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON figma_links TO prodengine_app;
