-- ── [PCODE-165 | S15 | v0.1.0] B2.1 Planning and Canvas on the server: plan fields, dependencies, schedule, baselines, scenarios, drafts, retro, workload ──
-- Why:  the approved Planning and Canvas screens on real data. A task knows its kind, priority, dates,
--       duration in working days, how far it is, whether it is ready and how often it was carried over;
--       tasks depend on each other (finish-to-start and the other three, with lag); a plan can be saved
--       as a baseline and branched into scenarios; the Planner's draft is kept so people decide it line by
--       line; a sprint keeps its scope at the start and whether its goal was met; the retro board lives
--       next to the sprint. Clients see their projects' plan (dependencies, baselines) but never the
--       team's drafts, scenarios or retro notes.

ALTER TABLE items
  ADD COLUMN kind          text NOT NULL DEFAULT 'task'
                           CHECK (kind IN ('epic', 'story', 'task', 'bug', 'spike', 'milestone')),
  ADD COLUMN priority      text NOT NULL DEFAULT 'none'
                           CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
  ADD COLUMN start_date    date,
  ADD COLUMN due_date      date,
  -- working days; 0 for a milestone; null when the plan derives it from the dates
  ADD COLUMN duration_days integer CHECK (duration_days BETWEEN 0 AND 3650),
  -- null: derived from the state, the criteria and the children
  ADD COLUMN percent_done  smallint CHECK (percent_done BETWEEN 0 AND 100),
  ADD COLUMN ready         boolean NOT NULL DEFAULT false,
  ADD COLUMN carried_count integer NOT NULL DEFAULT 0 CHECK (carried_count >= 0),
  -- auto: the dependencies move it; manual: its dates stay where people put them
  ADD COLUMN schedule_mode text NOT NULL DEFAULT 'auto' CHECK (schedule_mode IN ('auto', 'manual')),
  ADD CONSTRAINT items_dates_order CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date);
CREATE INDEX items_plan ON items (project_id, start_date) WHERE start_date IS NOT NULL;

ALTER TABLE sprints
  ADD COLUMN goal_met       boolean,
  -- [{ "itemId": "…", "estimate": 3 }] when the sprint started; additions after it are mid-sprint
  ADD COLUMN scope_snapshot jsonb;

CREATE TABLE item_dependencies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  predecessor_id  uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  successor_id    uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'FS' CHECK (kind IN ('FS', 'SS', 'FF', 'SF')),
  -- working days; negative is lead
  lag_days        integer NOT NULL DEFAULT 0 CHECK (lag_days BETWEEN -365 AND 365),
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (predecessor_id <> successor_id),
  UNIQUE (predecessor_id, successor_id)
);
CREATE INDEX item_dependencies_project ON item_dependencies (project_id);
CREATE INDEX item_dependencies_successor ON item_dependencies (successor_id);

CREATE TABLE baselines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE baseline_items (
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  baseline_id    uuid NOT NULL REFERENCES baselines (id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  start_date     date,
  finish_date    date,
  duration_days  integer,
  percent_done   smallint,
  estimate       integer,
  PRIMARY KEY (baseline_id, item_id)
);

CREATE TABLE plan_scenarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  -- { "<itemId>": { "startDate": "…", "durationDays": 3, "assigneeId": "…" } }: what differs from live
  changes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'merged', 'discarded')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);
CREATE INDEX plan_scenarios_project ON plan_scenarios (project_id, created_at DESC);

CREATE TABLE plan_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  sprint_id     uuid NOT NULL REFERENCES sprints (id) ON DELETE CASCADE,
  agent_run_id  uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  room          integer NOT NULL,
  basis         text NOT NULL,
  reasons       text NOT NULL DEFAULT '',
  -- what the Planner considered, one sentence each
  considered    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- the note a person gave when asking for a redo
  note          text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided', 'replaced')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_drafts_sprint ON plan_drafts (sprint_id, created_at DESC);

CREATE TABLE plan_draft_lines (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  draft_id      uuid NOT NULL REFERENCES plan_drafts (id) ON DELETE CASCADE,
  position      integer NOT NULL,
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  why           text NOT NULL DEFAULT '',
  confidence    real NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  decision      text CHECK (decision IN ('accepted', 'declined')),
  reason        text NOT NULL DEFAULT '',
  decided_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at    timestamptz,
  PRIMARY KEY (draft_id, item_id)
);

CREATE TABLE retro_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  sprint_id     uuid NOT NULL REFERENCES sprints (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('well', 'improve', 'action')),
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  author_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  -- who voted; one vote per person
  voters        uuid[] NOT NULL DEFAULT '{}',
  -- an action becomes a task of the next sprint
  item_id       uuid REFERENCES items (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retro_notes_sprint ON retro_notes (sprint_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_dependencies', 'baselines', 'baseline_items', 'plan_scenarios', 'plan_drafts',
                           'plan_draft_lines', 'retro_notes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
  -- the team's own working material never reaches a client
  FOREACH t IN ARRAY ARRAY['plan_scenarios', 'plan_drafts', 'plan_draft_lines', 'retro_notes'] LOOP
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
  END LOOP;
END $$;

CREATE POLICY client_scope ON item_dependencies AS RESTRICTIVE
  USING (current_client_id() IS NULL OR project_id IN (SELECT id FROM projects WHERE client_id = current_client_id()));
CREATE POLICY client_scope ON baselines AS RESTRICTIVE
  USING (current_client_id() IS NULL OR project_id IN (SELECT id FROM projects WHERE client_id = current_client_id()));
CREATE POLICY client_scope ON baseline_items AS RESTRICTIVE
  USING (current_client_id() IS NULL OR baseline_id IN (SELECT id FROM baselines));
