# ── [PCODE-91 | S15 | v0.1.0] Package the server as a Docker Compose install started by `orq install` ──
#    Why:  one image holds the server and the web app it delivers. Three stages: build compiles the
#          packages, deps installs production dependencies only (exactly as the lockfile says), and the
#          runtime stage copies just the results onto a slim Node base and runs as the unprivileged user
#          `node`. The base image (Debian, with GPL and LGPL parts) is the platform the policy allows;
#          its package list is published with each release.

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/extension/package.json packages/extension/
# [PCODE-222 | S15 | v0.1.0] every workspace's manifest, or npm ci refuses the lockfile
COPY packages/site/package.json packages/site/
# [PCODE-320 | S15 | v0.1.0] the bug-capture browser extension is a workspace too
COPY packages/capture/package.json packages/capture/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web
RUN npm run build --workspace packages/shared --workspace packages/server --workspace packages/web

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/extension/package.json packages/extension/
# [PCODE-222 | S15 | v0.1.0] every workspace's manifest, or npm ci refuses the lockfile
COPY packages/site/package.json packages/site/
# [PCODE-320 | S15 | v0.1.0] the bug-capture browser extension is a workspace too
COPY packages/capture/package.json packages/capture/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim
# [PCODE-222 | S15 | v0.1.0] what a registry shows about the image (OCI annotations)
ARG ORQIVA_VERSION=0.1.0
LABEL org.opencontainers.image.title="Orqiva server" \
      org.opencontainers.image.description="Orqiva, the self-hosted engineering command center: API, real-time gateway and web app" \
      org.opencontainers.image.version="${ORQIVA_VERSION}" \
      org.opencontainers.image.licenses="LicenseRef-Orqiva" \
      org.opencontainers.image.base.name="docker.io/library/node:22-bookworm-slim"
ENV NODE_ENV=production \
    ORQIVA_PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json LICENSE ./
COPY --from=build /src/packages/shared/package.json packages/shared/
COPY --from=build /src/packages/shared/dist packages/shared/dist
COPY --from=build /src/packages/server/package.json packages/server/
COPY --from=build /src/packages/server/dist packages/server/dist
COPY --from=build /src/packages/server/migrations packages/server/migrations
COPY --from=build /src/packages/web/dist packages/web/dist
# [PCODE-168 | S15 | v0.1.0] the blob store of uploaded files, a volume of its own
ENV ORQIVA_DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "packages/server/dist/main.js"]
