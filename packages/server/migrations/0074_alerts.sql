-- ── [PCODE-249 | S15 | v0.1.0] T25.4 Alerts and reminders: budgets, anomalies, doc watchers, stale flags and ideas ──
-- Why:  settings that were kept now speak up. A budget warns at its percentage and again when it is used
--       up, once per period; a day whose AI spend is far above the usual alerts once; the watchers of a page
--       hear of its changes, gathered into one notice per page and person; a flag nobody touched for long and
--       an idea that went quiet remind their owner once. Each alert lands in the inbox, and reaches phones
--       and mail as the person's rules say.

ALTER TABLE inbox_items DROP CONSTRAINT inbox_items_kind_check;
ALTER TABLE inbox_items ADD CONSTRAINT inbox_items_kind_check
  CHECK (kind IN ('approval', 'review', 'mention', 'question', 'signoff', 'request', 'test', 'incident', 'message',
                  'budget', 'watch', 'reminder'));

-- a budget warns once per period and level
CREATE TABLE budget_alerts (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  budget_id     uuid NOT NULL REFERENCES budgets (id) ON DELETE CASCADE,
  -- '2026-10-11' for a day, '2026-10' for a month, 'total'
  period_key    text NOT NULL CHECK (length(period_key) <= 20),
  level         text NOT NULL CHECK (level IN ('warn', 'full')),
  percent       integer NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (budget_id, period_key, level)
);

-- a day of unusual AI spend alerts once
CREATE TABLE spend_alerts (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  day           date NOT NULL,
  cents         bigint NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, day)
);

-- changes to a watched page wait here a short while, so a burst of saves is one notice
CREATE TABLE doc_watch_pending (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES doc_pages (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- who changed it and how, newest last, a few at most
  changes       jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_at      timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, user_id)
);
CREATE INDEX doc_watch_pending_due ON doc_watch_pending (last_at);

-- a reminder is sent once; new activity on an idea makes it remindable again
ALTER TABLE feature_flags ADD COLUMN reminded_at timestamptz;
ALTER TABLE ideas ADD COLUMN reminded_at timestamptz;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_alerts', 'spend_alerts', 'doc_watch_pending'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
