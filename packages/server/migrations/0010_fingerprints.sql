-- ── [PCODE-104 | S15 | v0.1.0] Move the fingerprint scanner and index into the server; every loop step emits an event ──
-- Why:  the fingerprint index (which code was written for which task) lived in a Markdown file in each
--       repository. The server now keeps it per item: every marker `pe done` found (file, line, header or
--       block) with the commit, sprint code and version it was finished under. Finishing a task again
--       replaces its markers, so the index always shows the code as it was at the last done.

CREATE TABLE item_fingerprints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  path         text NOT NULL CHECK (length(path) BETWEEN 1 AND 500),
  line         integer NOT NULL CHECK (line >= 1),
  kind         text NOT NULL CHECK (kind IN ('header', 'block')),
  commit       text CHECK (commit ~ '^[0-9a-f]{7,40}$'),
  sprint_code  text NOT NULL,
  version      text NOT NULL,
  recorded_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, path, line)
);
CREATE INDEX item_fingerprints_project_path ON item_fingerprints (project_id, path);
ALTER TABLE item_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_fingerprints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON item_fingerprints
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

GRANT SELECT, INSERT, DELETE ON item_fingerprints TO prodengine_app;
