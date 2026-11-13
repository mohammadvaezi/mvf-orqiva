-- ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
-- Why:  the product is Orqiva now. Applied migrations stay as they are (they are checksummed), so the
--       old names they created keep existing and the new ones join them:
--       - the server's row-level role is orqiva_app. Roles belong to the whole cluster (other databases
--         may still use prodengine_app), so the old role is not renamed: orqiva_app becomes a member of
--         it and inherits exactly its grants, including the column-level ones on users. New tables are
--         granted to orqiva_app from here on.
--       - system mode stays closed to both row-level roles.
--       - events are typed orqiva.{object}.{verb}; the ones written before keep prodengine.* and stay
--         valid in the log and its archive (the hash chain covers them as they were).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orqiva_app') THEN
    CREATE ROLE orqiva_app NOLOGIN NOSUPERUSER NOBYPASSRLS INHERIT;
  END IF;
END $$;
GRANT prodengine_app TO orqiva_app;
GRANT orqiva_app TO CURRENT_USER;

CREATE OR REPLACE FUNCTION in_system_mode() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT current_user NOT IN ('prodengine_app', 'orqiva_app') AND current_setting('app.system', true) = 'on' $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, c.conname
      FROM pg_constraint c
     WHERE c.contype = 'c'
       AND c.conrelid IN ('activity_events'::regclass, 'activity_archive'::regclass)
       AND pg_get_constraintdef(c.oid) LIKE '%prodengine%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I CHECK (type ~ ''^(orqiva|prodengine)\.[a-z_]+\.[a-z_]+$'')',
      r.tbl, r.conname);
  END LOOP;
END $$;
