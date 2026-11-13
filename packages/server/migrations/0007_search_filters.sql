-- ── [PCODE-100 | S15 | v0.1.0] Add filters, search and the keyboard command bar ──
-- Why:  full-text search on PostgreSQL's built-in text search: a generated column per item and a GIN index,
--       no extension. The 'simple' configuration does not stem, so German and English titles are found by
--       the words people type; prefixes match too (the query side adds :*). Saved filters belong to one
--       person in one workspace.

ALTER TABLE items ADD COLUMN search tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED;
CREATE INDEX items_search ON items USING gin (search);

CREATE TABLE saved_filters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id    uuid REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  query         jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_filters_owner ON saved_filters (user_id, project_id);

ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON saved_filters
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

GRANT SELECT, INSERT, UPDATE, DELETE ON saved_filters TO prodengine_app;
