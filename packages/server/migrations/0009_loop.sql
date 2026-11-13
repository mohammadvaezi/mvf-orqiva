-- ── [PCODE-102 | S15 | v0.1.0] Port the engine's loop to the server: sync, start, status, note, done ──
-- Why:  the development loop (start a task, work, finish it) moves from the Python engine and Plane into
--       ProdEngine. Tools that are not a browser (the pe CLI, Claude Code hooks, later the VS Code extension
--       and agents) sign in with personal API tokens, kept only as hashes. A work session is the old
--       active.json on the server: one open session per person per client (machine and repository), which
--       the database guarantees. Projects carry their version and loop rules; sprints a number, which gives
--       the S code in fingerprints ([APP-12 | S03 | v0.1.0]).

CREATE TABLE api_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX api_tokens_user ON api_tokens (user_id);
-- tokens belong to people, not workspaces: reached only in system mode, never by a workspace transaction
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY system_only ON api_tokens USING (in_system_mode()) WITH CHECK (in_system_mode());

ALTER TABLE projects ADD COLUMN version text NOT NULL DEFAULT '0.1.0' CHECK (version ~ '^\d+\.\d+\.\d+$');
ALTER TABLE projects ADD COLUMN loop_rules jsonb NOT NULL
  DEFAULT '{"reviewBeforeDone": true, "autoTestState": true, "unguardedPaths": []}';

ALTER TABLE sprints ADD COLUMN number integer;
-- existing sprints are numbered in the order they were planned (system mode: row-level security binds the owner)
SELECT set_config('app.system', 'on', true);
UPDATE sprints s SET number = n.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn FROM sprints) n
  WHERE n.id = s.id;
ALTER TABLE sprints ALTER COLUMN number SET NOT NULL;
CREATE UNIQUE INDEX sprints_project_number ON sprints (project_id, number);

CREATE TABLE work_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  -- the machine and repository the work happens in, e.g. "laptop-7:/home/ada/app"
  client          text NOT NULL CHECK (length(client) BETWEEN 1 AND 300),
  client_session  text NOT NULL DEFAULT '',
  sprint_code     text NOT NULL,
  version         text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  end_state       text
);
CREATE UNIQUE INDEX work_sessions_one_open ON work_sessions (user_id, client) WHERE ended_at IS NULL;
CREATE INDEX work_sessions_item ON work_sessions (item_id);
ALTER TABLE work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON work_sessions
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

GRANT SELECT, INSERT, UPDATE ON work_sessions TO prodengine_app;
