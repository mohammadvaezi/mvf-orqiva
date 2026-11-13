-- ── [PCODE-161 | S15 | v0.1.0] B0 data model v2: model for all approved screens and the foundation migrations ──
-- Why:  money in one shape everywhere: euro cents as bigint (never floating point). Providers price models
--       in US dollars, so prices are kept in USD micros with the day's exchange rate beside them, and every
--       euro figure can say which rate made it. Budgets apply at any level (workspace, client, project,
--       agent, team, run); rates turn hours into money per person, role, client or project.

-- global: the same rate for every workspace
CREATE TABLE fx_rates (
  day        date PRIMARY KEY,
  usd_eur    numeric(12, 6) NOT NULL CHECK (usd_eur > 0),
  source     text NOT NULL DEFAULT 'ECB' CHECK (length(source) <= 40),
  fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON fx_rates TO prodengine_app;

-- global list prices; a price applies from its date until the next one for the same model
CREATE TABLE model_prices (
  provider             text NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
  model                text NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
  effective_from       date NOT NULL,
  -- per million tokens, in millionths of a US dollar
  input_usd_micros     bigint NOT NULL CHECK (input_usd_micros >= 0),
  output_usd_micros    bigint NOT NULL CHECK (output_usd_micros >= 0),
  cache_write_usd_micros bigint NOT NULL DEFAULT 0 CHECK (cache_write_usd_micros >= 0),
  cache_read_usd_micros  bigint NOT NULL DEFAULT 0 CHECK (cache_read_usd_micros >= 0),
  retires_on           date,
  PRIMARY KEY (provider, model, effective_from)
);
GRANT SELECT ON model_prices TO prodengine_app;

CREATE TABLE budgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  scope_type    text NOT NULL CHECK (scope_type IN ('workspace', 'client', 'project', 'agent', 'team', 'run')),
  scope_id      uuid,
  -- what is counted: AI spend, people's time, or both
  measure       text NOT NULL DEFAULT 'ai' CHECK (measure IN ('ai', 'time', 'total')),
  period        text NOT NULL CHECK (period IN ('run', 'day', 'month', 'sprint', 'total')),
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  warn_pct      integer NOT NULL DEFAULT 80 CHECK (warn_pct BETWEEN 1 AND 100),
  hard_stop     boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope_type = 'workspace') = (scope_id IS NULL))
);
CREATE INDEX budgets_scope ON budgets (workspace_id, scope_type, scope_id);

CREATE TABLE rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  scope_type      text NOT NULL CHECK (scope_type IN ('workspace', 'role', 'person', 'client', 'project')),
  scope_key       text NOT NULL DEFAULT '' CHECK (length(scope_key) <= 120),
  kind            text NOT NULL CHECK (kind IN ('billable', 'cost')),
  cents_per_hour  bigint NOT NULL CHECK (cents_per_hour >= 0),
  valid_from      date NOT NULL DEFAULT current_date,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rates_scope ON rates (workspace_id, scope_type, scope_key, kind, valid_from DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budgets', 'rates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;

-- a client sees the budget of its own client or project, never rates or other budgets
CREATE POLICY client_scope ON budgets AS RESTRICTIVE
  USING (
    current_client_id() IS NULL
    OR (scope_type = 'client' AND scope_id = current_client_id())
    OR (scope_type = 'project' AND scope_id IN (SELECT id FROM projects WHERE client_id = current_client_id()))
  );
CREATE POLICY client_scope ON rates AS RESTRICTIVE USING (current_client_id() IS NULL);
