# syntax=docker/dockerfile:1
#
# The web image: the Next.js standalone server. It contains NO environment-
# specific settings — the API's address (API_URL) is read at runtime, so the
# same image runs in staging and production.
#
# Build from the REPOSITORY ROOT (the app uses packages/shared):
#   docker build -f apps/web/Dockerfile -t ledgerly-web .

ARG NODE_IMAGE=node:22.23.4-alpine3.24

# ── 1. Prune ─────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS prune
WORKDIR /repo
COPY . .
RUN npx --yes turbo@2.11.10 prune @ledgerly/web --docker

# ── 2. Install and build ─────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
# Root config the packages extend (turbo prune copies packages, not loose root files).
COPY --from=prune /repo/tsconfig.base.json ./
# `next build` + copying static assets next to the standalone server.
RUN pnpm turbo run build --filter=@ledgerly/web

# ── 3. Runtime ───────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# The standalone output mirrors the monorepo layout: the server is at
# apps/web/server.js, with exactly the node_modules it needs beside it.
COPY --from=build /repo/apps/web/.next/standalone ./

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="ledgerly-web" \
      org.opencontainers.image.revision="${APP_VERSION}"

USER node
EXPOSE 3000
# Liveness only: /healthz never calls the API (see src/app/healthz/route.ts).
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
