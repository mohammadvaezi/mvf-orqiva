-- ── [PCODE-139 | S15 | v0.1.0] Add security findings with SARIF import, tasks for findings and the security gate ──
-- Why:  what scanners find, kept per project with a fingerprint that survives rescans: a finding seen again
--       is the same finding, one a full scan no longer sees is fixed. People decide on findings with a
--       reason; open high and critical ones become tasks and hold the quality gate shut.

CREATE TABLE security_scans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  tool          text NOT NULL CHECK (length(tool) BETWEEN 1 AND 80),
  full_scan     boolean NOT NULL DEFAULT true,
  found         integer NOT NULL DEFAULT 0,
  new_count     integer NOT NULL DEFAULT 0,
  fixed_count   integer NOT NULL DEFAULT 0,
  started_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_scans_project ON security_scans (project_id, created_at);

CREATE TABLE findings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  tool           text NOT NULL CHECK (length(tool) BETWEEN 1 AND 80),
  rule           text NOT NULL CHECK (length(rule) BETWEEN 1 AND 200),
  severity       text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  message        text NOT NULL DEFAULT '' CHECK (length(message) <= 10000),
  file           text NOT NULL DEFAULT '' CHECK (length(file) <= 500),
  line           integer,
  fingerprint    text NOT NULL CHECK (length(fingerprint) BETWEEN 1 AND 200),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'accepted', 'false_positive')),
  reason         text NOT NULL DEFAULT '' CHECK (length(reason) <= 2000),
  decided_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at     timestamptz,
  item_id        uuid REFERENCES items (id) ON DELETE SET NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_scan_id   uuid REFERENCES security_scans (id) ON DELETE SET NULL,
  UNIQUE (project_id, tool, fingerprint)
);
CREATE INDEX findings_open ON findings (project_id, status, severity);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['security_scans', 'findings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
