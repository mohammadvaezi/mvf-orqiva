<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->

# Security checklist

<!-- [PCODE-60 | S12 | v0.1.0] Add the security checklist template and a panel with persistent checkboxes -->

Ticked in the Orqiva security panel; the ticks live in this file, so they travel with the repo and a
reviewer can read them without the editor. Every line is something a person checks — nothing here is
verified automatically.

## Secrets and config

- [ ] No credential is committed — tokens, keys and passwords live in the environment or a secret store.
      _Search the history, not only the working tree._
- [ ] `.env` and any key file are listed in `.gitignore`.
- [ ] The production configuration differs from the development one and is not readable by the app's users.
- [ ] Every secret has an owner who can rotate it, and rotating one does not need a code change.
- [ ] Build logs, error pages and telemetry never print a secret.

## Dependencies

- [ ] The lock file is committed and the build installs from it.
- [ ] `npm audit` / `pip-audit` (or the stack's equivalent) reports no unfixed high or critical finding.
      _Record the date of the last run._
- [ ] Dependencies come from the official registry; no package is pinned to a fork nobody maintains.
- [ ] A new direct dependency was read by a person before it was added.

## Authentication and sessions

- [ ] Passwords are stored with a slow hash (argon2, bcrypt, scrypt) and never reversible.
- [ ] Sessions expire, and logging out invalidates the session on the server.
- [ ] Cookies are `HttpOnly`, `Secure` and `SameSite` unless a documented reason says otherwise.
- [ ] Login, password reset and token endpoints are rate limited.
- [ ] Administrative access needs a second factor or a separate network path.

## Input validation and injection

- [ ] Every request body and query parameter is validated against a schema before it is used.
- [ ] Database access uses parameters or an ORM — no string-built SQL.
- [ ] Shell and system calls take an argument array; no user value reaches a shell string.
- [ ] Output is escaped for its target (HTML, SQL, shell, CSV), not only on input.
- [ ] Uploaded files are checked by content, stored outside the web root and served with `nosniff`.

## Data protection and GDPR

- [ ] Personal data is listed somewhere a person can read: what is stored, why, and for how long.
- [ ] There is a way to export and to delete one person's data.
- [ ] Data is encrypted in transit, and at rest where the hosting allows it.
- [ ] Third parties that receive data are named, with a contract or a documented decision.
- [ ] Test and development environments do not hold real personal data.

## Transport and headers

- [ ] HTTPS everywhere, with a redirect from HTTP and HSTS on the production domain.
- [ ] TLS certificates renew automatically, and expiry is monitored.
- [ ] `Content-Security-Policy`, `X-Content-Type-Options` and `Referrer-Policy` are set.
- [ ] CORS names the origins that may call the API instead of `*`.

## Logging and monitoring

- [ ] Errors reach a place a person looks at, with enough context to act.
- [ ] Logs carry no passwords, tokens or full personal records.
- [ ] Authentication failures and administrative actions are logged with who and when.
- [ ] Someone is alerted when the application is down or the error rate jumps.

## Docker and deployment

- [ ] The image runs as a non-root user.
- [ ] Base images are pinned and rebuilt when their security updates land.
- [ ] No secret is baked into an image layer or a build argument that ends up in the history.
- [ ] Only the ports the application needs are published.
- [ ] A deployment can be rolled back to the previous version without a rebuild.

## Backups and recovery

- [ ] The data store is backed up on a schedule, and the backup lives elsewhere.
- [ ] A restore has been tried at least once — the date is recorded here.
- [ ] Backups are encrypted and their retention is deliberate.
- [ ] The steps to bring the system back up are written down where they can be found without the system.
