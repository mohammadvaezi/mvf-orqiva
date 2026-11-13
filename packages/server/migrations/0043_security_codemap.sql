-- ── [PCODE-176 | S15 | v0.1.0] B4.2 Security and Code map on the server: risk score, workflow, SBOM, policies, campaigns, posture, code files, hotspots, API inventory ──
-- Why:  the Security center and the Code map of the approved design. A finding carries what decides how
--       urgent it really is (CVE, EPSS, known exploited, reachable, exposed) folded into one risk score, a
--       workflow from new to verified beside its status, an SLA by severity, an accepted risk that expires,
--       and the task whose code introduced it. Each release can carry its SBOM; policies say what blocks a
--       merge or a release; campaigns remove one class of finding across projects. The code map keeps the
--       files of a scan with their metrics and the API endpoints with their auth and task.

ALTER TABLE findings
  ADD COLUMN cve             text NOT NULL DEFAULT '' CHECK (cve = '' OR cve ~ '^(CVE|GHSA)-[0-9A-Za-z-]{4,40}$'),
  ADD COLUMN package         text NOT NULL DEFAULT '' CHECK (length(package) <= 200),
  ADD COLUMN package_version text NOT NULL DEFAULT '' CHECK (length(package_version) <= 80),
  ADD COLUMN fixed_version   text NOT NULL DEFAULT '' CHECK (length(fixed_version) <= 80),
  ADD COLUMN cvss            real CHECK (cvss BETWEEN 0 AND 10),
  ADD COLUMN epss            real CHECK (epss BETWEEN 0 AND 1),
  ADD COLUMN kev             boolean NOT NULL DEFAULT false,
  ADD COLUMN reachable       boolean,
  ADD COLUMN exposed         boolean,
  ADD COLUMN risk_score      integer NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  ADD COLUMN workflow        text NOT NULL DEFAULT 'new' CHECK (workflow IN ('new', 'confirmed', 'fixing', 'verified')),
  ADD COLUMN accepted_until  date,
  ADD COLUMN sla_due_at      timestamptz,
  ADD COLUMN introduced_by_item uuid REFERENCES items (id) ON DELETE SET NULL;
CREATE INDEX findings_package ON findings (workspace_id, package);

CREATE TABLE sboms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  release_id    uuid REFERENCES releases (id) ON DELETE SET NULL,
  format        text NOT NULL CHECK (format IN ('cyclonedx', 'spdx')),
  -- [{ "name": "lodash", "version": "4.17.21", "purl": "pkg:npm/lodash@4.17.21", "licences": ["MIT"] }]
  components    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sboms_project ON sboms (project_id, created_at DESC);
CREATE INDEX sboms_components ON sboms USING gin (components jsonb_path_ops);

CREATE TABLE policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- null: every project of the workspace
  project_id    uuid REFERENCES projects (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  applies_to    text NOT NULL CHECK (applies_to IN ('merge', 'release')),
  -- { "maxSeverity": "high", "minRisk": 70, "bannedLicences": ["AGPL-3.0"], "liveSecrets": true, "newOnly": true }
  rule          jsonb NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  -- what the campaign removes: a rule, a package or a CVE (one of them)
  rule          text NOT NULL DEFAULT '' CHECK (length(rule) <= 200),
  package       text NOT NULL DEFAULT '' CHECK (length(package) <= 200),
  cve           text NOT NULL DEFAULT '' CHECK (length(cve) <= 60),
  due_date      date,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'cancelled')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((rule <> '')::int + (package <> '')::int + (cve <> '')::int = 1)
);

CREATE TABLE code_files (
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  path            text NOT NULL CHECK (length(path) BETWEEN 1 AND 500),
  language        text NOT NULL DEFAULT '' CHECK (length(language) <= 40),
  lines           integer NOT NULL DEFAULT 0 CHECK (lines >= 0),
  complexity      integer NOT NULL DEFAULT 0 CHECK (complexity >= 0),
  -- commits that touched it in the last 90 days
  churn           integer NOT NULL DEFAULT 0 CHECK (churn >= 0),
  -- { "ada": 120, "Coder agent": 40 }: lines last written by each author
  authors         jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_share     real NOT NULL DEFAULT 0 CHECK (agent_share BETWEEN 0 AND 1),
  last_commit_at  timestamptz,
  scanned_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, path)
);

CREATE TABLE api_endpoints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'http' CHECK (kind IN ('http', 'event', 'table')),
  method        text NOT NULL DEFAULT '' CHECK (length(method) <= 10),
  path          text NOT NULL CHECK (length(path) BETWEEN 1 AND 500),
  summary       text NOT NULL DEFAULT '' CHECK (length(summary) <= 1000),
  -- 'none', 'session', 'token', 'api key', or what the spec names
  auth          text NOT NULL DEFAULT 'unknown' CHECK (length(auth) <= 80),
  tag           text NOT NULL DEFAULT '' CHECK (length(tag) <= 80),
  item_id       uuid REFERENCES items (id) ON DELETE SET NULL,
  source        text NOT NULL DEFAULT 'openapi' CHECK (source IN ('openapi', 'scan', 'manual')),
  seen_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, method, path)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sboms', 'policies', 'campaigns', 'code_files', 'api_endpoints'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
  END LOOP;
END $$;
