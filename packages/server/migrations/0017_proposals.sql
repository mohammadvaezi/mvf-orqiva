-- ── [PCODE-124 | S15 | v0.1.0] Generate proposals with an estimate from the interview, with versions ──
-- Why:  a proposal is written by the Architect agent from the interview and then edited by people; every
--       change is a new version, never an overwrite, so what the owner signs can always be shown again next
--       to how it came about. The estimate is stored with each version as computed from its tasks.

CREATE TABLE proposals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  idea_id          uuid NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  version          integer NOT NULL CHECK (version > 0),
  content          jsonb NOT NULL,
  estimate_points  integer NOT NULL,
  estimate_days    integer NOT NULL,
  -- who wrote this version: the agent (with its run) or a person
  source           text NOT NULL CHECK (source IN ('agent', 'person')),
  author_id        uuid REFERENCES users (id) ON DELETE SET NULL,
  run_id           uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idea_id, version)
);

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON proposals
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON proposals TO prodengine_app;
