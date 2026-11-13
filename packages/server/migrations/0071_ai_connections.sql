-- ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
-- Why:  a workspace is no longer tied to one model provider. It keeps several connections (Anthropic, OpenAI,
--       Azure OpenAI, Google Gemini, Amazon Bedrock, xAI Grok, or the demo model), each with its key sealed by
--       the server's own key, and says which one agents use, which one takes over when that one fails, which
--       one reads documents and images, and which one writes transcripts. An agent may have its own
--       connection and model. The single provider of before becomes the workspace's first connection, so
--       nothing changes for a workspace until an admin changes it.

CREATE TABLE ai_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'azure', 'gemini', 'bedrock', 'xai', 'demo')),
  label           text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  -- what the provider needs besides the key: Azure's endpoint, Bedrock's region and kind of credential
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- the key (or, for Bedrock with access keys, a JSON of them), sealed; NULL for the demo model
  key_ciphertext  text,
  key_hint        text NOT NULL DEFAULT '' CHECK (length(key_hint) <= 8),
  -- '' = the agent's own model; for Azure the deployment name
  default_model   text NOT NULL DEFAULT '' CHECK (length(default_model) <= 120),
  reading_model   text NOT NULL DEFAULT '' CHECK (length(reading_model) <= 120),
  audio_model     text NOT NULL DEFAULT '' CHECK (length(audio_model) <= 120),
  last_used_at    timestamptz,
  last_error      text NOT NULL DEFAULT '' CHECK (length(last_error) <= 500),
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_connections_workspace ON ai_connections (workspace_id, created_at);

ALTER TABLE agent_provider_settings
  ADD COLUMN agent_connection_id    uuid REFERENCES ai_connections (id) ON DELETE SET NULL,
  ADD COLUMN fallback_connection_id uuid REFERENCES ai_connections (id) ON DELETE SET NULL,
  ADD COLUMN reading_connection_id  uuid REFERENCES ai_connections (id) ON DELETE SET NULL,
  ADD COLUMN audio_connection_id    uuid REFERENCES ai_connections (id) ON DELETE SET NULL;

ALTER TABLE agents ADD COLUMN connection_id uuid REFERENCES ai_connections (id) ON DELETE SET NULL;

-- a project's own key, now for any provider
ALTER TABLE project_provider_keys DROP CONSTRAINT IF EXISTS project_provider_keys_provider_check;
ALTER TABLE project_provider_keys
  ADD CONSTRAINT project_provider_keys_provider_check
  CHECK (provider IN ('anthropic', 'openai', 'azure', 'gemini', 'bedrock', 'xai'));

-- transcripts are priced per minute of audio; a shipped price says where it comes from
ALTER TABLE model_prices
  ADD COLUMN audio_minute_usd_micros bigint NOT NULL DEFAULT 0 CHECK (audio_minute_usd_micros >= 0),
  ADD COLUMN note text NOT NULL DEFAULT '' CHECK (length(note) <= 200);
ALTER TABLE workspace_model_prices
  ADD COLUMN audio_minute_usd_micros bigint NOT NULL DEFAULT 0 CHECK (audio_minute_usd_micros >= 0);

-- estimates from public price lists in October 2026; an admin sets the workspace's own price to correct them
INSERT INTO model_prices (provider, model, effective_from, input_usd_micros, output_usd_micros, cache_read_usd_micros, audio_minute_usd_micros, note) VALUES
  ('openai', 'gpt-5',                  '2026-10-01',  1250000, 10000000, 125000,    0, 'estimate, check the provider''s price list'),
  ('openai', 'gpt-5-mini',             '2026-10-01',   250000,  2000000,  25000,    0, 'estimate, check the provider''s price list'),
  ('openai', 'gpt-4o-transcribe',      '2026-10-01',  2500000, 10000000,      0, 6000, 'estimate, check the provider''s price list'),
  ('openai', 'gpt-4o-mini-transcribe', '2026-10-01',        0,        0,      0, 3000, 'estimate, check the provider''s price list'),
  ('openai', 'whisper-1',              '2026-10-01',        0,        0,      0, 6000, 'estimate, check the provider''s price list'),
  ('gemini', 'gemini-2.5-flash',       '2026-10-01',   300000,  2500000,  30000,    0, 'estimate, text input; audio input costs more'),
  ('gemini', 'gemini-2.5-pro',         '2026-10-01',  1250000, 10000000, 125000,    0, 'estimate, up to 200k tokens of input'),
  ('xai',    'grok-4',                 '2026-10-01',  3000000, 15000000,      0,    0, 'estimate, check the provider''s price list'),
  ('xai',    'grok-voice-transcribe-2.0', '2026-10-01',     0,        0,      0, 1667, 'estimate, 0.10 USD per hour')
ON CONFLICT DO NOTHING;

-- the provider of before becomes the first connection; agents keep their own models
INSERT INTO ai_connections (workspace_id, provider, label, key_ciphertext)
SELECT workspace_id, provider, CASE WHEN provider = 'demo' THEN 'Demo model' ELSE 'Anthropic' END, key_ciphertext
  FROM agent_provider_settings
 WHERE provider = 'demo' OR key_ciphertext IS NOT NULL;
UPDATE agent_provider_settings s SET agent_connection_id = c.id
  FROM ai_connections c WHERE c.workspace_id = s.workspace_id;

ALTER TABLE ai_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON ai_connections
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON ai_connections AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_connections TO prodengine_app;
