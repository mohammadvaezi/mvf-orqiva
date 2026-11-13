-- ── [PCODE-301 | S15 | v0.1.0] T31.2b Git history backfill through the hosts' APIs; branches and tags in the Repositories screen ──
-- Why:  when a repository's history was last read through its host's API.

ALTER TABLE git_connections ADD COLUMN last_backfill_at timestamptz;
