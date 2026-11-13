-- ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
-- Why:  the backlog and the board keep work flowing. Tasks link to each other beyond scheduling: one relates
--       to another, duplicates it, or blocks it. A state may have a WIP limit. Each task ticks off the
--       definition of ready and of done. Work that comes from outside (agents, clients) waits in triage until a
--       person takes it. Templates make the same kind of task the same way, and a template can repeat.

CREATE TABLE item_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  from_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  to_id         uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  -- from relates to / duplicates / blocks to
  kind          text NOT NULL CHECK (kind IN ('relates', 'duplicates', 'blocks')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (from_id <> to_id),
  UNIQUE (from_id, to_id, kind)
);
CREATE INDEX item_links_to ON item_links (to_id);

ALTER TABLE project_states ADD COLUMN wip_limit integer CHECK (wip_limit BETWEEN 1 AND 999);

ALTER TABLE items
  -- the entries of the definitions ticked off on this task
  ADD COLUMN checks jsonb NOT NULL DEFAULT '{"ready": [], "done": []}'::jsonb,
  ADD COLUMN triage boolean NOT NULL DEFAULT false;
CREATE INDEX items_triage ON items (project_id) WHERE triage;

CREATE TABLE item_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
  kind          text NOT NULL DEFAULT 'task',
  priority      text NOT NULL DEFAULT 'none',
  estimate      integer CHECK (estimate BETWEEN 0 AND 1000),
  label_ids     uuid[] NOT NULL DEFAULT '{}',
  assignee_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  -- repeating: a new task each day, week (on weekday 1 to 7) or month (on day 1 to 28)
  repeat        text NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly')),
  repeat_on     integer CHECK (repeat_on BETWEEN 1 AND 28),
  next_on       date,
  last_item_id  uuid REFERENCES items (id) ON DELETE SET NULL,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX item_templates_due ON item_templates (next_on) WHERE repeat <> 'none';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_links', 'item_templates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
