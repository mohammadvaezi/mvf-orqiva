-- ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
-- Why:  Tokens and costs of the approved design, both meanings. Access tokens get a kind (personal,
--       service account, runner), a workspace they are bound to, scopes, an approval for broad scopes, and
--       where and how often they were used; service accounts are users that are not people. A workspace
--       sets a token policy. A token found in a task or a comment is revoked and the leak is kept. AI
--       prices can be set per workspace (they win over the shipped table), and a project can bring its own
--       provider key, e.g. when the client pays.

ALTER TABLE users ADD COLUMN is_service boolean NOT NULL DEFAULT false;

ALTER TABLE api_tokens
  ADD COLUMN kind           text NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal', 'service', 'runner')),
  ADD COLUMN workspace_id   uuid REFERENCES workspaces (id) ON DELETE CASCADE,
  -- empty: everything the person may do (tokens made before scopes)
  ADD COLUMN scopes         text[] NOT NULL DEFAULT '{}',
  ADD COLUMN state          text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'pending')),
  ADD COLUMN approved_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN last_used_ip   text,
  ADD COLUMN use_count      bigint NOT NULL DEFAULT 0,
  ADD COLUMN prefix         text NOT NULL DEFAULT 'pe_' CHECK (length(prefix) <= 10);
CREATE INDEX api_tokens_workspace ON api_tokens (workspace_id);

CREATE TABLE token_policies (
  workspace_id          uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  max_days_personal     integer NOT NULL DEFAULT 90 CHECK (max_days_personal BETWEEN 1 AND 730),
  max_days_service      integer NOT NULL DEFAULT 365 CHECK (max_days_service BETWEEN 1 AND 730),
  require_expiry        boolean NOT NULL DEFAULT true,
  approve_broad_scopes  boolean NOT NULL DEFAULT true,
  ip_allow              text[] NOT NULL DEFAULT '{}',
  revoke_unused_days    integer CHECK (revoke_unused_days BETWEEN 7 AND 730),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE token_leaks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  token_id      uuid REFERENCES api_tokens (id) ON DELETE SET NULL,
  user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  token_name    text NOT NULL DEFAULT '',
  found_in      text NOT NULL CHECK (found_in IN ('task', 'comment', 'commit', 'trace', 'log', 'document')),
  location      text NOT NULL DEFAULT '' CHECK (length(location) <= 300),
  found_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);
CREATE INDEX token_leaks_workspace ON token_leaks (workspace_id, found_at DESC);

CREATE TABLE workspace_model_prices (
  workspace_id            uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  provider                text NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
  model                   text NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
  effective_from          date NOT NULL,
  input_usd_micros        bigint NOT NULL CHECK (input_usd_micros >= 0),
  output_usd_micros       bigint NOT NULL CHECK (output_usd_micros >= 0),
  cache_write_usd_micros  bigint NOT NULL DEFAULT 0 CHECK (cache_write_usd_micros >= 0),
  cache_read_usd_micros   bigint NOT NULL DEFAULT 0 CHECK (cache_read_usd_micros >= 0),
  created_by              uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider, model, effective_from)
);

CREATE TABLE project_provider_keys (
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  provider        text NOT NULL DEFAULT 'anthropic' CHECK (provider IN ('anthropic')),
  label           text NOT NULL DEFAULT '' CHECK (length(label) <= 80),
  key_ciphertext  text NOT NULL,
  -- the last four characters, to tell keys apart
  key_hint        text NOT NULL DEFAULT '' CHECK (length(key_hint) <= 8),
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  last_error      text NOT NULL DEFAULT '' CHECK (length(last_error) <= 500),
  PRIMARY KEY (project_id, provider)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['token_policies', 'token_leaks', 'workspace_model_prices', 'project_provider_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
  END LOOP;
END $$;
