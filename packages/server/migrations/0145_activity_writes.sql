-- ── [PCODE-412 | S15 | v0.1.0] T37 high: Activity takes 10 000 events per second ──
-- Why:  events in bulk (imports, agents, integrations) go in with one call: the counter moves once for the
--       whole batch, the hash chain is built inside the database, and one notify wakes the nodes. The
--       archive gets the index the chain's look-back needs, so the first event after an archive run does
--       not read the whole archive.

CREATE INDEX IF NOT EXISTS activity_archive_ws_sequence ON activity_archive (workspace_id, sequence);

-- rows: a JSON array of {id, type, time, actor_kind, actor_id, object_type, object_id, envelope,
-- parent_type, parent_id}; each envelope gets its sequence here. Returns the first sequence.
CREATE FUNCTION record_events(ws uuid, rows jsonb, channel text) RETURNS bigint
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
  PERFORM pg_notify(channel, ws::text);
  RETURN last - n + 1;
END;
$$;
GRANT EXECUTE ON FUNCTION record_events(uuid, jsonb, text) TO prodengine_app;
