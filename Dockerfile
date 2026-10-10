# syntax=docker/dockerfile:1

# The base is pinned to an exact node minor on purpose: node:sqlite is experimental and can change between minors.
# Bump it by hand (Dependabot proposes it) and let the upgrade workflow run before merging.
# ── build: install, bundle (the release workflow runs the tests before it builds) ─
FROM node:22.23-alpine3.24 AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
# a checkout made under umask 077 has owner-only files, and the app runs as node, not root
# Tests run in CI, not on the machine that updates. RUN_TESTS=true runs them here too.
ARG RUN_TESTS=false
RUN if [ "$RUN_TESTS" = true ]; then pnpm test; fi && pnpm build && chmod -R a+rX apps/server/dist apps/server/migrations apps/web/dist

# ── runtime: one bundled JS file + static UI, no node_modules ─
FROM node:22.23-alpine3.24
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    TZ=Europe/Helsinki
# /secrets: the app secret (created by the app on first start), owner-only
RUN mkdir /data /secrets && chown node:node /data /secrets && chmod 700 /secrets
WORKDIR /app
COPY --from=build /app/apps/server/dist/node.js ./dist/node.js
COPY --from=build /app/apps/server/migrations ./migrations
COPY --from=build /app/apps/web/dist ./public
# talous.commit: scripts/update.sh and doctor.sh compare it with the checkout.
# talous.compose: the docker-compose.yml layout this image expects (x-talous-compat in docker-compose.yml).
# An update that needs a newer layout refuses to start the image on an older compose file.
ARG GIT_COMMIT=unknown
ARG APP_VERSION=unknown
ARG COMPOSE_COMPAT=1
LABEL talous.commit=$GIT_COMMIT \
      talous.version=$APP_VERSION \
      talous.compose=$COMPOSE_COMPAT \
      org.opencontainers.image.title="Omatalous" \
      org.opencontainers.image.source="https://github.com/jouni-mikkola/omatalous" \
      org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$GIT_COMMIT \
      org.opencontainers.image.licenses="MIT"
USER node
VOLUME ["/data", "/secrets"]
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/node.js"]
