-- ── [PCODE-350 | S15 | v0.1.0] T35.3a Templates library for projects, PRDs, sprints and agents ──
-- Why:  the workspace's own templates next to the built-in ones, and which PRD template each kind of idea
--       uses (a built-in one is named 'builtin:<slug>').

CREATE TABLE template_library (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('project', 'sprint', 'agent', 'prd')),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  body          jsonb NOT NULL,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, name)
);

CREATE TABLE prd_template_defaults (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  idea_kind     text NOT NULL CHECK (idea_kind IN ('feature', 'improvement', 'bug', 'research', 'change_request')),
  template_id   text NOT NULL CHECK (length(template_id) <= 80),
  PRIMARY KEY (workspace_id, idea_kind)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['template_library', 'prd_template_defaults'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode())
      WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())', t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
