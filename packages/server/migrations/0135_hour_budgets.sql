-- ── [PCODE-343 | S15 | v0.1.0] T34.3a Hour budgets with alerts, time reports by person, sprint and task, DATEV export ──
-- Why:  a project or a client gets so many hours a month or in total; the admins hear when time crosses
--       the warning level and when it is used up, once per period. And a client's debtor account for the
--       DATEV export.

CREATE TABLE hour_budgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  scope_type    text NOT NULL CHECK (scope_type IN ('project', 'client')),
  scope_id      uuid NOT NULL,
  period        text NOT NULL CHECK (period IN ('month', 'total')),
  hours         numeric(10, 2) NOT NULL CHECK (hours > 0),
  warn_pct      integer NOT NULL DEFAULT 80 CHECK (warn_pct BETWEEN 1 AND 100),
  -- the period ('2026-10' or 'total') last warned about, and last reported over
  warned_key    text,
  over_key      text,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, scope_type, scope_id, period)
);
ALTER TABLE hour_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE hour_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON hour_budgets
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON hour_budgets AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON hour_budgets TO prodengine_app;

ALTER TABLE clients ADD COLUMN datev_account text CHECK (datev_account IS NULL OR datev_account ~ '^[0-9]{4,9}$');
