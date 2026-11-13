-- ── [PCODE-219 | S15 | v0.1.0] T20.2 Pricing and self-serve purchase for self-hosted customers (offers, buy flow, licence orders, plan enforcement) ──
-- Why:  a self-hosted customer buys on the vendor's server without a workspace there. The order remembers
--       the Stripe checkout and subscription, who bought what, and the licence key the last payment
--       issued, which the order page shows. Only the server itself (system mode) reads or writes it.

CREATE TABLE licence_orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session        text NOT NULL UNIQUE CHECK (checkout_session ~ '^cs_[A-Za-z0-9_]{8,250}$'),
  stripe_customer_id      text,
  stripe_subscription_id  text UNIQUE,
  company                 text NOT NULL CHECK (length(company) BETWEEN 1 AND 120),
  email                   text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  plan                    text NOT NULL CHECK (plan IN ('team', 'business')),
  seats                   integer NOT NULL CHECK (seats > 0),
  status                  text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'active', 'past_due', 'cancelled')),
  licence                 text,
  current_period_end      timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE licence_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE licence_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY system_only ON licence_orders USING (in_system_mode()) WITH CHECK (in_system_mode());
GRANT SELECT, INSERT, UPDATE ON licence_orders TO prodengine_app;
