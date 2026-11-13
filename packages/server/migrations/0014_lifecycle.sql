-- ── [PCODE-117 | S15 | v0.1.0] Build the lifecycle engine: phases, stages, gates, criteria, sign-off, live ──
-- Why:  a project walks a governed path: phases in order, stages inside them, and a gate after a phase that
--       opens only when its stages are finished, its criteria are met and a person with the gate's role
--       signs. The project keeps its own copy of the template it started from (definition), so editing a
--       template later never changes a running project. Every decision keeps who and when.

-- workspace templates (PCODE-119); the built-in default lives in the code
CREATE TABLE lifecycle_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  definition    jsonb NOT NULL,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE project_lifecycles (
  project_id    uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  template_name text NOT NULL,
  definition    jsonb NOT NULL,
  started_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  started_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lifecycle_stages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project_lifecycles (project_id) ON DELETE CASCADE,
  phase_key     text NOT NULL,
  stage_key     text NOT NULL,
  position      integer NOT NULL,
  status        text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'active', 'done', 'skipped')),
  started_at    timestamptz,
  finished_at   timestamptz,
  changed_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  note          text NOT NULL DEFAULT '',
  UNIQUE (project_id, stage_key)
);

CREATE TABLE gate_criteria (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project_lifecycles (project_id) ON DELETE CASCADE,
  gate_key      text NOT NULL,
  criterion_key text NOT NULL,
  position      integer NOT NULL,
  text          text NOT NULL,
  met           boolean NOT NULL DEFAULT false,
  evidence      text NOT NULL DEFAULT '' CHECK (length(evidence) <= 2000),
  met_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  met_at        timestamptz,
  UNIQUE (project_id, gate_key, criterion_key)
);

CREATE TABLE gate_signoffs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project_lifecycles (project_id) ON DELETE CASCADE,
  gate_key      text NOT NULL,
  decision      text NOT NULL CHECK (decision IN ('approve', 'reject', 'reopen')),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  user_name     text NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gate_signoffs_project ON gate_signoffs (project_id, gate_key, at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lifecycle_templates', 'project_lifecycles', 'lifecycle_stages', 'gate_criteria', 'gate_signoffs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
