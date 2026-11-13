-- ── [PCODE-143 | S15 | v0.1.0] Map compliance controls for ISO 27001, SOC 2, GDPR and the EU CRA to live evidence ──
-- Why:  which frameworks a project answers to, the evidence people add to controls (who and when), and the
--       controls that do not apply, with the reason. Everything else a control needs is measured live.

CREATE TABLE project_frameworks (
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  framework_key  text NOT NULL CHECK (framework_key ~ '^[a-z0-9-]{1,40}$'),
  enabled_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  enabled_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, framework_key)
);

CREATE TABLE control_evidence (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  framework_key  text NOT NULL,
  control_id     text NOT NULL,
  text           text NOT NULL CHECK (length(text) BETWEEN 1 AND 5000),
  url            text NOT NULL DEFAULT '' CHECK (length(url) <= 1000),
  added_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  added_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX control_evidence_control ON control_evidence (project_id, framework_key, control_id);

CREATE TABLE control_exemptions (
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  framework_key  text NOT NULL,
  control_id     text NOT NULL,
  reason         text NOT NULL CHECK (length(reason) BETWEEN 10 AND 2000),
  decided_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, framework_key, control_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_frameworks', 'control_evidence', 'control_exemptions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
