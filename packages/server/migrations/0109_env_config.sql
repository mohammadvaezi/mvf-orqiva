-- ── [PCODE-307 | S15 | v0.1.0] T31.7 Environment config diff: variables, secrets, settings, flags and versions side by side ──
-- Why:  plain configuration (log level, feature switches, URLs) belongs to an environment and may be read,
--       unlike its secrets. A project names the keys that are meant to differ between environments, so a
--       comparison shows what is left: drift.

CREATE TABLE environment_vars (
  environment_id uuid NOT NULL REFERENCES environments (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (name ~ '^[A-Z_][A-Z0-9_]{0,63}$'),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  value          text NOT NULL CHECK (length(value) <= 4000),
  updated_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, name)
);

CREATE TABLE config_expected_diffs (
  project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- the row's key as the comparison names it: "variable:LOG_LEVEL", "secret:DATABASE_URL", "setting:host"
  key          text NOT NULL CHECK (length(key) BETWEEN 3 AND 300),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  note         text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, key)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['environment_vars', 'config_expected_diffs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
