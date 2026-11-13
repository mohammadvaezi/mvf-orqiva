-- ── [PCODE-149 | S15 | v0.1.0] Bill through Stripe without its SDK: checkout, webhooks, licences ──
-- Why:  what Stripe told us about a workspace's subscription, and every Stripe event we handled (by its
--       id), so a delivery that comes twice is handled once and the invoices can be listed.

CREATE TABLE billing_accounts (
  workspace_id            uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  plan                    text NOT NULL DEFAULT 'team',
  seats                   integer NOT NULL DEFAULT 1,
  status                  text NOT NULL DEFAULT 'pending',
  current_period_end      timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing_events (
  id            text PRIMARY KEY,
  workspace_id  uuid REFERENCES workspaces (id) ON DELETE CASCADE,
  type          text NOT NULL,
  summary       jsonb NOT NULL DEFAULT '{}',
  received_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_events_workspace ON billing_events (workspace_id, received_at);

ALTER TABLE billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON billing_accounts
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON billing_events
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON billing_accounts, billing_events TO prodengine_app;
