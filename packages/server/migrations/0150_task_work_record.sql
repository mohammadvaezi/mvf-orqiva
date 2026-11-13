-- ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
-- Why:  a task's AI work is counted, wherever it ran: Claude Code in VS Code reports the tokens of its
--       session per model, and they land on a local run of the developer agent on the task, priced like
--       a server run. The run belongs to the work session, so it ends with it.

-- the Anthropic list prices of 2026-10-06, per million tokens in millionths of a US dollar; cache writes
-- at 1.25 times the input price; a workspace overrides them in workspace_model_prices
INSERT INTO model_prices (provider, model, effective_from, input_usd_micros, output_usd_micros,
                          cache_write_usd_micros, cache_read_usd_micros) VALUES
  ('anthropic', 'claude-fable-5-1',  '2026-10-01', 10000000, 50000000, 12500000,  250000),
  ('anthropic', 'claude-fable-5',    '2026-10-01', 10000000, 50000000, 12500000, 1000000),
  ('anthropic', 'claude-opus-5-5',   '2026-10-01',  4000000, 20000000,  5000000,  200000),
  ('anthropic', 'claude-opus-5',     '2026-10-01',  5000000, 25000000,  6250000,  500000),
  ('anthropic', 'claude-opus-4-8',   '2026-10-01',  5000000, 25000000,  6250000,  500000),
  ('anthropic', 'claude-opus-4-7',   '2026-10-01',  5000000, 25000000,  6250000,  500000),
  ('anthropic', 'claude-opus-4-6',   '2026-10-01',  5000000, 25000000,  6250000,  500000),
  ('anthropic', 'claude-sonnet-5-5', '2026-10-01',  2000000, 10000000,  2500000,  200000),
  ('anthropic', 'claude-sonnet-5',   '2026-10-01',  2000000, 10000000,  2500000,  200000),
  ('anthropic', 'claude-sonnet-4-6', '2026-10-01',  3000000, 15000000,  3750000,  300000),
  ('anthropic', 'claude-haiku-5-5',  '2026-10-01',   100000,   500000,   125000,   10000),
  ('anthropic', 'claude-haiku-4-5',  '2026-10-01',  1000000,  5000000,  1250000,  100000)
ON CONFLICT DO NOTHING;

-- (the run's cache token columns exist since 0044)
ALTER TABLE agent_runs
  ADD COLUMN work_session_id uuid REFERENCES work_sessions (id) ON DELETE SET NULL;

CREATE INDEX agent_runs_work_session ON agent_runs (work_session_id) WHERE work_session_id IS NOT NULL;
