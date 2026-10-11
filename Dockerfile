# The web process: Express API plus the built client, served from one port.
#
# docker-compose.yml has always declared `build: { context: ., dockerfile: Dockerfile }`
# for the `api` service, but this file did not exist — only Dockerfile.worker did — so
# `docker-compose up` failed on the first build and the documented deployment path had
# never run. server/tests/architecture.test.ts now asserts that every Dockerfile named by
# the compose file is present, so the two cannot drift apart again.
#
# Based on the Playwright image for the same reason the worker is: the web process runs
# element detection and the ad-hoc "Execute Test" preview in a real browser, so it needs
# the browsers and their system libraries, not just Node.
#
# The tag must equal the version the LOCKFILE resolves for playwright — the image ships
# browsers built for exactly one, and Playwright refuses to launch a mismatched pair. It is
# not tied to the range in package.json, and assuming it was is what broke this: "^1.53.1"
# had resolved to 1.61.1 while this said 1.53.0, so the first real browser run in a
# container failed with "Executable doesn't exist" and a message telling us to update the
# image. An architecture test now compares the two, so a dependency bump fails a test
# rather than production.
FROM mcr.microsoft.com/playwright:v1.63.0-resolute@sha256:b022639ae9197f864040f92eef7b57c6d4b47db2190f77c909d8a5d902dd4b7e
COPY deployment/releases/harden-base.sh /tmp/wfm-harden-base.sh
RUN sh /tmp/wfm-harden-base.sh && rm /tmp/wfm-harden-base.sh

WORKDIR /app

ARG SOURCE_DATE_EPOCH=0
ARG APP_VERSION=development
ARG VCS_REF=unknown
LABEL org.opencontainers.image.version=$APP_VERSION org.opencontainers.image.revision=$VCS_REF

ENV NODE_ENV=production

# Dependencies first, and as their own layer: application code changes on every build,
# package-lock.json rarely, so this layer is the one worth caching.
COPY package*.json ./
COPY client/package*.json ./client/
RUN npm ci --include=dev --no-audit --no-fund && rm -rf /root/.npm /tmp/node-compile-cache

COPY . .

# Builds the client bundle and both server entry points (see the root "build" script).
# Dev dependencies are needed for this — esbuild, vite, the TypeScript compiler — which is
# why they were installed above and are pruned below rather than skipped.
RUN npm run build && npm ci --omit=dev --workspaces=false --no-audit --no-fund && node scripts/release/runtime-tools.mjs && rm -rf /root/.npm /tmp/node-compile-cache

# Lighthouse, for the auditLighthouse step (server/web-performance.ts). Installed as a program on
# its own rather than as a dependency of the application: it brings a browser driver and a
# telemetry SDK the application has no use for, and it runs as a separate process anyway. It uses
# the image's Playwright Chromium. Lighthouse 13 requires Node 22.19+; the pinned base provides Node 24.
COPY deployment/lighthouse/package*.json /opt/lighthouse/
RUN npm ci --prefix /opt/lighthouse --omit=dev --ignore-scripts --no-audit --no-fund && rm -rf /root/.npm /tmp/node-compile-cache
ENV LIGHTHOUSE_BIN=/opt/lighthouse/node_modules/.bin/lighthouse

RUN mkdir -p /app/logs /app/results /app/data/visual-baselines /app/uploads /app/allure-results \
    && chown -R pwuser:pwuser /app/logs /app/results /app/data /app/uploads /app/allure-results
RUN rm -rf /usr/lib/node_modules/npm && rm -f /usr/bin/npm /usr/bin/npx
USER pwuser

# Matches the default in server/config.ts. The compose file publishes it; PORT overrides it.
EXPOSE 5000

# Reports unhealthy until the server can serve requests (server/health.ts): PostgreSQL, Redis and
# the session store answer. A dependent service waits for a working API rather than for a started
# container. It used to fetch /api/user and accept any status under 500, a 401 with the database
# down included.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
