<!-- [PCODE-222 | S15 | v0.1.0] T20.4 Marketplace listings prepared: single-file orq, release assembly, VS Code, container image and Helm listings -->

# Release and listings

What a release hands out, where each part is listed, and what the owner decides before anything is
published. **Nothing here has been published.** Every upload below is the owner's step.

## Build a release

```
npm ci && npm run build
ORQIVA_BUY_URL=https://<vendor server>/buy npm run build -w @orqiva/site
node deploy/release.mjs
```

`out/release/<version>/` then holds:

| File                         | What it is                                                     |
| ---------------------------- | -------------------------------------------------------------- |
| `orq.mjs`                    | The command line, one file; runs with Node.js 22               |
| `orqiva-<version>.vsix`      | The VS Code extension                                          |
| `orqiva-chart-<version>.tgz` | The Helm chart                                                 |
| `docs-site/`                 | The docs site, static files for any web host                   |
| `SHA256SUMS`, `release.json` | Checksums (check with `sha256sum -c SHA256SUMS`) and a summary |

The server image is built and pushed separately: `docker build -t <registry>/<name>:<version> .`

## Where each part goes

| Part               | Listed on                               | Command or step                                                   | Listing text                                                                          |
| ------------------ | --------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| VS Code extension  | Visual Studio Marketplace, Open VSX     | `npx vsce publish` / `npx ovsx publish` (needs a publisher token) | `packages/extension/README.md` and `package.json`                                     |
| Server image       | Docker Hub or GitHub Container Registry | `docker push`                                                     | [Image description](#image-description) below; the OCI labels are in the `Dockerfile` |
| Helm chart         | A chart repository, then Artifact Hub   | `helm push` to an OCI registry, or an `index.yaml` on a web host  | `deploy/helm/orqiva/README.md`, annotations in `Chart.yaml`                           |
| `orq.mjs`, bundles | The release downloads page              | Upload with `SHA256SUMS`                                          | The docs site's Getting started                                                       |
| Docs site          | The product's website                   | Copy `docs-site/` to the host                                     | It is the site                                                                        |

## Decisions for the owner

- **Names.** The `LICENSE` names _Farivarz_ as the copyright holder, and the extension's publisher is
  _broszio_. Pick the name shown as vendor on every listing. The OCI vendor label is left out until then.
- **Image name.** The image is built as `prodengine/server`, the name existing installs use. A new name
  (for example `orqiva/server`) needs a registry namespace. `orq install` keeps its compatibility with the
  old name.
- **Domain.** The docs site, the buy page (`ORQIVA_BUY_URL`), the chart's `home` and `icon`, and the
  image's documentation label all need the product's domain. They are left out until it exists.
- **Repository visibility.** The extension's manifest points at a GitHub repository. A private
  repository means broken links on the Marketplace. Either make the links public pages, or remove them.
- **Contacts.** A sales address for Enterprise (the pricing page says "ask us"), and a security address
  (the security page points to the licence or contract).
- **Selling.** A Stripe account with yearly prices for Team and Business. The vendor server needs
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_TEAM`, `STRIPE_PRICE_BUSINESS`,
  `ORQIVA_LICENCE_SIGNING_KEY_FILE` and `ORQIVA_PUBLIC_URL`, and a Stripe webhook to
  `https://<vendor server>/stripe/webhook`.
- **Prices.** They are still a draft (`PRICING_DRAFT` in `packages/shared/src/pricing.ts`). Set it to
  `false` when they are final.
- **Licences of the images.** The question about Debian packages in the redistributed images is still
  open (`docs/policy/licence-review-t19.md`).

## Image description

> **Orqiva server.** Orqiva is a self-hosted engineering command center: plans, sprints, AI agents with
> approvals, tests, security findings, compliance evidence and releases in one place. This image holds
> the API, the real-time gateway and the web app.
>
> Start it with `orq install` (Docker Compose, with PostgreSQL and optional HTTPS), or on Kubernetes with
> the Helm chart. It needs PostgreSQL (tested with 17). It runs as the unprivileged user `node`, keeps
> uploads in `/data`, and answers `/health`.
>
> Free for up to 5 people; a licence key adds seats.
