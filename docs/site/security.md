<!-- [PCODE-218 | S15 | v0.1.0] T20.1 Public docs site built from the repository (own Markdown renderer, CLI and API reference, link check) -->

# Security

Orqiva runs on your machines, so your code, plans and test results stay inside your network. This page
describes how the server protects them, and how that protection is checked.

## Signing in

- **Passwords** are stored as scrypt hashes with a random salt. Failed sign-ins are rate-limited per address
  and per IP.
- **Two-step sign-in** uses an authenticator app (TOTP) and one-time recovery codes. A workspace can require
  it.
- **Single sign-on:** OpenID Connect, and SAML 2.0 with signed assertions (RSA-SHA256), encrypted or not. Each
  workspace has its own encryption key, stored sealed with the server key, and publishes its certificate
  in the metadata. Assertions encrypted with AES (GCM or CBC) and RSA-OAEP are read; RSA 1.5 is refused. Single logout
  works both ways over HTTP-Redirect: signing out tells the identity provider with a signed request, and its
  signed logout request ends the person's sessions here.
- **SCIM 2.0** provisioning: when your identity provider deactivates a person, their access ends and their
  tokens are revoked.
- **Sessions** are random 32-byte values in an HttpOnly, SameSite cookie, which is Secure behind HTTPS. The
  database keeps only their hash. People see where they are signed in and can end any session.
- **API, runner and SCIM tokens** are scoped, stored as hashes and revocable. A live token pasted into a task
  or comment is revoked at once, and its owner is told.

## Keeping workspaces apart

- Every request is checked against the person's membership and role.
- PostgreSQL row-level security checks the workspace again inside the database, so a missing check in code
  still returns nothing.
- Client portal users see only their own client's data.

## In the browser

- A strict Content Security Policy: scripts only from the server itself, no inline script, no framing.
- `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and HSTS behind HTTPS.
- API answers are never cached. Content people write is always escaped and never inserted as HTML.

## Installs and data

- Install folders get generated database passwords. Nothing ships with a default password.
- Backups are written with a SHA-256 checksum and read back before they count. A restore refuses a backup
  that does not match its checksum.
- Offline bundles are checked against their manifest before any image is loaded.

## How it is checked

- An automated test calls **every route of the API** without a session, and as a member of another
  workspace. None of them may answer with data or fail. It runs on every change.
- Tests attack SAML (signature wrapping, replay, XML entities), SCIM and the session handling.
- Our own scanner checks the code for secrets and risky patterns on every change.
- A licence gate checks every third-party package that ships, and writes a CycloneDX SBOM.
- An external penetration test is part of the launch.

To report a security problem, write to the address in your licence or contract. Please do not report it
in a public issue.
