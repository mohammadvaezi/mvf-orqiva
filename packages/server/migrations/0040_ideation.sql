-- ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
-- Why:  the Ideation tab of the approved design. An idea collects its sources (uploaded files, links,
--       pasted text, customer quotes as evidence); requirements, open questions, risks and assumptions are
--       taken from them, each requirement citing the passage it came from; several people score the idea
--       with RICE, ICE, WSJF, MoSCoW or value/effort and the spread shows where they disagree. Decisions
--       (ADR) and the glossary belong to the project, so agents use the same words. Ideation is the
--       team's own work: client contacts never see it.

ALTER TABLE ideas
  ADD COLUMN kind             text NOT NULL DEFAULT 'feature'
                              CHECK (kind IN ('feature', 'improvement', 'bug', 'research', 'change_request')),
  ADD COLUMN rejected_reason  text NOT NULL DEFAULT '' CHECK (length(rejected_reason) <= 2000),
  ADD COLUMN merged_into_id   uuid REFERENCES ideas (id) ON DELETE SET NULL,
  ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE idea_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  idea_id       uuid NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('file', 'link', 'text', 'quote')),
  file_id       uuid REFERENCES files (id) ON DELETE SET NULL,
  url           text NOT NULL DEFAULT '' CHECK (length(url) <= 2000),
  title         text NOT NULL DEFAULT '' CHECK (length(title) <= 300),
  body          text NOT NULL DEFAULT '' CHECK (length(body) <= 200000),
  -- for a quote: who said it (a customer, a user group)
  said_by       text NOT NULL DEFAULT '' CHECK (length(said_by) <= 200),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idea_sources_idea ON idea_sources (idea_id, created_at);

CREATE TABLE requirements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  idea_id       uuid NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  number        integer NOT NULL CHECK (number > 0),
  kind          text NOT NULL DEFAULT 'functional'
                CHECK (kind IN ('functional', 'non_functional', 'constraint', 'story', 'metric', 'out_of_scope', 'persona')),
  area          text NOT NULL DEFAULT 'scope'
                CHECK (area IN ('problem', 'users', 'scope', 'non_goals', 'non_functional', 'data', 'integrations', 'security')),
  text          text NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
  source_id     uuid REFERENCES idea_sources (id) ON DELETE SET NULL,
  -- the exact passage of the source the statement rests on
  passage       text NOT NULL DEFAULT '' CHECK (length(passage) <= 2000),
  status        text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected')),
  priority      text NOT NULL DEFAULT 'should' CHECK (priority IN ('must', 'should', 'could', 'wont')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idea_id, number)
);

CREATE TABLE idea_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  idea_id       uuid NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  text          text NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  area          text NOT NULL DEFAULT 'scope'
                CHECK (area IN ('problem', 'users', 'scope', 'non_goals', 'non_functional', 'data', 'integrations', 'security')),
  -- a named stakeholder the question is handed to
  owner_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  due_date      date,
  answer        text NOT NULL DEFAULT '' CHECK (length(answer) <= 8000),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'dropped')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  answered_at   timestamptz
);
CREATE INDEX idea_questions_idea ON idea_questions (idea_id, created_at);

CREATE TABLE idea_risks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  idea_id       uuid NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  text          text NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  likelihood    smallint NOT NULL DEFAULT 3 CHECK (likelihood BETWEEN 1 AND 5),
  impact        smallint NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
  mitigation    text NOT NULL DEFAULT '' CHECK (length(mitigation) <= 2000),
  owner_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'mitigated', 'accepted', 'closed')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idea_risks_idea ON idea_risks (idea_id, created_at);

CREATE TABLE idea_assumptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  idea_id       uuid NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  text          text NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  validate_how  text NOT NULL DEFAULT '' CHECK (length(validate_how) <= 2000),
  owner_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'validated', 'invalidated')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idea_assumptions_idea ON idea_assumptions (idea_id, created_at);

CREATE TABLE decisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  idea_id        uuid REFERENCES ideas (id) ON DELETE SET NULL,
  number         integer NOT NULL CHECK (number > 0),
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  context        text NOT NULL DEFAULT '' CHECK (length(context) <= 20000),
  decision       text NOT NULL DEFAULT '' CHECK (length(decision) <= 20000),
  consequences   text NOT NULL DEFAULT '' CHECK (length(consequences) <= 20000),
  status         text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'superseded', 'rejected')),
  superseded_by  uuid REFERENCES decisions (id) ON DELETE SET NULL,
  decided_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at     timestamptz,
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);

CREATE TABLE glossary_terms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  term          text NOT NULL CHECK (length(term) BETWEEN 1 AND 120),
  definition    text NOT NULL CHECK (length(definition) BETWEEN 1 AND 4000),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX glossary_terms_unique ON glossary_terms (project_id, lower(term));

CREATE TABLE idea_scores (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  idea_id       uuid NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  scorer_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  method        text NOT NULL CHECK (method IN ('rice', 'ice', 'wsjf', 'moscow', 'value_effort')),
  inputs        jsonb NOT NULL,
  score         double precision NOT NULL,
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, scorer_id, method)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['idea_sources', 'requirements', 'idea_questions', 'idea_risks', 'idea_assumptions',
                           'decisions', 'glossary_terms', 'idea_scores'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
  END LOOP;
END $$;
