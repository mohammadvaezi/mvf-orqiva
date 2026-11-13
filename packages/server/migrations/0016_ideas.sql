-- ── [PCODE-123 | S15 | v0.1.0] Add the ideas inbox and the AI owner interview ──
-- Why:  the front half starts here. An idea is filed in a project's inbox and the Interviewer agent asks
--       the owner what is missing, one question at a time; the conversation is kept in order, so the
--       proposal that follows can be traced back to what the owner actually said.

ALTER TABLE projects ADD COLUMN next_idea_seq integer NOT NULL DEFAULT 1;

CREATE TABLE ideas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  number          integer NOT NULL,
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body            text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'interviewing', 'proposed', 'approved', 'declined')),
  -- the interviewer said it has enough; its summary
  interview_done  boolean NOT NULL DEFAULT false,
  summary         text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);

CREATE TABLE idea_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  idea_id       uuid NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  seq           integer NOT NULL,
  role          text NOT NULL CHECK (role IN ('agent', 'owner')),
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  author_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  -- the agent run that wrote an agent message
  run_id        uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idea_id, seq)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ideas', 'idea_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
