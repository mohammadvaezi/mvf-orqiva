-- ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
-- Why:  a bug past its fix time alerts once; the mark keeps it from alerting again until it is fixed.

ALTER TABLE items ADD COLUMN sla_alerted_at timestamptz;
