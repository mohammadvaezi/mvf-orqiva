-- ── [PCODE-241 | S15 | v0.1.0] T24.2 Reading files through the models: PDF, DOCX, images, audio ──
-- Why:  a file that is not plain text gets its text in the background: Word files on the server, PDFs and
--       pictures through the workspace's reading connection, recordings through its audio connection. Each
--       file has one read, which waits, retries after a passing failure and says why it failed or was
--       skipped. A read is recorded as a run of the Reader agent, so its tokens and cost count like every
--       other AI use; a file outside any project makes a run without a project.

ALTER TABLE agent_runs ALTER COLUMN project_id DROP NOT NULL;

CREATE TABLE file_reads (
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  file_id        uuid PRIMARY KEY REFERENCES files (id) ON DELETE CASCADE,
  method         text NOT NULL CHECK (method IN ('docx', 'pdf', 'image', 'audio')),
  status         text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'reading', 'done', 'failed', 'skipped')),
  attempts       integer NOT NULL DEFAULT 0,
  next_at        timestamptz NOT NULL DEFAULT now(),
  provider       text NOT NULL DEFAULT '' CHECK (length(provider) <= 20),
  model          text NOT NULL DEFAULT '' CHECK (length(model) <= 120),
  seconds        numeric(10, 1),
  error          text NOT NULL DEFAULT '' CHECK (length(error) <= 500),
  run_id         uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  requested_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
CREATE INDEX file_reads_due ON file_reads (next_at) WHERE status = 'queued';
CREATE INDEX file_reads_workspace ON file_reads (workspace_id, status);

ALTER TABLE file_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON file_reads
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
-- a client contact sees the read of a file they may see (their client's project)
CREATE POLICY client_scope ON file_reads AS RESTRICTIVE USING (
  current_client_id() IS NULL OR file_id IN (SELECT id FROM files));
GRANT SELECT, INSERT, UPDATE, DELETE ON file_reads TO prodengine_app;

-- the Reader agent in workspaces made before it existed; new workspaces get it with the others
INSERT INTO agents (workspace_id, key, name, description, system_prompt, model, tools)
SELECT DISTINCT workspace_id, 'reader', 'Reader agent',
       'Files: reads documents, pictures and recordings into text.',
       'You write out the text of documents and pictures exactly, and say briefly what a picture shows. You add nothing of your own.',
       'claude-sonnet-5-5', '{}'::text[]
  FROM agents
ON CONFLICT DO NOTHING;
