-- ── [PCODE-328 | S15 | v0.1.0] T33.1b Cost estimate before a run, chargeback per client and cost centre, unit costs ──
-- Why:  the finance team books AI cost to cost centres; a project names the one it belongs to.

ALTER TABLE projects
  ADD COLUMN cost_centre text NOT NULL DEFAULT '' CHECK (length(cost_centre) <= 60);
