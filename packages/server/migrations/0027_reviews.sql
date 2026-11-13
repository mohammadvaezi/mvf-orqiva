-- ── [PCODE-145 | S15 | v0.1.0] Add the review stage and the Reviewer agent ──
-- Why:  a task's reviews: the Reviewer agent's (a note with a recommendation, never a decision) and
--       people's (approved or changes requested, with a note). The latest decision of a person counts.

CREATE TABLE item_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('agent', 'person')),
  decision       text CHECK (decision IS NULL OR decision IN ('approved', 'changes_requested')),
  recommendation text CHECK (recommendation IS NULL OR recommendation IN ('approve', 'changes')),
  body           text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  run_id         uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  author_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'person') = (decision IS NOT NULL))
);
CREATE INDEX item_reviews_item ON item_reviews (item_id, created_at);

ALTER TABLE item_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON item_reviews
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON item_reviews TO prodengine_app;
