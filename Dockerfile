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
# the browsers and their system libraries, not just Node. The tag is pinned to the
# Playwright version in package.json — a browser build newer than the client library (or
# older) fails at launch with a version mismatch.
FROM mcr.microsoft.com/playwright:v1.53.0-jammy

WORKDIR /app

ENV NODE_ENV=production

# Dependencies first, and as their own layer: application code changes on every build,
# package-lock.json rarely, so this layer is the one worth caching.
COPY package*.json ./
COPY client/package*.json ./client/
RUN npm ci --include=dev

COPY . .

# Builds the client bundle and both server entry points (see the root "build" script).
# Dev dependencies are needed for this — esbuild, vite, the TypeScript compiler — which is
# why they were installed above and are pruned below rather than skipped.
RUN npm run build && npm prune --omit=dev

# Matches the default in server/config.ts. The compose file publishes it; PORT overrides it.
EXPOSE 5000

# Reports unhealthy until the server is actually accepting requests, so a dependent service
# waiting on this one waits for a working API rather than for a started container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/user').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
