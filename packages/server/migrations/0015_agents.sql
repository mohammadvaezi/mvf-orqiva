-- ── [PCODE-120 | S15 | v0.1.0] Build the agent runtime: agents, queued runs, model providers, tools with approvals, budgets, streamed steps ──
-- Why:  agents do drafting work inside the governed path. An agent has a role (what it may do), a prompt,
--       a model, its tools and token budgets. A run is queued and taken by our own worker; every step it
--       takes is kept with its tokens and cost, so a run can be watched as it happens and audited after.
--       The model provider key is stored only encrypted (AES-256-GCM with the server's secret key).

CREATE TABLE agents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  key                  text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{0,39}$'),
  name                 text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description          text NOT NULL DEFAULT '',
  role                 text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'guest')),
  system_prompt        text NOT NULL DEFAULT '' CHECK (length(system_prompt) <= 20000),
  model                text NOT NULL,
  tools                text[] NOT NULL DEFAULT '{}',
  max_tokens_per_run   integer NOT NULL DEFAULT 200000 CHECK (max_tokens_per_run > 0),
  monthly_token_budget bigint NOT NULL DEFAULT 5000000 CHECK (monthly_token_budget > 0),
  enabled              boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

CREATE TABLE agent_provider_settings (
  workspace_id        uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  provider            text NOT NULL DEFAULT 'anthropic' CHECK (provider IN ('anthropic', 'demo')),
  key_ciphertext      text,
  input_price_micros  bigint NOT NULL DEFAULT 0 CHECK (input_price_micros >= 0),
  output_price_micros bigint NOT NULL DEFAULT 0 CHECK (output_price_micros >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  item_id       uuid REFERENCES items (id) ON DELETE SET NULL,
  agent_id      uuid NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  requested_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  instruction   text NOT NULL CHECK (length(instruction) BETWEEN 1 AND 20000),
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled')),
  model         text NOT NULL,
  tokens_in     bigint NOT NULL DEFAULT 0,
  tokens_out    bigint NOT NULL DEFAULT 0,
  cost_micros   bigint NOT NULL DEFAULT 0,
  error         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
CREATE INDEX agent_runs_queue ON agent_runs (status, created_at);
CREATE INDEX agent_runs_item ON agent_runs (item_id);
CREATE INDEX agent_runs_month ON agent_runs (agent_id, created_at);

CREATE TABLE agent_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  run_id        uuid NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  seq           integer NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('model', 'tool_result', 'approval', 'decision', 'error', 'note')),
  content       jsonb NOT NULL,
  tokens_in     integer NOT NULL DEFAULT 0,
  tokens_out    integer NOT NULL DEFAULT 0,
  cost_micros   bigint NOT NULL DEFAULT 0,
  at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agents', 'agent_provider_settings', 'agent_runs', 'agent_steps'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
