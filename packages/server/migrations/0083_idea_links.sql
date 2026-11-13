-- ── [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code ──
-- Why:  a link given as a source is read by the server, so the Analyst extracts from what the page says and
--       not only from its address. The text is kept apart from the note someone typed with the link; a PDF
--       or Word file behind a link is stored as a file and read the way uploads are (file_id).

ALTER TABLE idea_sources
  ADD COLUMN link_text   text NOT NULL DEFAULT '' CHECK (length(link_text) <= 200000),
  ADD COLUMN link_status text NOT NULL DEFAULT 'none' CHECK (link_status IN ('none', 'reading', 'read', 'failed')),
  ADD COLUMN link_error  text NOT NULL DEFAULT '' CHECK (length(link_error) <= 500),
  ADD COLUMN link_read_at timestamptz;
