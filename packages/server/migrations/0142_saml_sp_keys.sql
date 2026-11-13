-- ── [PCODE-361 | S15 | v0.1.0] T35.7c SAML encrypted assertions ──
-- Why:  each workspace's own service provider key, for identity providers that encrypt assertions. The
--       private key is stored sealed with the server's ORQIVA_SECRET_KEY (AES-256-GCM), so a database copy
--       alone cannot read assertions; the certificate is public and goes into the SP metadata.

CREATE TABLE saml_sp_keys (
  workspace_id  uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  private_key   text NOT NULL CHECK (length(private_key) <= 20000),
  certificate   text NOT NULL CHECK (length(certificate) <= 20000),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE saml_sp_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE saml_sp_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON saml_sp_keys
  USING (workspace_id = current_workspace_id() OR in_system_mode())
  WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode());
CREATE POLICY client_scope ON saml_sp_keys AS RESTRICTIVE USING (current_client_id() IS NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON saml_sp_keys TO prodengine_app;
