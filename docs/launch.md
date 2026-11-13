<!-- [PCODE-223 | S15 | v0.1.0] T20.5 GA exit test (licence, team, backlog, first sprint without our help), launch checklist, licence decision memo -->

# GA launch checklist (M4)

What is ready, what the owner decides, and the steps on launch day. As of 10 Oct 2026, nothing has been
published, pushed or announced.

## Ready, and how it was checked

| Area                        | Evidence                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| First hour without our help | `packages/server/test/db/firsthour.test.ts`: licence, team, demo model, Jira backlog, first sprint planned, worked and completed, velocity measured |
| Self-serve purchase         | `packages/server/test/db/buy.test.ts`: offers, checkout, paid webhook, licence on the order page, installed, renewed                                |
| Install                     | `orq install` (Docker Compose), the Helm chart, the offline bundle with `orq.mjs`; the tracker runs on it                                           |
| Docs site                   | `npm run build -w @orqiva/site`: 14 pages, every internal link checked; CLI and API reference from the code                                         |
| Migration                   | Guides for Jira, Linear and Plane; the importers keep issue numbers                                                                                 |
| Pricing                     | The pricing page and the buy page read the same offers (`packages/shared/src/pricing.ts`)                                                           |
| Security                    | Authorization over all 546 routes, headers, `orq scan` clean, threat model, pen-test brief (`docs/security/`)                                       |
| Licences                    | The licence gate on every check; SBOM; `docs/policy/licence-review-t19.md`                                                                          |
| Release                     | `node deploy/release.mjs`: `orq.mjs`, `.vsix`, chart, docs site, SHA256SUMS                                                                         |

## Decisions for the owner (before launch)

1. **The licence** of Orqiva itself, and the wording of `LICENSE` (`docs/strategy/licence-decision.md`).
2. **Prices and plan contents.** They are a draft. The plan contents beyond seats are not yet enforced:
   only SAML and SCIM (Enterprise) are checked today. Either enforce the differences between Team and
   Business, or describe the plans by seats and support only. Then set `PRICING_DRAFT` to `false`.
3. **The free tier**: the plan's single user and one project, or today's 5 people.
4. **Names**: the vendor shown on every listing, the image name (`prodengine/server` today), the product
   domain.
5. **Contacts**: the sales address for Enterprise, and the security address.
6. **GPL obligations** for the Debian packages inside the images that bundles hand out (with a lawyer).

## Owner's accounts and outside work

- [ ] Stripe account, yearly prices for Team and Business, webhook to `/stripe/webhook` on the vendor
      server; first a purchase in Stripe's test mode.
- [ ] The vendor server: the environment in `docs/listings.md`, the signing key kept offline and backed up.
- [ ] Visual Studio Marketplace publisher (and Open VSX), a container registry namespace, a chart
      repository, the web host for the docs site and downloads.
- [ ] External pen test (`docs/security/pentest-brief.md`); fix criticals and highs before launch.
- [ ] SAML against at least one real identity provider (Entra ID, Okta or Keycloak).
- [ ] The Helm chart on a real cluster with two replicas.
- [ ] Push the repository so CI runs the changes made since T18 (the full check, perf tests, release build).

## Launch day

1. `npm ci && npm run check`; everything green.
2. Build the site with the real buy page: `ORQIVA_BUY_URL=https://<vendor>/buy npm run build -w @orqiva/site`.
3. `node deploy/release.mjs`; check `SHA256SUMS`.
4. Build and push the image with its version; build `orq bundle` for offline customers.
5. Publish the extension, the chart and the downloads, and copy the docs site to its host.
6. On the vendor server: buy one Team licence end to end with a real card, install it on a fresh server,
   and refund it.
7. Announce.

## After launch

- Watch the vendor server's webhook deliveries and the order pages for the first purchases.
- The review items collected during the build (`final-review-items` in the project notes) go into the
  T21 planning.
