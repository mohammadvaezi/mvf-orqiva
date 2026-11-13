-- ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
-- Why:  the client sees money and meets the team in the portal instead of by e-mail. Invoices are kept
--       with their lines, so the PDF can always be made again exactly as sent; a client contact sees only
--       their client's invoices once they are sent, never a draft. Meetings are booked by the client in
--       free slots of their account owner and project leads.

ALTER TABLE workspaces ADD COLUMN next_invoice_no integer NOT NULL DEFAULT 1;

CREATE TABLE client_invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  number        text NOT NULL CHECK (length(number) BETWEEN 1 AND 40),
  period_label  text NOT NULL DEFAULT '' CHECK (length(period_label) <= 120),
  period_from   date,
  period_to     date,
  -- [{ "text": "Engineering, October", "quantity": 12.5, "unit": "h", "unitCents": 11000, "amountCents": 137500 }]
  lines         jsonb NOT NULL DEFAULT '[]'::jsonb,
  net_cents     bigint NOT NULL DEFAULT 0,
  vat_pct       numeric(5, 2) NOT NULL DEFAULT 19 CHECK (vat_pct >= 0 AND vat_pct <= 100),
  gross_cents   bigint NOT NULL DEFAULT 0,
  state         text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'sent', 'paid', 'void')),
  issued_on     date,
  due_on        date,
  paid_on       date,
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, number)
);
CREATE INDEX client_invoices_client ON client_invoices (client_id, created_at DESC);

CREATE TABLE meetings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id      uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  kind           text NOT NULL DEFAULT 'review' CHECK (kind IN ('review', 'demo', 'other')),
  starts_at      timestamptz NOT NULL,
  minutes        integer NOT NULL DEFAULT 45 CHECK (minutes BETWEEN 15 AND 240),
  attendee_ids   uuid[] NOT NULL DEFAULT '{}',
  booked_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  agenda         text NOT NULL DEFAULT '' CHECK (length(agenda) <= 10000),
  video_url      text NOT NULL DEFAULT '' CHECK (length(video_url) <= 500),
  state          text NOT NULL DEFAULT 'booked' CHECK (state IN ('booked', 'cancelled')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meetings_client ON meetings (client_id, starts_at);
CREATE INDEX meetings_when ON meetings (workspace_id, starts_at) WHERE state = 'booked';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_invoices', 'meetings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
  END LOOP;
END $$;

CREATE POLICY client_scope ON client_invoices AS RESTRICTIVE
  USING (current_client_id() IS NULL OR (client_id = current_client_id() AND state <> 'draft'));
CREATE POLICY client_scope ON meetings AS RESTRICTIVE
  USING (current_client_id() IS NULL OR client_id = current_client_id());
