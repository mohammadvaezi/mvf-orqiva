-- ── [PCODE-284 | S15 | v0.1.0] T29.6 Documents: tree drag and drop, files, image annotation, read analytics, per-task knowledge, checked citations ──
-- Why:  files belong to pages and show in the tree; who read which version of a page is kept per person;
--       a page can be opened to the agents working on chosen tasks; an agent's citation is checked
--       against the page it read.

CREATE TABLE doc_files (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES doc_pages (id) ON DELETE CASCADE,
  file_id       uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  added_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, file_id)
);

CREATE TABLE doc_reads (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES doc_pages (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- the last version this person opened
  version       integer NOT NULL,
  reads         integer NOT NULL DEFAULT 1,
  first_at      timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, user_id)
);

CREATE TABLE item_knowledge (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES doc_pages (id) ON DELETE CASCADE,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, page_id)
);
CREATE INDEX item_knowledge_page ON item_knowledge (page_id);

ALTER TABLE knowledge_reads ADD COLUMN cited_ok boolean;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['doc_files', 'doc_reads', 'item_knowledge'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
-- client contacts read shared pages in the portal: their own reads count, and nothing else is theirs
CREATE POLICY client_scope ON doc_files AS RESTRICTIVE USING (current_client_id() IS NULL);
CREATE POLICY client_scope ON item_knowledge AS RESTRICTIVE USING (current_client_id() IS NULL);
