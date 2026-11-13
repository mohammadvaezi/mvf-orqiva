-- ── [PCODE-363 | S15 | v0.1.0] T35.7e Rate limits shared across cluster nodes ──
-- Why:  failed sign-ins, link requests and alike are counted here, so every node of a cluster sees the same
--       attempts and a guesser cannot spread them over nodes. Keys are hashed (no emails or addresses kept);
--       old rows are swept as new ones arrive.

CREATE TABLE rate_hits (
  scope     text NOT NULL CHECK (length(scope) BETWEEN 1 AND 40),
  key_hash  text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_hits_key ON rate_hits (scope, key_hash, at);
CREATE INDEX rate_hits_at ON rate_hits (at);
GRANT SELECT, INSERT, DELETE ON rate_hits TO prodengine_app;
