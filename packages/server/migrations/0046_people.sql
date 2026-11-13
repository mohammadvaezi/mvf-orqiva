-- ── [PCODE-182 | S15 | v0.1.0] B5.3 People live: members, teams, roles, sign-in rules and sessions, access reviews, access checker, offboarding ──
-- Why:  the People section of the approved design. A membership can be suspended (offboarding): the
--       person keeps their name in the history but reaches nothing and takes no seat. A session knows the
--       device and address it came from, so people see and end their sessions. A workspace sets who needs
--       a second factor and how long sessions live. An access review asks for each person's access to be
--       kept, changed or removed, and keeps the answers.

ALTER TABLE workspace_members
  ADD COLUMN suspended_at  timestamptz,
  ADD COLUMN suspended_by  uuid REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE sessions
  ADD COLUMN user_agent  text NOT NULL DEFAULT '' CHECK (length(user_agent) <= 300),
  ADD COLUMN ip          text NOT NULL DEFAULT '' CHECK (length(ip) <= 60);

CREATE TABLE workspace_security (
  workspace_id        uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  -- roles that must have a second factor to reach the workspace
  mfa_roles           text[] NOT NULL DEFAULT '{}',
  session_idle_hours  integer CHECK (session_idle_hours BETWEEN 1 AND 720),
  session_max_days    integer CHECK (session_max_days BETWEEN 1 AND 365),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  due_on        date,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);

CREATE TABLE access_review_items (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  review_id     uuid NOT NULL REFERENCES access_reviews (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role          text NOT NULL,
  decision      text CHECK (decision IN ('keep', 'change', 'remove')),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  decided_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at    timestamptz,
  PRIMARY KEY (review_id, user_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workspace_security', 'access_reviews', 'access_review_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (workspace_id = current_workspace_id() OR in_system_mode()) WITH CHECK (workspace_id = current_workspace_id() OR in_system_mode())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prodengine_app', t);
    EXECUTE format('CREATE POLICY client_scope ON %I AS RESTRICTIVE USING (current_client_id() IS NULL)', t);
  END LOOP;
END $$;

-- service accounts (0045) are told apart in workspace queries; the app role reads only named columns of users
GRANT SELECT (is_service) ON users TO prodengine_app;
