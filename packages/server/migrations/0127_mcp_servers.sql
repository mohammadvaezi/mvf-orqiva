-- ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
-- Why:  outside MCP servers the workspace's agents may use: where they are, the header with their key
--       (sealed), what kind of action their tools are, and which of them agents may call. Each agent
--       names the servers it uses.

CREATE TABLE mcp_servers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (name ~ '^[a-z][a-z0-9-]{0,19}$'),
  label          text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  url            text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 500),
  header_name    text NOT NULL DEFAULT 'Authorization' CHECK (header_name ~ '^[A-Za-z][A-Za-z0-9-]{0,60}$'),
  secret_sealed  text,
  secret_hint    text NOT NULL DEFAULT '' CHECK (length(secret_hint) <= 8),
  action_class   text NOT NULL DEFAULT 'external' CHECK (action_class IN ('read', 'comment', 'write', 'external')),
  -- empty: every tool the server lists
  allowed_tools  text[] NOT NULL DEFAULT '{}' CHECK (cardinality(allowed_tools) <= 100),
  tool_count     integer,
  last_ok_at     timestamptz,
  last_error     text NOT NULL DEFAULT '' CHECK (length(last_error) <= 500),
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
ALTER TABLE mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_servers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON mcp_servers
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON mcp_servers AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_servers TO prodengine_app;

ALTER TABLE agents ADD COLUMN mcp_servers uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(mcp_servers) <= 10);
