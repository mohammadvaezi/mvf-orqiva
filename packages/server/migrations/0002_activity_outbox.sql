-- ── [PCODE-89 | S15 | v0.1.0] Define the activity event envelope and the transactional outbox ──
-- Why:  every change records its activity event in the SAME transaction, so the live view can never
--       show something that did not happen, and never misses something that did. Events are numbered per
--       workspace through a counter row that is locked until commit: two writers in one workspace queue
--       on it, so sequence order is commit order and a rollback gives its number back. The relay (T02)
--       reads this table in sequence order; a client reconnecting with its last sequence replays the gap.

CREATE TABLE workspace_event_counters (
  workspace_id   uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  last_sequence  bigint NOT NULL CHECK (last_sequence >= 0)
);

CREATE TABLE activity_events (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  sequence      bigint NOT NULL CHECK (sequence > 0),
  id            uuid NOT NULL UNIQUE,
  type          text NOT NULL CHECK (type ~ '^prodengine\.[a-z_]+\.[a-z_]+$'),
  time          timestamptz NOT NULL,
  actor_kind    text NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system', 'integration')),
  actor_id      text NOT NULL,
  object_type   text NOT NULL,
  object_id     text NOT NULL,
  envelope      jsonb NOT NULL,
  PRIMARY KEY (workspace_id, sequence)
);
CREATE INDEX activity_events_object ON activity_events (workspace_id, object_type, object_id);
CREATE INDEX activity_events_time ON activity_events (time);

ALTER TABLE workspace_event_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_event_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON workspace_event_counters
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON activity_events
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());

-- events are history: the app role may add and read them, never change or remove them
GRANT SELECT, INSERT, UPDATE ON workspace_event_counters TO prodengine_app;
GRANT SELECT, INSERT ON activity_events TO prodengine_app;
