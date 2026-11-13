-- ── [PCODE-169 | S15 | v0.1.0] B3.2 Documents and UI kit on the server: page tree, versions, comments, backlinks, templates, knowledge, tokens, components, mockups, assets ──
-- Why:  the Documents and UI kit tabs of the approved design. Documents are the project's wiki and the
--       agents' knowledge: a tree of pages and folders, every save a version, comments on a passage,
--       backlinks, an owner and a review date so stale pages show, pages written by an agent marked until a
--       person approves them, and per agent what it may read and what it did read. The UI kit holds design
--       tokens (light and dark), the component inventory, mockups reviewed with pinned comments, and assets
--       with their rights. Both are the team's own; client contacts see neither.

CREATE TABLE doc_pages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES doc_pages (id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'page' CHECK (kind IN ('page', 'folder')),
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  rank            double precision NOT NULL DEFAULT 0,
  template        text NOT NULL DEFAULT '' CHECK (length(template) <= 40),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'published')),
  owner_id        uuid REFERENCES users (id) ON DELETE SET NULL,
  review_by       date,
  -- written by an agent: marked until a person approves it
  agent_written   boolean NOT NULL DEFAULT false,
  approved_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_at     timestamptz,
  -- generated from the repository (README, OpenAPI): the path, and the commit it was built from
  generated_from  text NOT NULL DEFAULT '' CHECK (length(generated_from) <= 500),
  locked_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  tags            text[] NOT NULL DEFAULT '{}',
  version         integer NOT NULL DEFAULT 0,
  body            text NOT NULL DEFAULT '' CHECK (length(body) <= 500000),
  search          tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || body)) STORED,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX doc_pages_tree ON doc_pages (project_id, parent_id, rank) WHERE deleted_at IS NULL;
CREATE INDEX doc_pages_search ON doc_pages USING gin (search);

CREATE TABLE doc_versions (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES doc_pages (id) ON DELETE CASCADE,
  version       integer NOT NULL CHECK (version > 0),
  title         text NOT NULL,
  body          text NOT NULL,
  -- a name people gave this version ("Sent to the client")
  name          text NOT NULL DEFAULT '' CHECK (length(name) <= 120),
  author_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  agent_run_id  uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, version)
);

CREATE TABLE doc_comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES doc_pages (id) ON DELETE CASCADE,
  -- the passage the comment is about (empty: about the whole page)
  anchor        text NOT NULL DEFAULT '' CHECK (length(anchor) <= 1000),
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 8000),
  author_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  resolved      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_comments_page ON doc_comments (page_id, created_at);

CREATE TABLE doc_links (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES doc_pages (id) ON DELETE CASCADE,
  -- a link to another page, or to the web
  to_page_id    uuid REFERENCES doc_pages (id) ON DELETE CASCADE,
  url           text NOT NULL DEFAULT '' CHECK (length(url) <= 2000),
  -- web links only: the last check
  http_status   integer,
  checked_at    timestamptz,
  CHECK ((to_page_id IS NULL) <> (url = ''))
);
CREATE INDEX doc_links_from ON doc_links (page_id);
CREATE INDEX doc_links_to ON doc_links (to_page_id);

CREATE TABLE doc_watchers (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES doc_pages (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, user_id)
);

CREATE TABLE knowledge_scopes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  agent_key     text NOT NULL CHECK (agent_key ~ '^[a-z][a-z0-9_-]{1,39}$'),
  -- a page (with what is below it) or a tag
  page_id       uuid REFERENCES doc_pages (id) ON DELETE CASCADE,
  tag           text NOT NULL DEFAULT '' CHECK (length(tag) <= 60),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((page_id IS NULL) <> (tag = ''))
);
CREATE INDEX knowledge_scopes_agent ON knowledge_scopes (project_id, agent_key);

CREATE TABLE knowledge_reads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  agent_key     text NOT NULL,
  agent_run_id  uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  page_id       uuid REFERENCES doc_pages (id) ON DELETE SET NULL,
  version       integer,
  -- the passage the agent cited
  passage       text NOT NULL DEFAULT '' CHECK (length(passage) <= 2000),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_reads_page ON knowledge_reads (page_id, created_at DESC);
CREATE INDEX knowledge_reads_project ON knowledge_reads (project_id, created_at DESC);

CREATE TABLE design_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- dotted path, e.g. color.primary or space.4
  name          text NOT NULL CHECK (name ~ '^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){0,5}$'),
  type          text NOT NULL CHECK (type IN ('color', 'dimension', 'fontFamily', 'fontWeight', 'duration', 'shadow', 'number')),
  value_light   text NOT NULL CHECK (length(value_light) BETWEEN 1 AND 300),
  value_dark    text NOT NULL DEFAULT '' CHECK (length(value_dark) <= 300),
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  updated_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE ui_components (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  status        text NOT NULL DEFAULT 'design' CHECK (status IN ('design', 'in_code', 'deprecated')),
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  code_path     text NOT NULL DEFAULT '' CHECK (length(code_path) <= 500),
  design_url    text NOT NULL DEFAULT '' CHECK (length(design_url) <= 2000),
  -- [{ "name": "variant", "type": "'primary' | 'ghost'", "default": "primary" }]
  props         jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage_count   integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  updated_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE mockups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  item_id       uuid REFERENCES items (id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'changes_requested')),
  version       integer NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mockups_project ON mockups (project_id, updated_at DESC);

CREATE TABLE mockup_versions (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  mockup_id     uuid NOT NULL REFERENCES mockups (id) ON DELETE CASCADE,
  version       integer NOT NULL CHECK (version > 0),
  file_id       uuid NOT NULL REFERENCES files (id) ON DELETE RESTRICT,
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mockup_id, version)
);

CREATE TABLE mockup_pins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  mockup_id     uuid NOT NULL REFERENCES mockups (id) ON DELETE CASCADE,
  version       integer NOT NULL,
  -- where on the image, as a share of its width and height
  x             real NOT NULL CHECK (x BETWEEN 0 AND 1),
  y             real NOT NULL CHECK (y BETWEEN 0 AND 1),
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  author_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  resolved      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mockup_pins_mockup ON mockup_pins (mockup_id, version);

CREATE TABLE assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  file_id       uuid NOT NULL REFERENCES files (id) ON DELETE RESTRICT,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  kind          text NOT NULL DEFAULT 'image' CHECK (kind IN ('logo', 'icon', 'image', 'font', 'video', 'other')),
  rights        text NOT NULL DEFAULT '' CHECK (length(rights) <= 1000),
  licence       text NOT NULL DEFAULT '' CHECK (length(licence) <= 200),
  expires_on    date,
  tags          text[] NOT NULL DEFAULT '{}',
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_project ON assets (project_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['doc_pages', 'doc_versions', 'doc_comments', 'doc_links', 'doc_watchers', 'knowledge_scopes',
                           'knowledge_reads', 'design_tokens', 'ui_components', 'mockups', 'mockup_versions',
                           'mockup_pins', 'assets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
  END LOOP;
END $$;
