-- ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
-- Why:  presence itself lives in memory (it is minutes old at most); the workspace only keeps whether it is
--       shown at all. Some teams, or their works council, want it off: then nobody's whereabouts are shared.
ALTER TABLE workspaces ADD COLUMN presence_enabled boolean NOT NULL DEFAULT true;
