-- ── [PCODE-107 | S15 | v0.1.0] Build the Plane importer: projects, items, states, comments, cycles, history ──
-- Why:  teams arrive with years of work in another tool. An import must be repeatable: import_links remembers
--       which local row each foreign one became, so a second run updates instead of duplicating and an
--       interrupted run resumes. What happened before ProdEngine keeps its time and its people: comments
--       carry the author's name when the author has no account here, and the foreign activity log lands in
--       item_history, which the item's history shows next to ProdEngine's own events.

CREATE TABLE import_links (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source ~ '^[a-z][a-z0-9_-]{1,30}$'),
  kind          text NOT NULL CHECK (kind IN ('project', 'state', 'label', 'sprint', 'item', 'comment', 'history')),
  external_id   text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  local_id      uuid NOT NULL,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source, kind, external_id)
);
CREATE INDEX import_links_local ON import_links (local_id);
ALTER TABLE import_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON import_links
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE ON import_links TO prodengine_app;

-- the author of an imported comment who has no account here, by name
ALTER TABLE comments ADD COLUMN author_label text CHECK (length(author_label) <= 200);

CREATE TABLE item_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  source        text NOT NULL,
  at            timestamptz NOT NULL,
  actor         text NOT NULL DEFAULT '',
  verb          text NOT NULL,
  field         text,
  old_value     text,
  new_value     text,
  note          text
);
CREATE INDEX item_history_item ON item_history (item_id, at);
ALTER TABLE item_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON item_history
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE ON item_history TO prodengine_app;
