-- ── [PCODE-198 | S15 | v0.1.0] T16.2 Documenter agent: document tools with knowledge scopes, agent-written drafts, Ask the Documenter ──
-- Why:  the Documenter agent reads and writes documentation through its own tools now. New workspaces get
--       them with the agent; existing Documenter agents get them here, in system mode, because agents sit
--       behind row-level security (the 0044/0048 pitfall). Tools a team removed on purpose stay removed
--       only for the other agents; the Documenter needs these three to do its job.
SELECT set_config('app.system', 'on', true);

UPDATE agents SET tools = tools || ARRAY['list_docs', 'read_doc', 'write_doc']
 WHERE key = 'documenter' AND NOT (tools && ARRAY['list_docs', 'read_doc', 'write_doc']);
