-- ── [PCODE-289 | S15 | v0.1.0] T30.3 Brand pages: colour, type, voice, logo use, do and don't ──
-- Why:  a project's brand book: the words the team writes per section, and do and don't examples
--       (a picture and a caption each). Colours, type and logos come from the tokens and assets.

CREATE TABLE brand_sections (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  section       text NOT NULL CHECK (section IN ('overview', 'colour', 'type', 'voice', 'logo')),
  body          text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  updated_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, section)
);

CREATE TABLE brand_examples (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('do', 'dont')),
  file_id       uuid REFERENCES files (id) ON DELETE SET NULL,
  caption       text NOT NULL CHECK (length(caption) BETWEEN 1 AND 500),
  rank          integer NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_examples_project ON brand_examples (project_id, rank, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['brand_sections', 'brand_examples'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
