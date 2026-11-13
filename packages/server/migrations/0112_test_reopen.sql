-- ── [PCODE-314 | S15 | v0.1.0] T32.2 Runs: assignment and workload, keyboard entry, timers, reopen when the defect is done ──
-- Why:  a case blocked by a defect is to run again once the defect is done. However the task gets there (the
--       board, an agent, a merge that closes it), its blocked results in running runs are cleared, and the run
--       remembers which defect reopened the case: { "<case id>": { "defect": "<item id>", "at": "..." } }.

ALTER TABLE test_runs ADD COLUMN reopened jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE FUNCTION test_reopen_on_defect_done() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM project_states WHERE id = NEW.state_id AND grp = 'completed') THEN
    RETURN NEW;
  END IF;
  -- one case at a time: several cases of one run can wait for the same defect
  FOR rec IN
    SELECT r.run_id, r.case_id FROM test_results r JOIN test_runs t ON t.id = r.run_id
     WHERE r.defect_item_id = NEW.id AND r.status = 'blocked' AND t.status = 'running'
  LOOP
    UPDATE test_runs SET reopened = reopened || jsonb_build_object(rec.case_id::text,
             jsonb_build_object('defect', NEW.id::text, 'at', to_jsonb(now())))
     WHERE id = rec.run_id;
  END LOOP;
  DELETE FROM test_results r
   USING test_runs t
   WHERE r.run_id = t.id AND r.defect_item_id = NEW.id AND r.status = 'blocked' AND t.status = 'running';
  RETURN NEW;
END $$;

CREATE TRIGGER items_reopen_tests AFTER UPDATE OF state_id ON items
  FOR EACH ROW WHEN (OLD.state_id IS DISTINCT FROM NEW.state_id)
  EXECUTE FUNCTION test_reopen_on_defect_done();
