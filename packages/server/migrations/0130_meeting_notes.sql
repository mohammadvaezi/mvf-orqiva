-- ── [PCODE-338 | S15 | v0.1.0] T34.1c Meeting notes and actions into tasks; the team's client overview with health, revenue, activity and people ──
-- Why:  what was said in a client meeting, and what came of it: notes, shared with the client or not, and
--       action items that become tasks.

ALTER TABLE meetings
  ADD COLUMN notes        text NOT NULL DEFAULT '' CHECK (length(notes) <= 50000),
  ADD COLUMN notes_shared boolean NOT NULL DEFAULT true,
  ADD COLUMN notes_at     timestamptz,
  ADD COLUMN notes_by     uuid REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE meeting_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  meeting_id    uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  text          text NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  assignee_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  due_on        date,
  item_id       uuid REFERENCES items (id) ON DELETE SET NULL,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_actions_meeting ON meeting_actions (meeting_id, created_at);
ALTER TABLE meeting_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON meeting_actions
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON meeting_actions AS RESTRICTIVE
  USING (current_client_id() IS NULL OR client_id = current_client_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_actions TO prodengine_app;
