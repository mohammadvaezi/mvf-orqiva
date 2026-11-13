-- ── [PCODE-125 | S15 | v0.1.0] Approve proposals with an electronic signature and turn them into a plan ──
-- Why:  the owner's go / no-go is a signature, not a click: who signed, the name they typed, what they
--       agreed to, when, from where, and a SHA-256 of the exact proposal version, so the signed text can be
--       proved later. An approved idea becomes tasks; the link from each task back to its idea is kept.

CREATE TABLE proposal_signatures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  idea_id         uuid NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  proposal_id     uuid NOT NULL REFERENCES proposals (id) ON DELETE RESTRICT,
  decision        text NOT NULL CHECK (decision IN ('approved', 'declined')),
  signer_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  -- the name as typed, and the account's name at that moment
  typed_name      text NOT NULL CHECK (length(typed_name) BETWEEN 1 AND 200),
  account_name    text NOT NULL,
  account_email   text NOT NULL,
  consent_text    text NOT NULL,
  content_sha256  text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  note            text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  ip              text NOT NULL DEFAULT '',
  user_agent      text NOT NULL DEFAULT '',
  signed_at       timestamptz NOT NULL DEFAULT now()
);
-- an idea is approved once
CREATE UNIQUE INDEX proposal_signatures_approved ON proposal_signatures (idea_id) WHERE decision = 'approved';

CREATE TABLE idea_items (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  idea_id       uuid NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  position      integer NOT NULL,
  PRIMARY KEY (idea_id, item_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['proposal_signatures', 'idea_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
