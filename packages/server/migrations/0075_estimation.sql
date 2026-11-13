-- ── [PCODE-252 | S15 | v0.1.0] T26.1 Estimation: units, async planning poker, suggestions from similar tasks, estimate vs actual ──
-- Why:  estimating together without a meeting. A round of planning poker belongs to one task; everyone
--       votes with a card, unseen by the others, until the round is revealed; whoever accepts a value makes it
--       the task's estimate. One round of a task is open at a time; past rounds stay for the record.

CREATE TABLE poker_rounds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  -- the unit the cards are in when the round starts
  unit          text NOT NULL CHECK (unit IN ('points', 'hours', 'tshirt')),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'revealed', 'closed')),
  started_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  accepted      integer CHECK (accepted BETWEEN 0 AND 1000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  revealed_at   timestamptz,
  closed_at     timestamptz
);
CREATE UNIQUE INDEX poker_rounds_one_open ON poker_rounds (item_id) WHERE status <> 'closed';
CREATE INDEX poker_rounds_item ON poker_rounds (item_id, created_at);

CREATE TABLE poker_votes (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  round_id      uuid NOT NULL REFERENCES poker_rounds (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  card          text NOT NULL CHECK (length(card) BETWEEN 1 AND 4),
  voted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, user_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['poker_rounds', 'poker_votes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;
