<!-- [PCODE-215 | S15 | v0.1.0] T19.4 Air-gapped install (orq bundle, install --bundle), verified backups, licence and SBOM review -->

# Third-party licence audit and SBOM review (T19, 10 Oct 2026)

Run: `orq licences` (the licence gate of `npm run check`, policy in `licence-policy.json`). Output:
`out/licences/sbom.cdx.json` (CycloneDX 1.5) and `out/licences/THIRD-PARTY-NOTICES.md`.

## Result

**OK: 18 third-party packages ship, 0 denied, 0 bundle problems.**

| Package                                                                         | Version          | Licence           | Ships in          |
| ------------------------------------------------------------------------------- | ---------------- | ----------------- | ----------------- |
| pg, pg-pool, pg-protocol, pg-types, pg-connection-string, pg-cloudflare, pgpass | 8.23.1 and parts | MIT               | server            |
| pg-int8, split2                                                                 | 1.0.1, 4.2.0     | ISC               | server            |
| postgres-array, postgres-bytea, postgres-date, postgres-interval, xtend         |                  | MIT               | server            |
| react, react-dom, scheduler                                                     | 19.3.0, 0.28.0   | MIT               | web               |
| @vscode/codicons                                                                | 0.0.46-24        | CC-BY-4.0 (icons) | VS Code extension |

Everything else in Orqiva is our own code. The SAML, SCIM, WebSocket, PDF, XML canonicalisation and
licence-key parts were written for Orqiva, without libraries.

Notes from the run:

- `pg-types@2.2.0` and `pgpass@1.0.5` ship no licence file. Their notice is built from the MIT licence their
  package manifests declare.
- **Fixed during this review:** the web app's service worker (`dist/sw.js`) was built without a source map,
  so the gate could not prove what it holds and failed (since PCODE-151). It now has one.

## What the SBOM does not cover

- **Container images.** The server image is built on `node:22-bookworm-slim`. `orq install` also runs
  `postgres:17` (PostgreSQL licence) and, with TLS, `caddy:2` (Apache-2.0). These images contain Debian
  packages under their own licences, some of them GPL.
  - The SBOM above lists our npm dependencies only. It does not list the operating system packages in the
    images.
  - The offline bundle (`orq bundle`) **redistributes** these images. Before we hand bundles to customers,
    the owner should decide how we meet the GPL source obligations for the Debian packages. Options:
    point to the upstream image sources, or keep the matching source archives available.
  - This is **open for the owner and a lawyer**.
- **Development tools** (TypeScript, esbuild, Vitest, ESLint, Prettier). They are used to build and test
  and are not shipped.

## Review cadence

The gate runs on every `npm run check` and in CI, and fails on a denied licence or an unprovable bundle.
A new runtime dependency needs an accepted licence or an exception in `licence-policy.json` that names the
exact version and who checked it.
