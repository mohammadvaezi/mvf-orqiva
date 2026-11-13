-- ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
-- Why:  a PRD is approved by the people named for it, team members and the client's contacts alike, each
--       signing the exact version; a new version voids the earlier decisions. Promotion is a step of its
--       own that turns the approved idea into an epic; after it the PRD is frozen.

-- an idea can be in review
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'ideas'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%interviewing%'
  LOOP
    EXECUTE format('ALTER TABLE ideas DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE ideas ADD CONSTRAINT ideas_status_check
  CHECK (status IN ('new', 'interviewing', 'proposed', 'in_review', 'approved', 'declined'));

ALTER TABLE ideas
  ADD COLUMN promoted_at timestamptz,
  ADD COLUMN epic_id     uuid REFERENCES items (id) ON DELETE SET NULL;

-- the owner signs per version now: an edit after approval asks for a new signature
DROP INDEX IF EXISTS proposal_signatures_approved;
CREATE UNIQUE INDEX proposal_signatures_approved ON proposal_signatures (proposal_id) WHERE decision = 'approved';

CREATE TABLE idea_approvers (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  idea_id       uuid NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, user_id)
);
ALTER TABLE idea_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_approvers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON idea_approvers
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON idea_approvers AS RESTRICTIVE
  USING (
    current_client_id() IS NULL
    OR idea_id IN (SELECT i.id FROM ideas i JOIN projects p ON p.id = i.project_id WHERE p.client_id = current_client_id())
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON idea_approvers TO prodengine_app;

-- the shared approvals block keeps what an electronic signature needs
ALTER TABLE approvals
  ADD COLUMN consent_text text NOT NULL DEFAULT '' CHECK (length(consent_text) <= 2000),
  ADD COLUMN ip           text NOT NULL DEFAULT '' CHECK (length(ip) <= 100),
  ADD COLUMN user_agent   text NOT NULL DEFAULT '' CHECK (length(user_agent) <= 500);
