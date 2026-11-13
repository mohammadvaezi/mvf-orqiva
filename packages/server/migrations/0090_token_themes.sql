-- ── [PCODE-287 | S15 | v0.1.0] T30.1 Design tokens: themes and modes, aliases, W3C import, iOS and Android export ──
-- Why:  a project's tokens have themes beyond light and dark (high contrast, a second brand), each built
--       on light or dark; a token keeps its own value only in the themes where it differs.

CREATE TABLE token_themes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (name ~ '^[a-z][a-z0-9-]{0,39}$' AND name NOT IN ('light', 'dark')),
  base          text NOT NULL DEFAULT 'light' CHECK (base IN ('light', 'dark')),
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

-- { "high-contrast": "#0000ff" }: only the themes where the token differs from the theme's base
ALTER TABLE design_tokens ADD COLUMN theme_values jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE token_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_themes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON token_themes
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON token_themes AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON token_themes TO prodengine_app;
