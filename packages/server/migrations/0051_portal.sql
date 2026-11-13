-- ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
-- Why:  the portal shows a client what the team decides to share, and nothing else. The team marks what is
--       shared (a page, a mockup for approval, a test run as an acceptance round); each contact's reads
--       are kept so the portal can say what is new. And the older tables, written before clients existed,
--       get the same restrictive client policy as the newer ones: a client contact's transaction sees only
--       its own client's projects there, and nothing at all of the team's own work.

ALTER TABLE doc_pages ADD COLUMN client_visible boolean NOT NULL DEFAULT false;
ALTER TABLE mockups ADD COLUMN client_visible boolean NOT NULL DEFAULT false;
ALTER TABLE test_runs
  ADD COLUMN client_round boolean NOT NULL DEFAULT false,
  ADD COLUMN due_on       date;

-- what a contact has read, and which version: a newer version is new again
CREATE TABLE portal_reads (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  object_type   text NOT NULL CHECK (object_type IN ('doc', 'file', 'release')),
  object_id     uuid NOT NULL,
  version       integer NOT NULL DEFAULT 0,
  read_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, object_type, object_id)
);
ALTER TABLE portal_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON portal_reads
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_reads TO prodengine_app;

DO $$
DECLARE t text;
BEGIN
  -- project data: a client contact sees only its client's projects
  FOREACH t IN ARRAY ARRAY['agent_runs', 'deploy_runs', 'environments', 'gate_criteria', 'gate_signoffs',
      'item_fingerprints', 'labels', 'lifecycle_stages', 'project_lifecycles', 'project_states', 'sprints',
      'test_cases', 'test_runs', 'project_guests'] LOOP
    EXECUTE format(
      'CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL OR project_id IN (SELECT id FROM projects WHERE client_id = current_client_id()))',
      t);
  END LOOP;
  -- rows that may belong to no project (a contact's own inbox, filters, events of their requests);
  -- compared as text, since an event's project is taken from its JSON
  FOREACH t IN ARRAY ARRAY['activity_events', 'activity_archive', 'inbox_items', 'saved_filters'] LOOP
    EXECUTE format(
      'CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL OR project_id IS NULL OR project_id::text IN (SELECT id::text FROM projects WHERE client_id = current_client_id()))',
      t);
  END LOOP;
  -- the team's own work: never visible to a client contact
  FOREACH t IN ARRAY ARRAY['ideas', 'idea_items', 'idea_messages', 'proposals', 'proposal_signatures',
      'git_connections', 'control_evidence', 'control_exemptions', 'project_frameworks', 'security_scans',
      'findings', 'agents', 'agent_steps', 'agent_provider_settings', 'environment_secrets', 'deploy_steps',
      'runners', 'import_links', 'lifecycle_templates', 'sprint_capacity'] LOOP
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
  END LOOP;
END $$;
