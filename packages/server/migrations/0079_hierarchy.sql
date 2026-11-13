-- ── [PCODE-257 | S15 | v0.1.0] T26.6 Hierarchy: initiatives, custom item types, custom fields ──
-- Why:  the plan above the epics and the shape of a team's own work. An initiative holds epics; a project
--       may name its own kinds of task on a base kind (an Incident on a bug) and its own fields (a customer,
--       a contract number, a go-live date), kept on each task and checked against their type.

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'items'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%milestone%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE items DROP CONSTRAINT %I', c);
  END IF;
END $$;
ALTER TABLE items ADD CONSTRAINT items_kind_check
  CHECK (kind IN ('initiative', 'epic', 'story', 'task', 'bug', 'spike', 'milestone'));

CREATE TABLE item_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  base_kind     text NOT NULL CHECK (base_kind IN ('initiative', 'epic', 'story', 'task', 'bug', 'spike', 'milestone')),
  color         text NOT NULL DEFAULT '#6b6a8a' CHECK (color ~ '^#[0-9a-f]{6}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE custom_fields (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  key           text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label         text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  type          text NOT NULL CHECK (type IN ('text', 'number', 'choice', 'date', 'person')),
  options       text[] NOT NULL DEFAULT '{}',
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);

ALTER TABLE items
  ADD COLUMN type_id uuid REFERENCES item_types (id) ON DELETE SET NULL,
  ADD COLUMN custom  jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX items_custom ON items USING gin (custom);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_types', 'custom_fields'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
