-- ── [PCODE-323 | S15 | v0.1.0] T32.7b VEX statements and the security posture per version ──
-- Why:  whether a shipped version is affected by a CVE in one of its packages is a person's statement, kept
--       per release, vulnerability and package, and exported as OpenVEX.

CREATE TABLE vex_statements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  release_id     uuid NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  cve            text NOT NULL CHECK (cve ~ '^(CVE|GHSA)-'),
  package        text NOT NULL CHECK (length(package) BETWEEN 1 AND 200),
  status         text NOT NULL CHECK (status IN ('not_affected', 'affected', 'fixed', 'under_investigation')),
  justification  text CHECK (justification IS NULL OR justification IN ('component_not_present',
                   'vulnerable_code_not_present', 'vulnerable_code_not_in_execute_path',
                   'vulnerable_code_cannot_be_controlled_by_adversary', 'inline_mitigations_already_exist')),
  note           text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  author_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, cve, package),
  -- OpenVEX: "not affected" always says why
  CHECK (status <> 'not_affected' OR justification IS NOT NULL)
);

ALTER TABLE vex_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE vex_statements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON vex_statements
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON vex_statements AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON vex_statements TO prodengine_app;
