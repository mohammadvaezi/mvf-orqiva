-- ── [PCODE-150 | S15 | v0.1.0] Add the cloud tenant and harden sign-in, rate limits and headers ──
-- Why:  a second sign-in factor per person (the TOTP secret sealed with the server's key, the last step
--       used so no code works twice) with one-time recovery codes kept only as hashes; and the trial end
--       of a workspace created in the cloud.

CREATE TABLE user_totp (
  user_id            uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret_ciphertext  text NOT NULL,
  enabled_at         timestamptz,
  last_step          bigint,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_recovery_codes (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  PRIMARY KEY (user_id, code_hash)
);

ALTER TABLE workspaces ADD COLUMN trial_ends_at timestamptz;
