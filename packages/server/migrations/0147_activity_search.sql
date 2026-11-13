-- ── [PCODE-438 | S15 | v0.1.0] T37 medium: Activity text search uses its index under row-level security ──
-- Why:  under row-level security PostgreSQL uses no index for an operator that is not leakproof, and the
--       text match (@@) is not, so every word search read every event. The words go into this side table
--       as well, without row policies, with their own index: a search finds the matching numbers here first
--       and then reads those events, whose policies still decide what anyone sees. Every query names its
--       workspace; the table holds only the words of names and labels, never the events themselves.

CREATE TABLE activity_search (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  sequence      bigint NOT NULL,
  search        tsvector NOT NULL,
  PRIMARY KEY (workspace_id, sequence)
);
CREATE INDEX activity_search_words ON activity_search USING gin (search);
GRANT SELECT, INSERT, DELETE ON activity_search TO prodengine_app;

DO $$
BEGIN
  PERFORM set_config('app.system', 'on', true);
  INSERT INTO activity_search (workspace_id, sequence, search)
  SELECT workspace_id, sequence, search FROM activity_events WHERE search IS NOT NULL;
  INSERT INTO activity_search (workspace_id, sequence, search)
  SELECT workspace_id, sequence, search FROM activity_archive WHERE search IS NOT NULL
  ON CONFLICT DO NOTHING;
END $$;

-- the batch writer adds the words too
CREATE OR REPLACE FUNCTION record_events(ws uuid, rows jsonb, channel text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  n int := jsonb_array_length(rows);
  last bigint;
  seq bigint;
  prev text;
  r jsonb;
  env jsonb;
BEGIN
  IF n = 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO workspace_event_counters (workspace_id, last_sequence) VALUES (ws, n)
  ON CONFLICT (workspace_id) DO UPDATE SET last_sequence = workspace_event_counters.last_sequence + n
  RETURNING last_sequence INTO last;
  seq := last - n;
  prev := coalesce(
    (SELECT hash FROM activity_events WHERE workspace_id = ws AND sequence = seq),
    (SELECT hash FROM activity_archive WHERE workspace_id = ws AND sequence = seq), '');
  FOR r IN SELECT value FROM jsonb_array_elements(rows) LOOP
    seq := seq + 1;
    env := jsonb_set(r -> 'envelope', '{sequence}', to_jsonb(seq));
    prev := encode(sha256(convert_to(prev || env::text, 'UTF8')), 'hex');
    INSERT INTO activity_events
      (workspace_id, sequence, id, type, time, actor_kind, actor_id, object_type, object_id, envelope,
       parent_type, parent_id, hash)
    VALUES (ws, seq, (r ->> 'id')::uuid, r ->> 'type', (r ->> 'time')::timestamptz, r ->> 'actor_kind',
       r ->> 'actor_id', r ->> 'object_type', r ->> 'object_id', env, r ->> 'parent_type', r ->> 'parent_id', prev);
  END LOOP;
  INSERT INTO activity_search (workspace_id, sequence, search)
  SELECT workspace_id, sequence, search FROM activity_events
   WHERE workspace_id = ws AND sequence > last - n AND sequence <= last;
  INSERT INTO activity_rollup (workspace_id, hour, archived, type, actor_kind, object_type, verb, project_id, n)
  SELECT ws, date_trunc('hour', (x ->> 'time')::timestamptz), false, x ->> 'type', x ->> 'actor_kind',
         x ->> 'object_type', coalesce(x -> 'envelope' -> 'data' ->> 'verb', ''),
         coalesce(x -> 'envelope' ->> 'projectid', ''), count(*)
    FROM jsonb_array_elements(rows) x GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  ON CONFLICT (workspace_id, archived, hour, type, actor_kind, object_type, verb, project_id)
    DO UPDATE SET n = activity_rollup.n + EXCLUDED.n;
  PERFORM pg_notify(channel, ws::text);
  RETURN last - n + 1;
END;
$$;
