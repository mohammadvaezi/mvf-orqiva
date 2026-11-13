-- ── [PCODE-295 | S15 | v0.1.0] T30.8b Visual regression: baselines, pixel diff, orq visual check, the Visual tab ──
-- Why:  per screen of a project the approved screenshot (the baseline), and every check against it with its
--       diff image, the share of changed pixels and whether that passed.

CREATE TABLE visual_baselines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  file_id       uuid NOT NULL REFERENCES files (id) ON DELETE RESTRICT,
  width         integer NOT NULL CHECK (width > 0),
  height        integer NOT NULL CHECK (height > 0),
  -- the share of pixels that may change and still pass
  max_diff      real NOT NULL DEFAULT 0.001 CHECK (max_diff BETWEEN 0 AND 1),
  mockup_id     uuid REFERENCES mockups (id) ON DELETE SET NULL,
  approved_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE visual_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  file_id        uuid NOT NULL REFERENCES files (id) ON DELETE RESTRICT,
  diff_file_id   uuid REFERENCES files (id) ON DELETE SET NULL,
  width          integer NOT NULL,
  height         integer NOT NULL,
  changed        integer NOT NULL DEFAULT 0,
  ratio          real NOT NULL DEFAULT 0,
  box            jsonb,
  status         text NOT NULL CHECK (status IN ('new', 'pass', 'fail', 'approved')),
  reason         text NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  commit_sha     text NOT NULL DEFAULT '' CHECK (length(commit_sha) <= 64),
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX visual_runs_screen ON visual_runs (project_id, name, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['visual_baselines', 'visual_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
