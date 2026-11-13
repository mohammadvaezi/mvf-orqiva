-- ── [PCODE-142 | S15 | v0.1.0] Show security findings in the web app with Security agent triage ──
-- Why:  the Security agent's view on a finding (severity, exploitability, the fix) is kept with it as a
--       note for people to act on, with the agent run that wrote it; it never changes the finding itself.

ALTER TABLE findings ADD COLUMN triage text NOT NULL DEFAULT '' CHECK (length(triage) <= 20000);
ALTER TABLE findings ADD COLUMN triage_run_id uuid REFERENCES agent_runs (id) ON DELETE SET NULL;
ALTER TABLE findings ADD COLUMN triaged_at timestamptz;
