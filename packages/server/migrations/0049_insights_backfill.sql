-- ── [PCODE-184 | S15 | v0.1.0] B6.2 Insights live: cycle time, throughput, escaped bugs, AI cost per point, agents vs people for admins, flow, per project, team load ──
-- Why:  the backfill in 0048 ran under row-level security without system mode and so changed no rows;
--       existing tasks had no started or finished time and Insights showed nothing done. Same backfill,
--       now in system mode (local to this migration's transaction).
SELECT set_config('app.system', 'on', true);

UPDATE items i SET completed_at = i.updated_at, started_at = coalesce(i.started_at, i.created_at)
  FROM project_states s WHERE s.id = i.state_id AND s.grp = 'completed' AND i.completed_at IS NULL;
UPDATE items i SET started_at = i.updated_at
  FROM project_states s WHERE s.id = i.state_id AND s.grp = 'started' AND i.started_at IS NULL;
