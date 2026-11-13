-- ── [PCODE-303 | S15 | v0.1.0] T31.4 Line comments from people and the AI, posted to the host with approve or request changes ──
-- Why:  a reviewer writes comments on lines of a pull request's diff; they stay drafts until the reviewer
--       submits a review, which posts them to the host with the decision. The Reviewer agent suggests
--       comments too: a person accepts one (it becomes that person's draft) or dismisses it. Each comment
--       keeps the patch's hash of its file, so a push that changes the file shows it as outdated.

CREATE TABLE pull_request_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  pull_request_id uuid NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
  path            text NOT NULL CHECK (length(path) BETWEEN 1 AND 1000),
  line            integer NOT NULL CHECK (line > 0),
  side            text NOT NULL DEFAULT 'new' CHECK (side IN ('new', 'old')),
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  source          text NOT NULL CHECK (source IN ('person', 'ai')),
  -- suggested and dismissed are the AI's; a draft waits for its author's review; posted went to the host
  state           text NOT NULL CHECK (state IN ('suggested', 'dismissed', 'draft', 'posted')),
  severity        text CHECK (severity IS NULL OR severity IN ('note', 'warning', 'risk')),
  author_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  run_id          uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  review_id       uuid,
  patch_hash      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  posted_at       timestamptz
);
CREATE INDEX pull_request_comments_pull ON pull_request_comments (pull_request_id, path, line);

CREATE TABLE pull_request_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  pull_request_id uuid NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users (id) ON DELETE SET NULL,
  decision        text NOT NULL CHECK (decision IN ('approve', 'request_changes', 'comment')),
  body            text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  comments        integer NOT NULL DEFAULT 0,
  -- what the host called it, to link to
  host_ref        text NOT NULL DEFAULT '' CHECK (length(host_ref) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pull_request_reviews_pull ON pull_request_reviews (pull_request_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pull_request_comments', 'pull_request_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
