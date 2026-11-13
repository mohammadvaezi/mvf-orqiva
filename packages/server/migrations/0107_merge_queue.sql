-- ── [PCODE-305 | S15 | v0.1.0] T31.5b The merge queue: in order per branch, merged through the host when the policy passes ──
-- Why:  ready pull requests wait in line per repository and base branch; the first is merged through the
--       host when it still merges cleanly and meets the policy. One that cannot leaves the line with the
--       reason; one that only waits keeps its place and says why.

CREATE TABLE merge_queue_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  pull_request_id uuid NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
  method          text NOT NULL DEFAULT 'squash' CHECK (method IN ('merge', 'squash', 'rebase')),
  state           text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'merged', 'removed')),
  -- why it waits, why it left, or what the host said
  reason          text NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  added_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  added_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at     timestamptz
);
-- a pull request is in line at most once
CREATE UNIQUE INDEX merge_queue_one ON merge_queue_entries (pull_request_id) WHERE state = 'queued';
CREATE INDEX merge_queue_project ON merge_queue_entries (project_id, state, added_at);

ALTER TABLE merge_queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE merge_queue_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON merge_queue_entries
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON merge_queue_entries AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON merge_queue_entries TO prodengine_app;
