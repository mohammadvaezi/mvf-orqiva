-- ── [PCODE-88 | S15 | v0.1.0] Implement authentication: email and password, sessions, OIDC login ──
-- Why:  sessions are opaque random tokens; only their SHA-256 is stored, so a copy of the database holds no
--       usable session. OIDC identities link an account at a company identity provider to a user. Login
--       states keep the PKCE verifier and nonce of a login in progress for ten minutes, shared by every
--       server instance. All of it is global (not per workspace) and reached only in system mode.

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE oidc_identities (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  issuer      text NOT NULL,
  subject     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);

CREATE TABLE oidc_login_states (
  state          text PRIMARY KEY,
  code_verifier  text NOT NULL,
  nonce          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The app role (workspace transactions) may see who people are, never their password hashes.
REVOKE SELECT ON users FROM prodengine_app;
GRANT SELECT (id, email, name, created_at) ON users TO prodengine_app;
