# syntax=docker/dockerfile:1
#
# The API image. ONE image runs three things, chosen by its command:
#   node dist/server.js    the HTTP API (default)
#   node dist/worker.js    the background job worker
#   node dist/migrate.js   apply database migrations, then exit (run before a rollout)
# Same code, same build, same dependencies — they can never drift apart.
#
# Build from the REPOSITORY ROOT (the API needs packages/db and packages/shared):
#   docker build -f apps/api/Dockerfile -t ledgerly-api .

# Pin the exact Node version (it matches .nvmrc's major). Upgrades are deliberate.
ARG NODE_IMAGE=node:22.23.4-alpine3.24

# ── 1. Prune: just the API and the workspace packages it depends on ──────────
FROM ${NODE_IMAGE} AS prune
WORKDIR /repo
COPY . .
# turbo prune writes out/json (package.json files + a pruned lockfile) and
# out/full (their source), so the next stage can install from manifests alone.
RUN npx --yes turbo@2.11.10 prune @ledgerly/api --docker

# ── 2. Install and build ─────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
# Manifests first: this layer (the slow download) is reused until a dependency
# changes. Editing source code doesn't invalidate it.
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
# Root config the packages extend (turbo prune copies packages, not loose root files).
COPY --from=prune /repo/tsconfig.base.json ./
RUN pnpm turbo run build --filter=@ledgerly/api
# A self-contained copy of the API with PRODUCTION dependencies only (no
# TypeScript, Vitest, ESLint…), workspace packages included as real files.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @ledgerly/api deploy --prod --legacy /out/api

# ── 3. Runtime: only what's needed to run ────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000
WORKDIR /app
# Owned by root, run as `node`: the process can't modify its own code.
COPY --from=build /out/api/package.json ./
COPY --from=build /out/api/node_modules ./node_modules
COPY --from=build /out/api/dist ./dist

# Which build is this? Shown by /health and in every log line.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="ledgerly-api" \
      org.opencontainers.image.revision="${APP_VERSION}"

# Never run as root: a compromised process gets as little as possible.
USER node
EXPOSE 4000
# The container platform restarts the process if it stops answering. Liveness
# only (/health): a database blip must not get healthy containers killed.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
