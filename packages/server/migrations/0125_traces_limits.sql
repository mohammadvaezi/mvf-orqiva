-- ── [PCODE-332 | S15 | v0.1.0] T33.4a Nested traces with latency and commits, agent rate limits, provider limits and health ──
-- Why:  a step keeps how long it took and the model turn it belongs to; an agent can be held to a number
--       of runs an hour; a connection can have its own requests and tokens a minute; and every call through
--       it is counted per day, so its health shows from real use.

ALTER TABLE agent_steps
  ADD COLUMN latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  ADD COLUMN parent_seq integer;

ALTER TABLE agents
  ADD COLUMN runs_per_hour integer CHECK (runs_per_hour IS NULL OR runs_per_hour BETWEEN 1 AND 1000);

ALTER TABLE ai_connections
  ADD COLUMN requests_per_minute integer CHECK (requests_per_minute IS NULL OR requests_per_minute BETWEEN 1 AND 100000),
  ADD COLUMN tokens_per_minute   integer CHECK (tokens_per_minute IS NULL OR tokens_per_minute BETWEEN 100 AND 100000000),
  ADD COLUMN last_error_at       timestamptz;

CREATE TABLE ai_connection_health (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES ai_connections (id) ON DELETE CASCADE,
  day           date NOT NULL,
  calls         integer NOT NULL DEFAULT 0,
  failures      integer NOT NULL DEFAULT 0,
  total_ms      bigint NOT NULL DEFAULT 0,
  max_ms        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (connection_id, day)
);
ALTER TABLE ai_connection_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_connection_health FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON ai_connection_health
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON ai_connection_health AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_connection_health TO prodengine_app;
