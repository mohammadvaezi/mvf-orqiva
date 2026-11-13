-- ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
-- Why:  a step keeps its cache and reasoning tokens beside input and output; a run adds them up and keeps the
--       euro rate of its day, so what it cost in euro stays what it was. The server writes the daily rate.

ALTER TABLE agent_steps
  ADD COLUMN tokens_cache_read  bigint NOT NULL DEFAULT 0,
  ADD COLUMN tokens_cache_write bigint NOT NULL DEFAULT 0,
  ADD COLUMN tokens_reasoning   bigint NOT NULL DEFAULT 0;

ALTER TABLE agent_runs
  ADD COLUMN tokens_reasoning bigint NOT NULL DEFAULT 0,
  -- euro per US dollar on the run's day
  ADD COLUMN usd_eur real CHECK (usd_eur IS NULL OR usd_eur > 0);

GRANT INSERT, UPDATE ON fx_rates TO prodengine_app;

-- earlier runs get the rate of their day, where one was kept
SELECT set_config('app.system', 'on', true);
UPDATE agent_runs r SET usd_eur = (
  SELECT f.usd_eur FROM fx_rates f WHERE f.day <= r.created_at::date ORDER BY f.day DESC LIMIT 1)
 WHERE r.usd_eur IS NULL;

-- a new run takes the rate of its day as it starts
CREATE FUNCTION agent_run_rate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.usd_eur IS NULL THEN
    NEW.usd_eur := (SELECT usd_eur FROM fx_rates WHERE day <= current_date ORDER BY day DESC LIMIT 1);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_runs_rate BEFORE INSERT ON agent_runs FOR EACH ROW EXECUTE FUNCTION agent_run_rate();
