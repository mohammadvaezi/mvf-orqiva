-- ── [PCODE-93 | S15 | v0.1.0] Add items, states, labels and comments with full history ──
-- Why:  the work-tracking core. An item lives in one project, in one of that project's states, may have
--       an assignee, an estimate, a parent item and labels. Its version rises with every change, so a client
--       knows which copy is newer. Comments belong to an item. The history of all of it is the activity
--       stream, so nothing is stored twice.

ALTER TABLE items DROP COLUMN state;
ALTER TABLE items ADD COLUMN state_id uuid NOT NULL REFERENCES project_states (id) ON DELETE RESTRICT;
ALTER TABLE items ADD COLUMN assignee_id uuid REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN estimate integer CHECK (estimate BETWEEN 0 AND 1000);
ALTER TABLE items ADD COLUMN parent_id uuid REFERENCES items (id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE items ADD CONSTRAINT items_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
CREATE INDEX items_project ON items (project_id, sequence);
CREATE INDEX items_assignee ON items (assignee_id);
CREATE INDEX items_parent ON items (parent_id);

CREATE TABLE labels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  color         text NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX labels_project_name ON labels (project_id, lower(name));

CREATE TABLE item_labels (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  label_id      uuid NOT NULL REFERENCES labels (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, label_id)
);

CREATE TABLE comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  author_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  edited_at     timestamptz
);
CREATE INDEX comments_item ON comments (item_id, created_at);

ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE labels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON labels
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

ALTER TABLE item_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_labels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON item_labels
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON comments
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

GRANT SELECT, INSERT, UPDATE, DELETE ON labels, item_labels, comments TO prodengine_app;
