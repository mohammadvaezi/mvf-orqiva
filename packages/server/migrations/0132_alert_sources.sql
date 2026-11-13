-- ── [PCODE-340 | S15 | v0.1.0] T34.2a Automatic alerts from probes and failed deploys; Sentry and Alertmanager sources with signed webhooks ──
-- Why:  outside monitoring sends its alerts to a webhook address of its own, with a secret that only the
--       server keeps (sealed): a bearer token for Alertmanager, the key that signs Sentry's bodies.

CREATE TABLE alert_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects (id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('sentry', 'alertmanager')),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  secret_sealed   text NOT NULL,
  received        integer NOT NULL DEFAULT 0,
  last_at         timestamptz,
  last_error      text NOT NULL DEFAULT '' CHECK (length(last_error) <= 300),
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE alert_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON alert_sources
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON alert_sources AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON alert_sources TO prodengine_app;
