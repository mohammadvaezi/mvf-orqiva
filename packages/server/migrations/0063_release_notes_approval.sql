-- ── [PCODE-205 | S15 | v0.1.0] T17.3 Release agent with release tools, approved release notes, changelogs per release, project and train ──
-- Why:  release notes go out once a person approved them; a change to the notes asks again. Notes an agent
--       wrote are marked. The Release agent gets its release tools (existing agents too, in system mode,
--       because agents sit behind row-level security).
ALTER TABLE releases ADD COLUMN notes_approved_by uuid REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE releases ADD COLUMN notes_approved_at timestamptz;
ALTER TABLE releases ADD COLUMN notes_by_agent boolean NOT NULL DEFAULT false;

SELECT set_config('app.system', 'on', true);
UPDATE agents SET tools = tools || ARRAY['list_releases', 'read_release', 'write_release_notes']
 WHERE key = 'release' AND NOT (tools && ARRAY['list_releases', 'read_release', 'write_release_notes']);
