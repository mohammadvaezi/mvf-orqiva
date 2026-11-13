<!-- [PCODE-216 | S15 | v0.1.0] T19.5 Own security review (authorization matrix over every route, headers, own scan) and the external pen-test brief -->

# Orqiva threat model (T19.5, 10 Oct 2026)

Scope: the Orqiva server (`packages/server`), its web app, the `orq` CLI, the VS Code extension and the
install paths (Docker Compose, Helm, offline bundle). This is our own review; the external pen test
(`pentest-brief.md`) is meant to check it.

## What we protect

| Asset                                                   | Why it matters                                             |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| Work items, documents, code maps, evidence, client data | A customer's engineering history and their clients' data   |
| Environment secrets and deploy runs                     | Handed to runners. A leak opens the customer's production  |
| Sessions, API tokens, runner tokens, SCIM tokens        | Each one is a way in                                       |
| SAML and OIDC settings                                  | Whoever changes them decides who can sign in               |
| Licence keys, billing and invoices                      | Money, and the right to run the product                    |
| Backups and offline bundles                             | The whole database in one file, or the images we hand over |

## Who could attack

1. **Anonymous people on the internet**, when the server is public.
2. **A member of another workspace** on the same server (the cloud tenant, or a shared company server).
3. **A member with a small role** (guest, tester, auditor, client portal user) who wants more.
4. **A stolen token** (API, runner or SCIM token), or a stolen session cookie.
5. **A malicious IdP response**, or a man in the middle on SAML or OIDC.
6. **Content we show**, for example markdown, imported Plane data, code docs or agent output, written
   to attack the next reader.
7. **A tampered backup or bundle**, changed on its way to an air-gapped site.

## Boundaries and defences

| Boundary            | Defence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Checked by                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Request → route     | Every route declares its schema. A body is refused before the handler unless it matches. JSON only (forms only on the SAML ACS route), which is the CSRF defence together with `SameSite=Lax`                                                                                                                                                                                                                                                                                                                                         | router tests                                                                |
| Session → workspace | `asMember` checks membership and role on every workspace route. PostgreSQL row-level security (tenant and client-scope policies) checks again in the database, so a forgotten check in code still returns nothing                                                                                                                                                                                                                                                                                                                     | `test/db/authz.test.ts` (all 546 routes: anonymous and outsider), RLS tests |
| Role → action       | Role checks per route (admin, member, tester, designer, auditor, billing, guest). The client portal sees only its client's rows (RLS `client_scope`)                                                                                                                                                                                                                                                                                                                                                                                  | per-feature DB tests                                                        |
| Passwords           | scrypt with a random salt and the cost in the stored hash. Rate limit of 10 failures per 15 minutes per address and per IP, shared by all nodes                                                                                                                                                                                                                                                                                                                                                                                       | auth tests                                                                  |
| Sessions and tokens | 32 random bytes, stored only as SHA-256. The cookie is HttpOnly, SameSite=Lax, and Secure behind TLS. API, runner and SCIM tokens are prefixed (`orq_…`), hashed and revocable                                                                                                                                                                                                                                                                                                                                                        | auth tests, SCIM tests                                                      |
| SAML                | Our own XML parser (no DOCTYPE, no entities) and exclusive c14n. RSA-SHA256 only. One assertion directly under the Response, plain or encrypted (AES-GCM/CBC with RSA-OAEP to the workspace's own sealed key; RSA 1.5 refused; the decrypted assertion is checked like a plain one). Single logout over HTTP-Redirect with RSA-SHA256 signatures both ways (the IdP's checked against its certificate over the raw query). Unique IDs, an enveloped signature, InResponseTo, Recipient, Audience, a time window, one-time request IDs | `test/saml.test.ts` (wrapping, tampering, replay, DOCTYPE)                  |
| SCIM                | Bearer token per workspace. Every query is filtered by that workspace explicitly (system mode). Deactivating a user suspends the membership and revokes their tokens                                                                                                                                                                                                                                                                                                                                                                  | `test/db/scim.test.ts`                                                      |
| Runners             | Their own token. A runner only takes deploys of its own workspace, through RLS                                                                                                                                                                                                                                                                                                                                                                                                                                                        | deploy tests, authz test (a session cookie is refused)                      |
| Phone pairing       | A code of 8 characters from 29 (about 5 × 10¹¹ codes), stored as a SHA-256 hash, valid 10 minutes and once; a new code replaces the unused ones. Redeeming checks the membership again and is rate-limited per address. The phone gets a personal token bound to the workspace with read and write scopes and the policy’s expiry; the app keeps it in the Keychain or Keystore and asks before it signs in to a server from a scanned code or a link                                                                                 | `test/db/pairing.test.ts`, `test/db/mobilefeed.test.ts`                     |
| Browser             | CSP `default-src 'self'` with no inline script, `frame-ancestors 'none'`, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS when enabled, `Cache-Control: no-store` on API answers. The web app never inserts raw HTML (no `dangerouslySetInnerHTML`), React escapes all content                                                                                                                                                                                                                                 | authz test (headers), static tests                                          |
| Webhooks in         | Billing (Stripe) webhooks: signature and timestamp checked over the raw body                                                                                                                                                                                                                                                                                                                                                                                                                                                          | webhook tests                                                               |
| Backups and bundles | Backups: a `.sha256` file and a read-back with `pg_restore --list`; restore refuses a mismatch. Bundles: a manifest with a SHA-256 that is checked before `docker load`                                                                                                                                                                                                                                                                                                                                                               | `cli/test/maintain.test.ts`                                                 |
| Supply chain        | One runtime dependency on the server (`pg`). Licence and SBOM gate in CI. `orq scan` on every check                                                                                                                                                                                                                                                                                                                                                                                                                                   | `docs/policy/licence-review-t19.md`                                         |

## Own review results (T19.5)

- **Authorization matrix:** 541 routes at T19.5, 496 of them under a workspace (546 and 497 after T21).
  - Without a session: no route answers 2xx except the public ones named in the test (7 at T19.5, 8 with the price list of T20), and none answers 5xx.
  - As a member of another workspace: no workspace route succeeds or fails with 5xx.
  - Runner routes refuse a session cookie.
- **Headers:** present on API answers and on static files.
- **`orq scan`** (921 files): one finding, a false positive. It was the PEM frame in `push/webpush.ts`,
  where the key is generated at runtime. It is opted out with a reason. 31 lines are opted out in total,
  each with a reason.

## Known gaps and accepted risks

- **SAML canonicalisation is our own code.** It is tested against hand-built signed assertions, but not yet
  against responses from real IdPs (Entra ID, Okta, Keycloak). Test against these before the first
  customer turns on SAML.
- **Request-rate limits are per node.** The security limits (sign-in, sign-in links, API tokens, phone
  pairing, password mail, buying) are counted in PostgreSQL and shared by all nodes. The general limit on
  requests per minute and the websocket limits stay in memory on each node, so N nodes allow up to N times
  that volume; volume attacks are for the load balancer.
- **One table has no row policies, on purpose.** `activity_search` holds the words of activity (names and
  labels) for the text index, which PostgreSQL does not use under row-level security. It holds no events,
  every query names its workspace, and the events a search finds are read through their own policies. The
  schema test names it as the only exception.
- **SameSite=Lax plus JSON-only requests is the CSRF defence.** There are no CSRF tokens. If a route ever
  accepts forms or simple content types, it needs one.
- **Debian packages in the redistributed images** carry GPL obligations. This is open for the owner (see the
  licence review).
- **The external pen test has not been done.** The brief is ready; the owner chooses the firm.
