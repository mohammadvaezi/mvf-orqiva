<!-- [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs -->
<!-- ── [PCODE-83 | S15 | v0.1.0] Replace the MIT licence with a proprietary licence and write the licence policy ── -->

# Licence policy

Orqiva is proprietary: 100% our own code, sold under the licence in [`LICENSE`](../../LICENSE).
Nothing we ship may carry licence terms that stop us selling it, keep its source closed or charge for it.
The machine-readable copy of this policy is [`licence-policy.json`](../../licence-policy.json); `pe
licences` enforces it in every build and CI run. When the two disagree, fix one of them in the same
commit.

## Our own code

- `LICENSE` at the root and in every shipped package: proprietary, all rights reserved.
- Every `package.json` says `"license": "SEE LICENSE IN LICENSE"` and `"private": true`, so nothing is
  published to a public registry by accident.

## The platform

The only third-party software the backend runs on.

| Component                              | Licence                    | Why it is safe                                                                       |
| -------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| Node.js 22                             | MIT                        | We run it unmodified                                                                 |
| PostgreSQL 17                          | PostgreSQL Licence         | Permissive; no extensions are used                                                   |
| `pg` (node-postgres) and its packages  | MIT, ISC                   | Permissive; checked by `orq licences`                                                |
| Docker Engine and the customer's Linux | Apache-2.0 / various       | The customer's own installation; we never ship Docker Desktop                        |
| Base image of our containers (Debian)  | GPL and LGPL parts, others | Running on GPL software does not make our code GPL; we list its packages per release |

## Accepted in anything we ship

MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, 0BSD, Unlicense, CC0-1.0, PostgreSQL, BlueOak-1.0.0;
OFL-1.1 for fonts; CC-BY-4.0 for icons and data, with attribution in `THIRD-PARTY-NOTICES.md`.

## Never shipped

GPL, LGPL, AGPL, SSPL, MPL, EPL, Business Source Licence (BSL/BUSL), Elastic Licence, Commons Clause, any
non-commercial (NC) or "no SaaS" clause, `UNLICENSED` packages and packages with no licence at all.
AGPL matters most: it would force our server's source open (MinIO, Plane and Grafana use it).

## How it is enforced

1. `npm run check` ends with `orq licences`: it walks the runtime dependencies of every shipped package,
   reads each one's licence files as well as its manifest, and fails on anything outside the accepted
   list, including a manifest that hides a GPL text or a Commons Clause rider.
2. It proves the built bundles contain nothing but those packages (source maps and imports), so a
   development tool can never slip into a release.
3. It writes `out/licences/sbom.cdx.json` (CycloneDX 1.5) and `out/licences/THIRD-PARTY-NOTICES.md`;
   CI keeps both with every build.
4. A reviewed exception names one exact package version in `licence-policy.json`, with the licence found
   by hand and who checked it.
5. No copied code: people and agents write code; nothing is pasted from repositories, answers or
   examples under another licence.
6. External services (model providers, Stripe, Git hosts) are reached over their public APIs, never
   through their SDKs.
7. Code written with AI assistance is reviewed by a person and carries its fingerprint, which records the
   task and the session it came from.
8. A software licensing lawyer reviews this policy, the SBOM and `LICENSE` before general availability
   (T19).
