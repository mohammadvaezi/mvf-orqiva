-- ── [PCODE-413 | S15 | v0.1.0] T37 high: Activity facets answer under 1 s ──
-- Why:  the side of the activity page (total, histogram, heat map, facets) counted from hourly rows instead
--       of every event: each event adds one to its hour's row in the same statement that stores it, the
--       archive move shifts its counts from live to archived, and a search without free text or a time
--       window reads these rows. Filled here from the events already stored.

CREATE TABLE activity_rollup (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  hour          timestamptz NOT NULL,
  archived      boolean NOT NULL,
  type          text NOT NULL,
  actor_kind    text NOT NULL,
  object_type   text NOT NULL,
  verb          text NOT NULL,
  project_id    text NOT NULL,
  n             bigint NOT NULL CHECK (n >= 0),
  PRIMARY KEY (workspace_id, archived, hour, type, actor_kind, object_type, verb, project_id)
);

ALTER TABLE activity_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_rollup FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON activity_rollup
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
-- as for the events: a client's contact counts their own requests' events, and only those of their projects
CREATE POLICY client_scope ON activity_rollup AS RESTRICTIVE USING (
  current_client_id() IS NULL OR project_id = ''
  OR project_id IN (SELECT id::text FROM projects WHERE client_id = current_client_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON activity_rollup TO prodengine_app;

DO $$
BEGIN
  PERFORM set_config('app.system', 'on', true);
  INSERT INTO activity_rollup (workspace_id, hour, archived, type, actor_kind, object_type, verb, project_id, n)
  SELECT workspace_id, date_trunc('hour', time), false, type, actor_kind, object_type,
         coalesce(envelope->'data'->>'verb', ''), coalesce(project_id, ''), count(*)
    FROM activity_events GROUP BY 1, 2, 3, 4, 5, 6, 7, 8;
  INSERT INTO activity_rollup (workspace_id, hour, archived, type, actor_kind, object_type, verb, project_id, n)
  SELECT workspace_id, date_trunc('hour', time), true, type, actor_kind, object_type,
         coalesce(envelope->'data'->>'verb', ''), coalesce(project_id, ''), count(*)
    FROM activity_archive GROUP BY 1, 2, 3, 4, 5, 6, 7, 8;
END $$;

-- the batch writer adds its counts too
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
