-- ── [PCODE-175 | S15 | v0.1.0] B4.1 Test and Versions on the server: suites, steps, configs, evidence, flaky, Playwright, pull requests, releases, notes, flags, DORA ──
-- Why:  the Test and Versions tabs of the approved design. Test cases live in suites, carry their steps
--       with expected results and a version (a run pins the version it ran), and can be quarantined when
--       they flake; runs carry the configuration they ran on, or the charter of an exploratory session;
--       results keep the outcome per step, who ran them, the defect they found and their evidence. Pull
--       requests come from the Git webhooks with their size, reviews and checks. Releases collect tasks
--       under a version with a freeze window and notes for the team and for the client; feature flags
--       name the task they belong to. None of it reaches client contacts.

ALTER TABLE test_cases
  ADD COLUMN suite           text NOT NULL DEFAULT '' CHECK (length(suite) <= 300),
  ADD COLUMN kind            text NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'bdd', 'exploratory', 'automated')),
  -- [{ "action": "Open the page", "expected": "The map shows" }]
  ADD COLUMN step_list       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- { "browser": ["chromium", "webkit"] }: values the case runs with
  ADD COLUMN parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN version         integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN quarantined     boolean NOT NULL DEFAULT false,
  ADD COLUMN quarantine_note text NOT NULL DEFAULT '' CHECK (length(quarantine_note) <= 1000);
CREATE INDEX test_cases_suite ON test_cases (project_id, suite);

ALTER TABLE test_runs
  -- { "browser": "webkit", "os": "iOS 18", "device": "iPhone 15", "locale": "de-DE" }
  ADD COLUMN config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- an exploratory session: what to look at, for how long, and the notes taken
  ADD COLUMN charter    text NOT NULL DEFAULT '' CHECK (length(charter) <= 4000),
  ADD COLUMN timebox_minutes integer CHECK (timebox_minutes BETWEEN 1 AND 600),
  ADD COLUMN notes      text NOT NULL DEFAULT '' CHECK (length(notes) <= 50000),
  ADD COLUMN release_id uuid,
  -- the cases planned for this run (a person's run; imports add theirs as they come)
  ADD COLUMN planned_case_ids uuid[] NOT NULL DEFAULT '{}',
  -- { "<caseId>": "<userId>" }: who runs which case
  ADD COLUMN assignments jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE test_runs DROP CONSTRAINT test_runs_source_check;
ALTER TABLE test_runs ADD CONSTRAINT test_runs_source_check CHECK (source IN ('manual', 'stream', 'junit', 'playwright', 'exploratory'));

ALTER TABLE test_results
  -- [{ "status": "passed", "note": "" }], one per step of the case version run
  ADD COLUMN step_results   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN case_version   integer,
  ADD COLUMN assignee_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN defect_item_id uuid REFERENCES items (id) ON DELETE SET NULL;

CREATE TABLE test_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  run_id        uuid NOT NULL REFERENCES test_runs (id) ON DELETE CASCADE,
  case_id       uuid NOT NULL REFERENCES test_cases (id) ON DELETE CASCADE,
  step          integer CHECK (step >= 1),
  file_id       uuid NOT NULL REFERENCES files (id) ON DELETE RESTRICT,
  kind          text NOT NULL DEFAULT 'screenshot' CHECK (kind IN ('screenshot', 'recording', 'console', 'network', 'voice', 'document')),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX test_evidence_result ON test_evidence (run_id, case_id);

CREATE TABLE pull_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  connection_id   uuid NOT NULL REFERENCES git_connections (id) ON DELETE CASCADE,
  number          integer NOT NULL CHECK (number > 0),
  title           text NOT NULL DEFAULT '' CHECK (length(title) <= 300),
  url             text NOT NULL DEFAULT '' CHECK (length(url) <= 500),
  author          text NOT NULL DEFAULT '' CHECK (length(author) <= 200),
  branch          text NOT NULL DEFAULT '' CHECK (length(branch) <= 250),
  base            text NOT NULL DEFAULT '' CHECK (length(base) <= 250),
  head_sha        text NOT NULL DEFAULT '' CHECK (length(head_sha) <= 64),
  state           text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'merged', 'closed')),
  draft           boolean NOT NULL DEFAULT false,
  additions       integer NOT NULL DEFAULT 0,
  deletions       integer NOT NULL DEFAULT 0,
  changed_files   integer NOT NULL DEFAULT 0,
  review_state    text NOT NULL DEFAULT 'none' CHECK (review_state IN ('none', 'approved', 'changes_requested', 'commented')),
  checks_state    text NOT NULL DEFAULT 'none' CHECK (checks_state IN ('none', 'pending', 'passing', 'failing')),
  item_id         uuid REFERENCES items (id) ON DELETE SET NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  merged_at       timestamptz,
  closed_at       timestamptz,
  UNIQUE (connection_id, number)
);
CREATE INDEX pull_requests_project ON pull_requests (project_id, state, updated_at DESC);
CREATE INDEX pull_requests_sha ON pull_requests (connection_id, head_sha);

CREATE TABLE releases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  version       text NOT NULL CHECK (version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$'),
  name          text NOT NULL DEFAULT '' CHECK (length(name) <= 120),
  -- a release train ("2026.10"), and whether it is a hotfix on an older line
  train         text NOT NULL DEFAULT '' CHECK (length(train) <= 60),
  hotfix_of     uuid REFERENCES releases (id) ON DELETE SET NULL,
  state         text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'frozen', 'released', 'rolled_back')),
  freeze_at     timestamptz,
  target_date   date,
  notes_team    text NOT NULL DEFAULT '' CHECK (length(notes_team) <= 100000),
  notes_client  text NOT NULL DEFAULT '' CHECK (length(notes_client) <= 100000),
  environment_id uuid REFERENCES environments (id) ON DELETE SET NULL,
  released_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  released_at   timestamptz,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);
ALTER TABLE test_runs ADD CONSTRAINT test_runs_release FOREIGN KEY (release_id) REFERENCES releases (id) ON DELETE SET NULL;

CREATE TABLE release_items (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  release_id    uuid NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  -- the change is not compatible: the next version is a major one
  breaking      boolean NOT NULL DEFAULT false,
  added_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (release_id, item_id)
);
CREATE INDEX release_items_item ON release_items (item_id);

CREATE TABLE feature_flags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  key           text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  item_id       uuid REFERENCES items (id) ON DELETE SET NULL,
  -- { "staging": true, "production": false }
  enabled       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  removed_at    timestamptz,
  UNIQUE (project_id, key)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['test_evidence', 'pull_requests', 'releases', 'release_items', 'feature_flags'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
  END LOOP;
END $$;
