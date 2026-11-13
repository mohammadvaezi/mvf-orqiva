-- ── [PCODE-282 | S15 | v0.1.0] T29.4 Live co-editing of documents with our own three-way merge ──
-- Why:  people edit one page at once through a shared live draft: each sends its text with the revision it
--       last saw, the server merges three ways against that revision and hands back the result. The last
--       revisions are kept as ancestors; saving makes the draft the page's next version.

CREATE TABLE doc_live (
  page_id       uuid PRIMARY KEY REFERENCES doc_pages (id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- the page version the draft started from (or was last merged with)
  base_version  integer NOT NULL,
  rev           integer NOT NULL CHECK (rev > 0),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body          text NOT NULL CHECK (length(body) <= 500000),
  updated_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doc_live_revs (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES doc_pages (id) ON DELETE CASCADE,
  rev           integer NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL,
  PRIMARY KEY (page_id, rev)
);

CREATE TABLE doc_live_editors (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES doc_pages (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seen_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, user_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['doc_live', 'doc_live_revs', 'doc_live_editors'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
