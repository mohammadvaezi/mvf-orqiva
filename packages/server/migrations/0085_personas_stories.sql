-- ── [PCODE-274 | S15 | v0.1.0] T28.3 Stories with Given/When/Then and personas; value/effort matrix, evidence library, compare ──
-- Why:  personas belong to the project, so every idea of it speaks of the same people; a story names the
--       persona it is about and carries its Given/When/Then scenarios. A client request can be linked to
--       the idea that answers it, so the evidence library counts how often a need was asked for.

CREATE TABLE personas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  role          text NOT NULL DEFAULT '' CHECK (length(role) <= 200),
  goals         text NOT NULL DEFAULT '' CHECK (length(goals) <= 4000),
  pains         text NOT NULL DEFAULT '' CHECK (length(pains) <= 4000),
  quote         text NOT NULL DEFAULT '' CHECK (length(quote) <= 1000),
  -- the source of the idea it was first read from, when the Analyst found it
  source_id     uuid REFERENCES idea_sources (id) ON DELETE SET NULL,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX personas_name ON personas (project_id, lower(name));

ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON personas
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
-- ideation is the team's: client contacts never see it
CREATE POLICY client_scope ON personas AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON personas TO prodengine_app;

ALTER TABLE requirements
  ADD COLUMN persona_id uuid REFERENCES personas (id) ON DELETE SET NULL,
  ADD COLUMN scenarios  jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(scenarios) = 'array');

ALTER TABLE client_requests
  ADD COLUMN idea_id uuid REFERENCES ideas (id) ON DELETE SET NULL;
CREATE INDEX client_requests_idea ON client_requests (idea_id) WHERE idea_id IS NOT NULL;
