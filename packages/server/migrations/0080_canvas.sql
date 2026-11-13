-- ── [PCODE-259 | S15 | v0.1.0] T27.1 Canvas engine: constraint types, split tasks, holidays, move with successors ──
-- Why:  the Gantt as MS Project knows it: a task may be held to a day (start or finish no earlier or later
--       than, must start or finish on, as late as possible), and its work may be split by pauses.

ALTER TABLE items
  ADD COLUMN constraint_type text NOT NULL DEFAULT 'asap'
    CHECK (constraint_type IN ('asap', 'alap', 'snet', 'snlt', 'fnet', 'fnlt', 'mso', 'mfo')),
  ADD COLUMN constraint_date date,
  ADD COLUMN splits jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(splits) = 'array');
