-- ── [PCODE-316 | S15 | v0.1.0] T32.3b Named run sign-off with a frozen snapshot, and a release gate on tests ──
-- Why:  a finished run is signed off by the person named for it (an admin when nobody is): who, when, with
--       what note, and a snapshot of every result as it stood, which stays as it was.

ALTER TABLE test_runs
  ADD COLUMN approver_id uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN signed_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN signed_at   timestamptz,
  ADD COLUMN sign_note   text NOT NULL DEFAULT '' CHECK (length(sign_note) <= 2000),
  -- { "totals": {...}, "results": [{ "caseId", "key", "title", "version", "status", "message", "defect" }] }
  ADD COLUMN snapshot    jsonb;
