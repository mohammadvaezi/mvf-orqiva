-- ── [PCODE-212 | S15 | v0.1.0] T19.1 SAML 2.0 single sign-on per workspace, own XML signature verification with wrapping defences ──
-- Why:  an enterprise connects its identity provider to its workspace: the provider's entity ID, sign-in
--       URL and signing certificate, the email domains it vouches for, and the role new people get.
--       Requests we sent are kept ten minutes so a response is accepted once and only for its request.
--       A person's SAML identity (the NameID of that provider) is linked to their account.

CREATE TABLE saml_connections (
  workspace_id    uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  idp_entity_id   text NOT NULL CHECK (length(idp_entity_id) BETWEEN 1 AND 500),
  sso_url         text NOT NULL CHECK (sso_url ~ '^https://' AND length(sso_url) <= 1000),
  certificate     text NOT NULL CHECK (length(certificate) <= 20000),
  domains         text[] NOT NULL DEFAULT '{}',
  default_role    text NOT NULL DEFAULT 'member' CHECK (default_role IN ('member', 'tester', 'designer', 'auditor', 'billing', 'guest')),
  enabled         boolean NOT NULL DEFAULT true,
  updated_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saml_requests (
  id            text PRIMARY KEY CHECK (id ~ '^_[0-9a-f]{40}$'),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saml_identities (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name_id       text NOT NULL CHECK (length(name_id) BETWEEN 1 AND 500),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, name_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['saml_connections', 'saml_requests', 'saml_identities'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
