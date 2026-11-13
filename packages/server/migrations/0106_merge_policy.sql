-- ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
-- Why:  the hosts say whether a pull request merges cleanly; it is kept with the pull request. A project's
--       merge policy says what a pull request needs; Orqiva posts its verdict as the commit status
--       orqiva/policy, and keeps what it posted last so the same verdict is not posted twice.

ALTER TABLE pull_requests
  ADD COLUMN mergeable text NOT NULL DEFAULT 'unknown' CHECK (mergeable IN ('unknown', 'clean', 'conflicts', 'behind')),
  -- head commit, state and description of the status posted last
  ADD COLUMN policy_posted text NOT NULL DEFAULT '' CHECK (length(policy_posted) <= 300),
  ADD COLUMN policy_posted_at timestamptz,
  ADD COLUMN policy_error text NOT NULL DEFAULT '' CHECK (length(policy_error) <= 300);

CREATE TABLE merge_policies (
  project_id                 uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  workspace_id               uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  require_task               boolean NOT NULL DEFAULT false,
  require_fingerprints       boolean NOT NULL DEFAULT false,
  require_approval           boolean NOT NULL DEFAULT false,
  require_checks             boolean NOT NULL DEFAULT false,
  require_sensitive_approval boolean NOT NULL DEFAULT false,
  block_conflicts            boolean NOT NULL DEFAULT false,
  post_status                boolean NOT NULL DEFAULT false,
  updated_by                 uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE merge_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE merge_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON merge_policies
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON merge_policies AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON merge_policies TO prodengine_app;
