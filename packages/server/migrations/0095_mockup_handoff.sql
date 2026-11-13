-- ── [PCODE-292 | S15 | v0.1.0] T30.6 Handoff specs per mockup: tokens, components, states, breakpoints, measures, export areas ──
-- Why:  the handoff spec of one mockup version: what to build it from, its states and breakpoints,
--       distances measured on the image and the areas to export as assets.

CREATE TABLE mockup_handoff (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  mockup_id     uuid NOT NULL REFERENCES mockups (id) ON DELETE CASCADE,
  version       integer NOT NULL CHECK (version > 0),
  spec          jsonb NOT NULL,
  updated_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mockup_id, version),
  CHECK (length(spec::text) <= 200000)
);

ALTER TABLE mockup_handoff ENABLE ROW LEVEL SECURITY;
ALTER TABLE mockup_handoff FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON mockup_handoff
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON mockup_handoff AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON mockup_handoff TO prodengine_app;
