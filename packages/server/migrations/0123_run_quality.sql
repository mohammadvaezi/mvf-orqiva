-- ── [PCODE-330 | S15 | v0.1.0] T33.3a Run quality: annotations, judge scores, outcomes ──
-- Why:  people say whether a run was good, once each, with tags and a note; a judge model's score and its
--       reason are kept on the run with the run that judged it.

CREATE TABLE agent_run_annotations (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  run_id        uuid NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  verdict       text NOT NULL CHECK (verdict IN ('good', 'bad')),
  tags          text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 8),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, user_id)
);

ALTER TABLE agent_run_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_annotations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON agent_run_annotations
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON agent_run_annotations AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_run_annotations TO prodengine_app;

ALTER TABLE agent_runs
  ADD COLUMN judge_score  smallint CHECK (judge_score IS NULL OR judge_score BETWEEN 1 AND 5),
  ADD COLUMN judge_reason text NOT NULL DEFAULT '' CHECK (length(judge_reason) <= 1000),
  ADD COLUMN judge_run_id uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  ADD COLUMN judged_at    timestamptz;
