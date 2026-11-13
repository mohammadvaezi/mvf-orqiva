-- ── [PCODE-299 | S15 | v0.1.0] T31.1 GitLab and Azure Repos: webhooks, secrets, setup, read into one shape ──
-- Why:  GitLab and Azure Repos as Git hosts beside GitHub and Gitea; an Azure build names its repository
--       only by id, which the connection learns from the first push or pull request.

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'git_connections'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%provider%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE git_connections DROP CONSTRAINT %I', c);
  END IF;
END $$;
ALTER TABLE git_connections ADD CONSTRAINT git_connections_provider_check
  CHECK (provider IN ('github', 'gitea', 'gitlab', 'azure'));

ALTER TABLE git_connections ADD COLUMN host_repo_id text CHECK (host_repo_id IS NULL OR length(host_repo_id) <= 100);

-- GitLab groups nest (group/sub/project), Azure names organisation/project/repository (with spaces in a
-- project's name); the server checks each host's form, the table only the characters
ALTER TABLE git_connections DROP CONSTRAINT IF EXISTS git_connections_repo_check;
ALTER TABLE git_connections ADD CONSTRAINT git_connections_repo_check
  CHECK (repo ~ '^[A-Za-z0-9_.-][A-Za-z0-9_. -]*(/[A-Za-z0-9_.-][A-Za-z0-9_. -]*){1,19}$' AND length(repo) <= 200);
