-- ── [PCODE-296 | S15 | v0.1.0] T30.9 Accessibility checks: alt text, names, focus order, target size, in the code and on the page ──
-- Why:  per project the latest accessibility scan of the code, and the latest audit of each screen.

CREATE TABLE a11y_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source IN ('code', 'page')),
  -- the screen's name; '' for the code scan
  name          text NOT NULL DEFAULT '' CHECK (length(name) <= 120),
  url           text NOT NULL DEFAULT '' CHECK (length(url) <= 2000),
  title         text NOT NULL DEFAULT '' CHECK (length(title) <= 300),
  files         integer NOT NULL DEFAULT 0,
  checked       jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings      jsonb NOT NULL DEFAULT '[]'::jsonb,
  commit_sha    text NOT NULL DEFAULT '' CHECK (length(commit_sha) <= 64),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, source, name)
);

ALTER TABLE a11y_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE a11y_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON a11y_reports
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON a11y_reports AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON a11y_reports TO prodengine_app;
