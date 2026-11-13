-- ── [PCODE-197 | S15 | v0.1.0] T16.1 Docs from code: API reference, system overview and built-by-task pages, drift warnings ──
-- Why:  pages built from the code (the API reference per tag, the system overview, which task built which
--       files) are rebuilt in place: each keeps a key naming its source, so a rebuild updates the same page
--       and its history instead of adding a new one. Pages written by hand have no key.
ALTER TABLE doc_pages ADD COLUMN generated_key text CHECK (length(generated_key) BETWEEN 1 AND 80);
CREATE UNIQUE INDEX doc_pages_generated ON doc_pages (project_id, generated_key)
  WHERE generated_key IS NOT NULL AND deleted_at IS NULL;
