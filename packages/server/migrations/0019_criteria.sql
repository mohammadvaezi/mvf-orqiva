-- ── [PCODE-127 | S15 | v0.1.0] Show measured progress on every card from acceptance criteria and subtasks ──
-- Why:  a task's progress is counted, never typed: its acceptance criteria are a checklist, and each tick
--       says who checked it and when. Together with finished subtasks this is the bar on every card.

CREATE TABLE item_criteria (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  position      integer NOT NULL,
  text          text NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  done          boolean NOT NULL DEFAULT false,
  done_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  done_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_criteria_item ON item_criteria (item_id, position);

ALTER TABLE item_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_criteria FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON item_criteria
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON item_criteria TO prodengine_app;
