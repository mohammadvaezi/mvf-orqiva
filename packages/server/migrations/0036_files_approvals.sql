-- ── [PCODE-161 | S15 | v0.1.0] B0 data model v2: model for all approved screens and the foundation migrations ──
-- Why:  two building blocks many screens share. Files: uploads, screenshots, recordings, voice notes and
--       generated documents, stored by content hash in our own blob store, with their OCR text or
--       transcript so agents and search can read them; a file is shown to a client only when marked so.
--       Approvals: one record for every sign-off (PRD, design, change request, quote, acceptance round,
--       release, risk acceptance), bound to the exact version that was approved.

CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  mime          text NOT NULL CHECK (length(mime) BETWEEN 3 AND 120),
  size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- where the bytes live in the blob store (data/blobs/ab/cd/<sha256>)
  storage_key   text NOT NULL CHECK (length(storage_key) <= 300),
  -- text the AI and search may read: OCR of images and PDFs, transcript of audio and video
  text_content  text NOT NULL DEFAULT '',
  text_kind     text NOT NULL DEFAULT 'none' CHECK (text_kind IN ('none', 'extracted', 'ocr', 'transcript')),
  -- personal data blurred before storage (screenshots from tests)
  masked        boolean NOT NULL DEFAULT false,
  client_visible boolean NOT NULL DEFAULT false,
  uploaded_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX files_project ON files (workspace_id, project_id, created_at DESC);
CREATE INDEX files_hash ON files (workspace_id, sha256);

CREATE TABLE approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid REFERENCES projects (id) ON DELETE CASCADE,
  object_type   text NOT NULL CHECK (object_type IN ('prd', 'design', 'change_request', 'quote', 'acceptance', 'release', 'risk', 'plan', 'token_scope', 'gate')),
  object_id     text NOT NULL CHECK (length(object_id) BETWEEN 1 AND 120),
  -- the exact version decided on; an edit after it reopens the approval
  version_hash  text NOT NULL CHECK (version_hash ~ '^[0-9a-f]{64}$'),
  approver_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  decision      text NOT NULL CHECK (decision IN ('approved', 'declined')),
  -- the typed name of an electronic signature
  signed_name   text NOT NULL DEFAULT '' CHECK (length(signed_name) <= 200),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  valid_until   date,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_object ON approvals (workspace_id, object_type, object_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['files', 'approvals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;

CREATE POLICY client_scope ON files AS RESTRICTIVE
  USING (
    current_client_id() IS NULL
    OR (client_visible AND project_id IN (SELECT id FROM projects WHERE client_id = current_client_id()))
  );
CREATE POLICY client_scope ON approvals AS RESTRICTIVE
  USING (current_client_id() IS NULL OR project_id IN (SELECT id FROM projects WHERE client_id = current_client_id()));
