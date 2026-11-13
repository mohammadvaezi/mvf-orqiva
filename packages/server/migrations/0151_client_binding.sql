-- ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
-- Why:  work is done for someone. A project belongs to a client (projects.client_id), or it is marked as
--       internal on purpose, so "no client" is never an accident. A client request is served by the
--       tasks planned for it, often several: client_request_items links them, so a request shows the
--       tasks that answer it and a task the request it is for. client_requests.item_id (a request turned
--       into one task) stays as it is.

ALTER TABLE projects ADD COLUMN internal boolean NOT NULL DEFAULT false;

CREATE TABLE client_request_items (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  request_id    uuid NOT NULL REFERENCES client_requests (id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, item_id)
);
CREATE INDEX client_request_items_item ON client_request_items (item_id);

ALTER TABLE client_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_request_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON client_request_items
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON client_request_items AS RESTRICTIVE
  USING (current_client_id() IS NULL
         OR request_id IN (SELECT id FROM client_requests WHERE client_id = current_client_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON client_request_items TO prodengine_app;
