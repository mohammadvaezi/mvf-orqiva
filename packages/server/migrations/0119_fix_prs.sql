-- ── [PCODE-324 | S15 | v0.1.0] T32.8a Fix pull requests for findings: dependency upgrades and AI fixes ──
-- Why:  a finding remembers the pull request that fixes it, so it is not opened twice and people find it.

ALTER TABLE findings ADD COLUMN fix_pr_url text NOT NULL DEFAULT '' CHECK (length(fix_pr_url) <= 500);
