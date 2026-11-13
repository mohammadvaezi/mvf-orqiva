-- ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
-- Why:  the kit as the code uses it: per component, where it is used (from the last scan); per project,
--       the colours and sizes written by hand that the last scan found, and when it ran.

ALTER TABLE ui_components
  ADD COLUMN usage_files      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN usage_scanned_at timestamptz;

CREATE TABLE kit_scans (
  project_id    uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  files         integer NOT NULL DEFAULT 0,
  findings      integer NOT NULL DEFAULT 0,
  scanned_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  scanned_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kit_findings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  path          text NOT NULL CHECK (length(path) BETWEEN 1 AND 500),
  line          integer NOT NULL CHECK (line > 0),
  kind          text NOT NULL CHECK (kind IN ('colour', 'size')),
  value         text NOT NULL CHECK (length(value) <= 100),
  token         text CHECK (token IS NULL OR length(token) <= 100)
);
CREATE INDEX kit_findings_project ON kit_findings (project_id, path, line);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kit_scans', 'kit_findings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
