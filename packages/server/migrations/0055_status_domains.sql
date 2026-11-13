-- ── [PCODE-191 | S15 | v0.1.0] B7.6 Client status page with uptime probes, own portal domains with DNS verification and on-demand TLS ──
-- Why:  a client sees whether their systems work without asking: the components the team names for them,
--       probed every minute where they have a public address, with 30 days of uptime and the incidents the
--       team reports. And each client's portal lives at its own domain once the client proves it owns it
--       (a DNS record with a token); only verified domains get a certificate.

ALTER TABLE clients ADD COLUMN domain_token text CHECK (domain_token ~ '^[0-9a-f]{32}$');

CREATE TABLE status_components (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  environment_id  uuid REFERENCES environments (id) ON DELETE SET NULL,
  -- probed every minute when set (public https only)
  probe_url       text CHECK (probe_url IS NULL OR length(probe_url) <= 500),
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX status_components_client ON status_components (client_id, position);

CREATE TABLE status_checks (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  component_id  uuid NOT NULL REFERENCES status_components (id) ON DELETE CASCADE,
  at            timestamptz NOT NULL DEFAULT now(),
  ok            boolean NOT NULL,
  latency_ms    integer CHECK (latency_ms >= 0),
  code          integer
);
CREATE INDEX status_checks_component ON status_checks (component_id, at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['status_components', 'status_checks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;

CREATE POLICY client_scope ON status_components AS RESTRICTIVE
  USING (current_client_id() IS NULL OR client_id = current_client_id());
CREATE POLICY client_scope ON status_checks AS RESTRICTIVE
  USING (current_client_id() IS NULL OR component_id IN (SELECT id FROM status_components WHERE client_id = current_client_id()));
