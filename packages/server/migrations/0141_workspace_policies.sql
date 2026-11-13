-- ── [PCODE-352 | S15 | v0.1.0] T35.3c Policies for approvals, budgets and data, with a dry run ──
-- Why:  the workspace's rules the server keeps: a rule from the catalogue, its setting, the projects it is
--       for (none: all), and whether it is on or still a draft.

CREATE TABLE workspace_policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  rule          text NOT NULL CHECK (rule IN ('sprint_requires_criteria', 'agents_no_merge', 'run_token_cap', 'mask_personal_data')),
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  project_ids   uuid[] NOT NULL DEFAULT '{}',
  state         text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'on')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_policies_on ON workspace_policies (workspace_id, rule) WHERE state = 'on';
ALTER TABLE workspace_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON workspace_policies
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON workspace_policies AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_policies TO prodengine_app;
