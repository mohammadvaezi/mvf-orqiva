-- ── [PCODE-183 | S15 | v0.1.0] B6.1 Activity at scale live: search, query language, facets, histogram, saved views, export, archive, hash chain, webhooks ──
-- Why:  Activity that stays usable at any volume. Every event gets a search vector over who did what to
--       which object, its project as a column, and a hash that includes the hash of the event before it,
--       so a removed or changed event shows. Events older than the workspace's retention move to an
--       archive with the same shape, which a search can still include. People keep saved views; exports
--       are logged; webhooks stream the events they ask for, signed, with a delivery log.

ALTER TABLE activity_events
  ADD COLUMN project_id text GENERATED ALWAYS AS (envelope->>'projectid') STORED,
  ADD COLUMN search tsvector GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(envelope->'data'->'actor'->>'name', '') || ' ' ||
      coalesce(envelope->'data'->>'verb', '') || ' ' ||
      coalesce(envelope->'data'->'object'->>'label', '') || ' ' ||
      coalesce(envelope->'data'->'parent'->>'label', ''))) STORED,
  ADD COLUMN hash text CHECK (hash IS NULL OR hash ~ '^[0-9a-f]{64}$');
CREATE INDEX activity_events_ws_time ON activity_events (workspace_id, time DESC);
CREATE INDEX activity_events_ws_project ON activity_events (workspace_id, project_id, time DESC);
CREATE INDEX activity_events_search ON activity_events USING gin (search);

-- the archive tier: the same rows, moved out of the hot table after the retention period
CREATE TABLE activity_archive (LIKE activity_events INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING CONSTRAINTS);
ALTER TABLE activity_archive ADD PRIMARY KEY (workspace_id, sequence);
CREATE INDEX activity_archive_ws_time ON activity_archive (workspace_id, time DESC);
CREATE INDEX activity_archive_search ON activity_archive USING gin (search);
ALTER TABLE activity_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_archive FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON activity_archive
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT ON activity_archive TO prodengine_app;

CREATE TABLE activity_settings (
  workspace_id    uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  -- days events stay in the hot table; after that they move to the archive
  retention_days  integer NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 7 AND 3650),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activity_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  owner_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  query         text NOT NULL DEFAULT '' CHECK (length(query) <= 500),
  mode          text NOT NULL DEFAULT 'all' CHECK (mode IN ('all', 'mine')),
  shared        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activity_exports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  requested_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  query         text NOT NULL DEFAULT '' CHECK (length(query) <= 500),
  format        text NOT NULL CHECK (format IN ('csv', 'json')),
  rows          integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhooks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  url               text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 500),
  secret_ciphertext text NOT NULL,
  -- object types to send (empty: all); a query narrows further
  event_types       text[] NOT NULL DEFAULT '{}',
  query             text NOT NULL DEFAULT '' CHECK (length(query) <= 500),
  active            boolean NOT NULL DEFAULT true,
  -- the last event sent, so the next delivery continues from there
  cursor            bigint NOT NULL DEFAULT 0,
  failures          integer NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  webhook_id    uuid NOT NULL REFERENCES webhooks (id) ON DELETE CASCADE,
  from_sequence bigint NOT NULL,
  to_sequence   bigint NOT NULL,
  events        integer NOT NULL,
  status        text NOT NULL CHECK (status IN ('delivered', 'failed')),
  response_code integer,
  error         text NOT NULL DEFAULT '' CHECK (length(error) <= 500),
  duration_ms   integer,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_hook ON webhook_deliveries (webhook_id, at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['activity_settings', 'activity_views', 'activity_exports', 'webhooks', 'webhook_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
  END LOOP;
END $$;
