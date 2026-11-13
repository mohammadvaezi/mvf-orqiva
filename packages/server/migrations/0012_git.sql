-- ── [PCODE-108 | S15 | v0.1.0] Integrate Git hosts: GitHub and Gitea webhooks, commits and PRs on items, live ──
-- Why:  the code side of a task, from the Git host itself: a project connects its repositories, the host
--       calls our webhook on every push and pull request, and every task reference it carries (PCODE-12
--       in a commit message, a PR title or a branch) links the commit or PR to the item. The webhook
--       secret is kept as given, because checking a signature needs it; the API shows it only once.

CREATE TABLE git_connections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  provider      text NOT NULL CHECK (provider IN ('github', 'gitea')),
  repo          text NOT NULL CHECK (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  secret        text NOT NULL CHECK (length(secret) >= 32),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_delivery_at timestamptz,
  UNIQUE (project_id, provider, repo)
);
ALTER TABLE git_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE git_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON git_connections
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON git_connections TO prodengine_app;

CREATE TABLE item_git_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES git_connections (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('commit', 'pull_request')),
  -- the commit hash, or the pull request's number
  ref           text NOT NULL CHECK (length(ref) BETWEEN 1 AND 64),
  title         text NOT NULL DEFAULT '',
  url           text NOT NULL DEFAULT '',
  author        text NOT NULL DEFAULT '',
  -- pull requests: open, closed or merged; commits: the branch they were pushed to
  state         text NOT NULL DEFAULT '',
  at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, connection_id, kind, ref)
);
CREATE INDEX item_git_links_item ON item_git_links (item_id, at);
ALTER TABLE item_git_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_git_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON item_git_links
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
GRANT SELECT, INSERT, UPDATE, DELETE ON item_git_links TO prodengine_app;
