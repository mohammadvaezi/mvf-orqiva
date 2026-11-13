-- ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
-- Why:  budgets warn at half, at their warning level and when used up: a third level for AI budgets, and
--       the period an hour budget last reported its half in.

ALTER TABLE budget_alerts DROP CONSTRAINT budget_alerts_level_check;
ALTER TABLE budget_alerts ADD CONSTRAINT budget_alerts_level_check CHECK (level IN ('half', 'warn', 'full'));
ALTER TABLE hour_budgets ADD COLUMN half_key text;
