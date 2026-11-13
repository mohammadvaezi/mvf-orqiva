-- ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
-- Why:  clients work with the team through requests, not e-mail: a bug, a change, a feature or a question,
--       each with a thread, a response time the client can see, and for changes the cost and schedule
--       impact they approve. Internal notes sit in the same thread and never reach the client: PostgreSQL
--       hides them (client_scope), whatever the API asks for. Ratings after a closed request or a release
--       feed the client's satisfaction.

-- numbers per client (CR-9 of Helio), and the response times the team promises per kind, in hours
ALTER TABLE clients
  ADD COLUMN next_request_no integer NOT NULL DEFAULT 1,
  ADD COLUMN response_hours  jsonb NOT NULL DEFAULT '{"bug": 4, "change": 24, "feature": 24, "question": 24}'::jsonb;

CREATE TABLE client_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id          uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  project_id         uuid REFERENCES projects (id) ON DELETE SET NULL,
  number             integer NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('bug', 'change', 'feature', 'question')),
  title              text NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
  state              text NOT NULL DEFAULT 'new'
                     CHECK (state IN ('new', 'understood', 'quoted', 'planned', 'in_progress', 'done', 'declined')),
  source             text NOT NULL DEFAULT 'portal' CHECK (source IN ('portal', 'team', 'widget')),
  requested_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  item_id            uuid REFERENCES items (id) ON DELETE SET NULL,
  -- the first answer is due then; answered when the team first wrote to the client
  response_due_at    timestamptz NOT NULL,
  first_response_at  timestamptz,
  -- a change's cost and schedule: {"points": 8, "priceCents": 340000, "days": 2}
  impact             jsonb,
  quoted_at          timestamptz,
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, number)
);
CREATE INDEX client_requests_open ON client_requests (workspace_id, client_id) WHERE closed_at IS NULL;
CREATE INDEX client_requests_item ON client_requests (item_id) WHERE item_id IS NOT NULL;

CREATE TABLE client_request_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  request_id    uuid NOT NULL REFERENCES client_requests (id) ON DELETE CASCADE,
  author_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  -- 'team' is an internal note: the client never sees it
  visibility    text NOT NULL DEFAULT 'client' CHECK (visibility IN ('team', 'client')),
  file_ids      uuid[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_request_messages_request ON client_request_messages (request_id, created_at);

CREATE TABLE csat_ratings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  object_type   text NOT NULL CHECK (object_type IN ('request', 'release')),
  object_id     uuid NOT NULL,
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       text NOT NULL DEFAULT '' CHECK (length(comment) <= 2000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_type, object_id, user_id)
);
CREATE INDEX csat_ratings_client ON csat_ratings (client_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_requests', 'client_request_messages', 'csat_ratings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;

CREATE POLICY client_scope ON client_requests AS RESTRICTIVE
  USING (current_client_id() IS NULL OR client_id = current_client_id());
CREATE POLICY client_scope ON client_request_messages AS RESTRICTIVE
  USING (
    current_client_id() IS NULL
    OR (visibility = 'client'
        AND request_id IN (SELECT id FROM client_requests WHERE client_id = current_client_id()))
  )
  WITH CHECK (current_client_id() IS NULL OR visibility = 'client');
CREATE POLICY client_scope ON csat_ratings AS RESTRICTIVE
  USING (current_client_id() IS NULL OR client_id = current_client_id());

-- the task a request became moves the request: started → in progress, finished → done, back → planned
CREATE FUNCTION client_requests_follow_item() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE g text;
  BEGIN
    IF NEW.state_id IS NOT DISTINCT FROM OLD.state_id THEN
      RETURN NEW;
    END IF;
    SELECT grp INTO g FROM project_states WHERE id = NEW.state_id;
    UPDATE client_requests r SET
        state = CASE WHEN g = 'completed' THEN 'done'
                     WHEN g = 'started' THEN 'in_progress'
                     WHEN g = 'cancelled' THEN 'declined'
                     ELSE 'planned' END,
        closed_at = CASE WHEN g IN ('completed', 'cancelled') THEN coalesce(r.closed_at, now()) ELSE NULL END,
        updated_at = now()
      WHERE r.item_id = NEW.id AND r.state NOT IN ('new', 'understood', 'quoted');
    RETURN NEW;
  END $$;

CREATE TRIGGER client_requests_follow_item AFTER UPDATE OF state_id ON items
  FOR EACH ROW EXECUTE FUNCTION client_requests_follow_item();
