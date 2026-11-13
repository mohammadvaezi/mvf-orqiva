-- ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
-- Why:  Cypress and Allure reports import as runs of their own source, beside Playwright and JUnit.

ALTER TABLE test_runs DROP CONSTRAINT test_runs_source_check;
ALTER TABLE test_runs ADD CONSTRAINT test_runs_source_check
  CHECK (source IN ('manual', 'stream', 'junit', 'playwright', 'exploratory', 'cypress', 'allure'));
