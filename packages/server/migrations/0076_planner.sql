-- ── [PCODE-253 | S15 | v0.1.0] T26.2 Capacity from profiles, absences, holidays and agents; Planner proposes assignees and new stories ──
-- Why:  the Planner's draft says who could take each task, and proposes stories the backlog lacks, with an
--       estimate and why; a story becomes a task in the sprint only when a person accepts it.

ALTER TABLE plan_draft_lines ADD COLUMN assignee_id uuid REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE plan_draft_new (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  draft_id      uuid NOT NULL REFERENCES plan_drafts (id) ON DELETE CASCADE,
  position      integer NOT NULL,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  estimate      integer CHECK (estimate BETWEEN 0 AND 1000),
  why           text NOT NULL DEFAULT '' CHECK (length(why) <= 500),
  assignee_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  decision      text CHECK (decision IN ('accepted', 'declined')),
  reason        text NOT NULL DEFAULT '',
  -- the task made from it when accepted
  item_id       uuid REFERENCES items (id) ON DELETE SET NULL,
  decided_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at    timestamptz
);
CREATE INDEX plan_draft_new_draft ON plan_draft_new (draft_id, position);

ALTER TABLE plan_draft_new ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_draft_new FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON plan_draft_new
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_draft_new TO prodengine_app;
