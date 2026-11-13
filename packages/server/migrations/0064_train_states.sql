-- ── [PCODE-206 | S15 | v0.1.0] T17.4 Release management in the web app: trains, environments with promote and rollback, notes approval, backport, go/no-go notes, changelog ──
-- Why:  0061 turned old train labels into trains, all planned, also where every release on them had long
--       shipped (or been rolled back). Such a train is history: shipped, or rolled back when none of its
--       releases is still out. Trains with an open release stay planned.
SELECT set_config('app.system', 'on', true);
UPDATE release_trains t SET state = CASE
    WHEN EXISTS (SELECT 1 FROM releases r WHERE r.train_id = t.id AND r.state = 'released') THEN 'shipped'
    ELSE 'rolled_back' END,
  shipped_at = (SELECT max(r.released_at) FROM releases r WHERE r.train_id = t.id)
 WHERE t.state = 'planned'
   AND EXISTS (SELECT 1 FROM releases r WHERE r.train_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM releases r WHERE r.train_id = t.id AND r.state IN ('planned', 'frozen'));
