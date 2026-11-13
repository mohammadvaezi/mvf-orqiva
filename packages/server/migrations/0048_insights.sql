-- ── [PCODE-184 | S15 | v0.1.0] B6.2 Insights live: cycle time, throughput, escaped bugs, AI cost per point, agents vs people for admins, flow, per project, team load ──
-- Why:  Insights measures how work flows, which needs to know when a task was started and when it was
--       finished. The database keeps both on every change of state, whoever makes it (person, agent,
--       import), so no code path can forget. Weekly snapshots keep each project's figures as they were.

ALTER TABLE items
  ADD COLUMN started_at   timestamptz,
  ADD COLUMN completed_at timestamptz;

CREATE FUNCTION items_flow_times() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE g text;
  BEGIN
    IF TG_OP = 'UPDATE' AND NEW.state_id IS NOT DISTINCT FROM OLD.state_id THEN
      RETURN NEW;
    END IF;
    SELECT grp INTO g FROM project_states WHERE id = NEW.state_id;
    IF g IN ('started', 'completed') AND NEW.started_at IS NULL THEN
      NEW.started_at := now();
    END IF;
    IF g = 'completed' THEN
      NEW.completed_at := coalesce(NEW.completed_at, now());
    ELSE
      NEW.completed_at := NULL;
    END IF;
    IF g IN ('backlog', 'unstarted') THEN
      NEW.started_at := NULL;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER items_flow_times BEFORE INSERT OR UPDATE OF state_id ON items
  FOR EACH ROW EXECUTE FUNCTION items_flow_times();

-- what is known of the past: finished tasks finished when last changed, started ones started then
UPDATE items i SET completed_at = i.updated_at, started_at = coalesce(i.started_at, i.created_at)
  FROM project_states s WHERE s.id = i.state_id AND s.grp = 'completed';
UPDATE items i SET started_at = i.updated_at
  FROM project_states s WHERE s.id = i.state_id AND s.grp = 'started';
CREATE INDEX items_completed ON items (workspace_id, completed_at) WHERE completed_at IS NOT NULL;

CREATE TABLE insight_snapshots (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- the Monday the week starts
  week          date NOT NULL,
  -- done, points, cycle days, agent work (admin figures live here too; the API shows them to admins only)
  figures       jsonb NOT NULL,
  taken_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, week)
);
ALTER TABLE insight_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE insight_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON insight_snapshots
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON insight_snapshots AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON insight_snapshots TO prodengine_app;
