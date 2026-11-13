-- ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
-- Why:  one rule for which projects a guest sees, instead of the same subquery in every API: a project
--       they were invited to, or a project of the client they are a contact of. Invitations can make
--       someone a contact of a client in a portal role, and can carry the new roles.

CREATE FUNCTION guest_sees_project(p uuid, u uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (SELECT 1 FROM project_guests g WHERE g.project_id = p AND g.user_id = u)
        OR EXISTS (
          SELECT 1 FROM projects pr JOIN client_contacts cc ON cc.client_id = pr.client_id
          WHERE pr.id = p AND cc.user_id = u
        )
  $$;

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'invitations'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%role%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE invitations DROP CONSTRAINT %I', c);
  END IF;
END $$;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('admin', 'member', 'tester', 'designer', 'billing', 'auditor', 'guest'));

ALTER TABLE invitations ADD COLUMN client_id uuid REFERENCES clients (id) ON DELETE CASCADE;
ALTER TABLE invitations ADD COLUMN portal_role text
  CHECK (portal_role IN ('sponsor', 'approver', 'product_owner', 'tester', 'requester', 'viewer'));
ALTER TABLE invitations ADD CONSTRAINT invitations_client_role
  CHECK ((client_id IS NULL) = (portal_role IS NULL) AND (client_id IS NULL OR role = 'guest'));
