-- ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
-- Why:  a bridge posts chosen events (and one channel's messages) to a Slack or Teams incoming webhook,
--       each once, from its own cursor; a person's calendar has a secret link; and CI pipelines report
--       their runs per project.

CREATE TABLE chat_bridges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('slack', 'teams')),
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  url_ciphertext   text NOT NULL,
  topics           text[] NOT NULL DEFAULT '{}',
  channel_id       uuid REFERENCES channels (id) ON DELETE SET NULL,
  -- the last activity event and channel message posted
  cursor           bigint NOT NULL DEFAULT 0,
  message_cursor   timestamptz NOT NULL DEFAULT now(),
  active           boolean NOT NULL DEFAULT true,
  sent             integer NOT NULL DEFAULT 0,
  failures         integer NOT NULL DEFAULT 0,
  last_error       text NOT NULL DEFAULT '' CHECK (length(last_error) <= 300),
  last_at          timestamptz,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calendar_feeds (
  token         text PRIMARY KEY CHECK (token ~ '^[a-z0-9]{32,64}$'),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz,
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE ci_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- the pipeline's own id for the run, so a later report updates it
  external_id   text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  pipeline      text NOT NULL CHECK (length(pipeline) BETWEEN 1 AND 120),
  status        text NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'cancelled')),
  branch        text NOT NULL DEFAULT '' CHECK (length(branch) <= 250),
  sha           text NOT NULL DEFAULT '' CHECK (sha = '' OR sha ~ '^[0-9a-f]{7,64}$'),
  url           text NOT NULL DEFAULT '' CHECK (length(url) <= 500),
  item_refs     text[] NOT NULL DEFAULT '{}',
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  reported_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  UNIQUE (project_id, external_id)
);
CREATE INDEX ci_runs_project ON ci_runs (project_id, started_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chat_bridges', 'calendar_feeds', 'ci_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode())
      WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())', t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
