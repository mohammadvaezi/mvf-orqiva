-- ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
-- Why:  what the client says beyond a single request: votes on requests, duplicates merged into one, a
--       recommendation score now and then, and feedback from the client's own site through a widget.

ALTER TABLE client_requests
  ADD COLUMN merged_into uuid REFERENCES client_requests (id) ON DELETE SET NULL,
  ADD COLUMN widget_id   uuid,
  ADD COLUMN page_url    text NOT NULL DEFAULT '' CHECK (length(page_url) <= 1000);

CREATE TABLE client_request_votes (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  request_id    uuid NOT NULL REFERENCES client_requests (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id)
);

CREATE TABLE client_nps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  score         smallint NOT NULL CHECK (score BETWEEN 0 AND 10),
  comment       text NOT NULL DEFAULT '' CHECK (length(comment) <= 2000),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_nps_client ON client_nps (client_id, created_at DESC);

CREATE TABLE feedback_widgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  project_id    uuid REFERENCES projects (id) ON DELETE SET NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- shown in the client's page source: it names the widget, it is no secret
  public_key    text NOT NULL UNIQUE CHECK (public_key ~ '^wk_[A-Za-z0-9_-]{20,40}$'),
  origins       text[] NOT NULL DEFAULT '{}' CHECK (cardinality(origins) <= 20),
  enabled       boolean NOT NULL DEFAULT true,
  received      integer NOT NULL DEFAULT 0,
  last_used_at  timestamptz,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE client_requests ADD CONSTRAINT client_requests_widget FOREIGN KEY (widget_id) REFERENCES feedback_widgets (id) ON DELETE SET NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_request_votes', 'client_nps', 'feedback_widgets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
CREATE POLICY client_scope ON client_request_votes AS RESTRICTIVE
  USING (current_client_id() IS NULL OR request_id IN (SELECT id FROM client_requests WHERE client_id = current_client_id()));
CREATE POLICY client_scope ON client_nps AS RESTRICTIVE
  USING (current_client_id() IS NULL OR client_id = current_client_id());
CREATE POLICY client_scope ON feedback_widgets AS RESTRICTIVE USING (current_client_id() IS NULL);
