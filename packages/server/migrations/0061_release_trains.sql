-- ── [PCODE-203 | S15 | v0.1.0] T17.1 Release trains on the server: releases of several projects, freeze, go/no-go, ship with deploys, rollback ──
-- Why:  a release train was a text label on one project's release; now it is its own thing, so the releases
--       of several projects ship (and roll back) together. A deploy queued for a release says so, which
--       lets a train follow its deploys and a rollback find what ran before. Existing labels become trains
--       of their workspace (in system mode: releases sit behind row-level security).

CREATE TABLE release_trains (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  state            text NOT NULL DEFAULT 'planned'
                   CHECK (state IN ('planned', 'frozen', 'shipping', 'shipped', 'partial', 'rolling_back', 'rolled_back')),
  freeze_at        timestamptz,
  target_date      date,
  note             text NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  shipped_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  shipped_at       timestamptz,
  rollback_reason  text NOT NULL DEFAULT '' CHECK (length(rollback_reason) <= 2000),
  rolled_back_at   timestamptz,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
ALTER TABLE release_trains ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_trains FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON release_trains USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON release_trains AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON release_trains TO prodengine_app;

ALTER TABLE releases ADD COLUMN train_id uuid REFERENCES release_trains (id) ON DELETE SET NULL;
CREATE INDEX releases_train ON releases (train_id) WHERE train_id IS NOT NULL;
-- one release per project in a train
CREATE UNIQUE INDEX releases_train_project ON releases (train_id, project_id) WHERE train_id IS NOT NULL;

ALTER TABLE deploy_runs ADD COLUMN release_id uuid REFERENCES releases (id) ON DELETE SET NULL;
CREATE INDEX deploy_runs_release ON deploy_runs (release_id, created_at DESC) WHERE release_id IS NOT NULL;

SELECT set_config('app.system', 'on', true);
INSERT INTO release_trains (workspace_id, name, state)
SELECT DISTINCT workspace_id, train, 'planned' FROM releases WHERE train <> '';
-- the oldest release per project keeps the link when a label was used twice in one project
UPDATE releases r SET train_id = t.id
  FROM release_trains t
 WHERE t.workspace_id = r.workspace_id AND t.name = r.train
   AND r.id = (SELECT x.id FROM releases x WHERE x.workspace_id = r.workspace_id AND x.project_id = r.project_id
                AND x.train = r.train ORDER BY x.created_at LIMIT 1);
