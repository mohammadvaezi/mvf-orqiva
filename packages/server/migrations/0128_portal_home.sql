-- ── [PCODE-336 | S15 | v0.1.0] T34.1a Portal home with health, milestone, release and budget; release deliverables and demos; client sign-off per release; files on acceptance results ──
-- Why:  a release carries what the client receives: links (documents, builds, test environments) and
--       demo recordings, a video file or a link. The client's sign-off of a release is an approval.

CREATE TABLE release_deliverables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  release_id    uuid NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('link', 'demo')),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  url           text NOT NULL DEFAULT '' CHECK (url = '' OR (url ~ '^https?://' AND length(url) <= 1000)),
  file_id       uuid REFERENCES files (id) ON DELETE SET NULL,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (url <> '' OR file_id IS NOT NULL)
);
CREATE INDEX release_deliverables_release ON release_deliverables (release_id, created_at);
ALTER TABLE release_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_deliverables FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON release_deliverables
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON release_deliverables AS RESTRICTIVE
  USING (current_client_id() IS NULL OR project_id IN (SELECT id FROM projects WHERE client_id = current_client_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON release_deliverables TO prodengine_app;
