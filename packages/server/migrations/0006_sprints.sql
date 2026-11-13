-- ── [PCODE-99 | S15 | v0.1.0] Build sprints, backlog, board and list views ──
-- Why:  team sprints per project. A sprint is planned, then active (at most one per project, enforced by
--       the database), then completed. Items belong to a sprint or to the backlog (no sprint), and carry a
--       rank: the order people give them on the board and in the backlog, independent of their number.

CREATE TABLE sprints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  goal          text NOT NULL DEFAULT '' CHECK (length(goal) <= 2000),
  start_date    date,
  end_date      date,
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX sprints_project ON sprints (project_id, created_at);
CREATE UNIQUE INDEX sprints_one_active ON sprints (project_id) WHERE status = 'active';

ALTER TABLE sprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE sprints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON sprints
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

ALTER TABLE items ADD COLUMN sprint_id uuid REFERENCES sprints (id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN rank double precision NOT NULL DEFAULT 0;
CREATE INDEX items_sprint ON items (sprint_id);
-- existing items keep their order: rank follows their number. Row-level security binds the owner too, so
-- the update runs in system mode (for this migration's transaction only).
SELECT set_config('app.system', 'on', true);
UPDATE items SET rank = sequence;

GRANT SELECT, INSERT, UPDATE, DELETE ON sprints TO prodengine_app;
