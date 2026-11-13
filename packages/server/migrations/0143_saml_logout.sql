-- ── [PCODE-362 | S15 | v0.1.0] T35.7d SAML single logout ──
-- Why:  a session that began with SAML remembers who the identity provider said it was (NameID, its format
--       and the session index), so signing out can tell the provider, and a logout from the provider can
--       end exactly those sessions. The connection takes the provider's logout address.

ALTER TABLE sessions
  ADD COLUMN saml_workspace_id   uuid REFERENCES workspaces (id) ON DELETE SET NULL,
  ADD COLUMN saml_name_id        text CHECK (length(saml_name_id) <= 500),
  ADD COLUMN saml_name_id_format text CHECK (length(saml_name_id_format) <= 200),
  ADD COLUMN saml_session_index  text CHECK (length(saml_session_index) <= 200);
CREATE INDEX sessions_saml ON sessions (saml_workspace_id, saml_name_id) WHERE saml_workspace_id IS NOT NULL;

ALTER TABLE saml_connections
  ADD COLUMN slo_url text CHECK (slo_url ~ '^https://' AND length(slo_url) <= 1000);
