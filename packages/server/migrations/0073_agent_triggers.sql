-- ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
-- Why:  the triggers kept with an agent now start its runs. A task can be assigned to an agent; the
--       matcher reads each workspace's activity after it is written (its own cursor) and starts the agents
--       whose triggers fit; a schedule starts runs at its minutes; an outside system calls the agent's own
--       webhook address with its secret. Each run says what started it, and one cause starts an agent once.

ALTER TABLE items ADD COLUMN agent_id uuid REFERENCES agents (id) ON DELETE SET NULL;
CREATE INDEX items_agent ON items (agent_id) WHERE agent_id IS NOT NULL;

ALTER TABLE agent_runs
  ADD COLUMN trigger_kind  text CHECK (trigger_kind IN ('assigned', 'label', 'mention', 'schedule', 'ci_failure', 'webhook')),
  ADD COLUMN trigger_note  text NOT NULL DEFAULT '' CHECK (length(trigger_note) <= 300),
  -- what started it, once: an event id, a scheduled minute or a webhook delivery
  ADD COLUMN trigger_key   text CHECK (length(trigger_key) <= 200);
CREATE UNIQUE INDEX agent_runs_trigger_once ON agent_runs (agent_id, trigger_key) WHERE trigger_key IS NOT NULL;
CREATE INDEX agent_runs_triggered ON agent_runs (agent_id, trigger_kind, created_at) WHERE trigger_kind IS NOT NULL;

-- the webhook: a public id in the address and a secret, sealed with the server's key
ALTER TABLE agents
  ADD COLUMN webhook_id         text UNIQUE CHECK (webhook_id ~ '^[A-Za-z0-9_-]{20,64}$'),
  ADD COLUMN webhook_secret     text,
  ADD COLUMN webhook_secret_hint text NOT NULL DEFAULT '' CHECK (length(webhook_secret_hint) <= 8);

-- where the matcher is in each workspace's activity; it starts when a workspace first saves triggers
CREATE TABLE agent_trigger_cursors (
  workspace_id  uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  last_sequence bigint NOT NULL DEFAULT 0
);
ALTER TABLE agent_trigger_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_trigger_cursors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON agent_trigger_cursors
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_trigger_cursors TO prodengine_app;
