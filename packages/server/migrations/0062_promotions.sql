-- ── [PCODE-204 | S15 | v0.1.0] T17.2 Promotions with approval, rollback per environment, backports, go/no-go meeting notes ──
-- Why:  a version moves from one environment to the next by promotion. An environment may name who
--       approves promotions into it (e.g. production); then the promotion waits for that person and their
--       decision is an approval over project, version and environment. Releases and trains keep the notes
--       of their go/no-go meeting.

ALTER TABLE environments ADD COLUMN approver_id uuid REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE release_promotions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  from_env_id      uuid REFERENCES environments (id) ON DELETE SET NULL,
  to_env_id        uuid NOT NULL REFERENCES environments (id) ON DELETE CASCADE,
  ref              text NOT NULL CHECK (length(ref) BETWEEN 1 AND 200),
  release_id       uuid REFERENCES releases (id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'declined', 'cancelled')),
  requested_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  decided_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at       timestamptz,
  note             text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  deploy_id        uuid REFERENCES deploy_runs (id) ON DELETE SET NULL
);
CREATE INDEX release_promotions_project ON release_promotions (project_id, requested_at DESC);
-- one waiting promotion per environment
CREATE UNIQUE INDEX release_promotions_waiting ON release_promotions (to_env_id) WHERE status = 'requested';
ALTER TABLE release_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_promotions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON release_promotions USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON release_promotions AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON release_promotions TO prodengine_app;

-- { decision: 'go' | 'no_go', notes, attendees: [..], by, at }
ALTER TABLE releases ADD COLUMN go_no_go jsonb;
ALTER TABLE release_trains ADD COLUMN go_no_go jsonb;
