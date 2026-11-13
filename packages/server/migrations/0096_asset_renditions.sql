-- ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
-- Why:  the sizes generated from an asset (scales, app icons, favicons, social images), each a file of the
--       project with its real pixel size; and which assets the client may download in the portal.

ALTER TABLE assets ADD COLUMN client_visible boolean NOT NULL DEFAULT false;

CREATE TABLE asset_renditions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  asset_id      uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  file_id       uuid NOT NULL REFERENCES files (id) ON DELETE RESTRICT,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200 AND left(name, 1) <> '/'
                                   AND strpos(name, '..') = 0 AND strpos(name, chr(92)) = 0),
  preset        text NOT NULL DEFAULT '' CHECK (length(preset) <= 40),
  format        text NOT NULL CHECK (format IN ('png', 'webp', 'jpeg', 'gif')),
  width         integer NOT NULL CHECK (width > 0),
  height        integer NOT NULL CHECK (height > 0),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, name)
);

ALTER TABLE asset_renditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_renditions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON asset_renditions
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON asset_renditions AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON asset_renditions TO prodengine_app;
