-- ── [PCODE-180 | S15 | v0.1.0] B5.1 Agents live: settings, versioned prompts, action rules, autonomy, pause all, budgets in euro, traces, costs, quality ──
-- Why:  the Agents section of the approved design: every agent fully under control. An agent names a
--       fallback model, how freely it acts, the person accountable for it, what it may touch and when it
--       starts by itself, how many runs it takes at once and what it may spend in euro per run, day and
--       month. Its instructions are versioned so a change can be compared and rolled back; a rule per kind
--       of action says never, ask or allowed. One switch pauses every agent of the workspace.

ALTER TABLE agents
  ADD COLUMN fallback_model     text NOT NULL DEFAULT '' CHECK (length(fallback_model) <= 100),
  ADD COLUMN temperature        real NOT NULL DEFAULT 0.2 CHECK (temperature BETWEEN 0 AND 1),
  ADD COLUMN max_output_tokens  integer NOT NULL DEFAULT 8000 CHECK (max_output_tokens BETWEEN 256 AND 64000),
  ADD COLUMN autonomy           text NOT NULL DEFAULT 'scoped' CHECK (autonomy IN ('suggest', 'approve', 'scoped', 'autonomous')),
  ADD COLUMN owner_id           uuid REFERENCES users (id) ON DELETE SET NULL,
  -- {"files": ["src/**"], "branches": ["agent/*"], "network": ["api.github.com"], "documents": ["Architecture"]}
  ADD COLUMN scope              jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{"kind": "assigned"}, {"kind": "label", "value": "agent"}, {"kind": "mention", "value": "/coder"}]
  ADD COLUMN triggers           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN concurrency        integer NOT NULL DEFAULT 3 CHECK (concurrency BETWEEN 1 AND 50),
  ADD COLUMN prompt_version     integer NOT NULL DEFAULT 1 CHECK (prompt_version >= 1),
  -- euro cents; null is no limit
  ADD COLUMN run_budget_cents   bigint CHECK (run_budget_cents > 0),
  ADD COLUMN day_budget_cents   bigint CHECK (day_budget_cents > 0),
  ADD COLUMN month_budget_cents bigint CHECK (month_budget_cents > 0);

ALTER TABLE agent_runs
  ADD COLUMN prompt_version       integer NOT NULL DEFAULT 1,
  ADD COLUMN tokens_cache_read    bigint NOT NULL DEFAULT 0,
  ADD COLUMN tokens_cache_write   bigint NOT NULL DEFAULT 0,
  -- one sentence: what the run did
  ADD COLUMN summary              text NOT NULL DEFAULT '' CHECK (length(summary) <= 500);

ALTER TABLE agent_provider_settings
  ADD COLUMN paused_at  timestamptz,
  ADD COLUMN paused_by  uuid REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE agent_prompt_versions (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  version       integer NOT NULL CHECK (version >= 1),
  prompt        text NOT NULL CHECK (length(prompt) <= 20000),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, version)
);

CREATE TABLE agent_action_rules (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  action_class  text NOT NULL CHECK (action_class IN ('comment', 'write', 'move', 'shell', 'push', 'merge', 'deploy', 'spend', 'external')),
  rule          text NOT NULL CHECK (rule IN ('never', 'ask', 'allowed')),
  PRIMARY KEY (agent_id, action_class)
);

-- the first version of every agent's instructions is what it has now
INSERT INTO agent_prompt_versions (workspace_id, agent_id, version, prompt, note)
  SELECT workspace_id, id, 1, system_prompt, 'first version' FROM agents;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_prompt_versions', 'agent_action_rules'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
  END LOOP;
END $$;
