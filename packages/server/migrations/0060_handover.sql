-- ── [PCODE-199 | S15 | v0.1.0] T16.3 Handover pack on the server: checks, team checklist, frozen packs, PDF, client acceptance in the portal ──
-- Why:  a project hands over to its client with a pack: the team's own checklist (things only people can
--       confirm, like credentials handed over outside Orqiva) and numbered packs, each a frozen snapshot of
--       the checks, the page versions, the release, the tests and the acceptance as they were when it was
--       sent. The client reads a sent pack in the portal and accepts it with a signed name, stored as an
--       approval over the pack's hash, or asks for changes. The checklist is the team's; packs of the
--       client's projects are the client's to read.

CREATE TABLE handover_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  label         text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  rank          integer NOT NULL DEFAULT 0,
  done          boolean NOT NULL DEFAULT false,
  done_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  done_at       timestamptz,
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX handover_items_project ON handover_items (project_id, rank);

CREATE TABLE handover_packs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  number          integer NOT NULL CHECK (number > 0),
  status          text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'changes_requested', 'superseded')),
  note            text NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  -- the frozen snapshot: checks, pages with their versions, release, tests, acceptance, open tasks
  contents        jsonb NOT NULL,
  -- sha-256 of the contents, what a signature is given over
  hash            text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  sent_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at      timestamptz,
  signed_name     text NOT NULL DEFAULT '' CHECK (length(signed_name) <= 200),
  decision_note   text NOT NULL DEFAULT '' CHECK (length(decision_note) <= 4000),
  UNIQUE (project_id, number)
);

ALTER TABLE handover_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE handover_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON handover_items USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON handover_items AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON handover_items TO prodengine_app;

ALTER TABLE handover_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE handover_packs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON handover_packs USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON handover_packs AS RESTRICTIVE USING (
  current_client_id() IS NULL OR project_id IN (SELECT id FROM projects WHERE client_id = current_client_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON handover_packs TO prodengine_app;

-- a client's signature on a pack is an approval like any other
ALTER TABLE approvals DROP CONSTRAINT approvals_object_type_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_object_type_check CHECK (object_type IN
  ('prd', 'design', 'change_request', 'quote', 'acceptance', 'release', 'risk', 'plan', 'token_scope', 'gate', 'handover'));
