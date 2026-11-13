-- ── [PCODE-131 | S15 | v0.1.0] Add environments and the secrets vault ──
-- Why:  where a project runs (staging, production, …) and how ProdEngine deploys it there: the target's
--       kind and its plain settings. Secrets live apart, sealed with the server's key (AES-256-GCM): the
--       database alone never reveals them, and the API only ever shows their names.

CREATE TABLE environments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  key             text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{0,29}$'),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  kind            text NOT NULL CHECK (kind IN ('compose', 'ssh', 'kubernetes', 'coolify', 'opentofu')),
  settings        jsonb NOT NULL DEFAULT '{}',
  health_url      text NOT NULL DEFAULT '' CHECK (length(health_url) <= 500),
  -- deploy by itself when this gate is signed (e.g. 'g1' for staging)
  deploy_on_gate  text CHECK (deploy_on_gate IS NULL OR deploy_on_gate ~ '^[a-z0-9-]{1,40}$'),
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);

CREATE TABLE environment_secrets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  environment_id  uuid NOT NULL REFERENCES environments (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (name ~ '^[A-Z_][A-Z0-9_]{0,63}$'),
  ciphertext      text NOT NULL,
  updated_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment_id, name)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['environments', 'environment_secrets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
