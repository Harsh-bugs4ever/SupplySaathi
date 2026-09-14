# SupplySaathi — single image running the web app and the agent worker together.
#
# They share one SQLite file, so they must share one container and one disk.
# Deliberately not a multi-stage build: the worker runs TypeScript through tsx
# and the start script runs migrations the same way, so the toolchain has to be
# present at runtime. Trimming it would mean precompiling the worker for a
# marginal size win.

FROM node:24-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# `concurrently --kill-others` walks the process tree with `ps` to stop the
# sibling when one process exits. The slim base has no `ps`, so without this the
# supervisor crashes during shutdown instead of stopping the other half — and
# the platform restarts a half-dead service.
RUN apt-get update \
  && apt-get install -y --no-install-recommends procps \
  && rm -rf /var/lib/apt/lists/*

# Dependencies first, so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop everything that was only needed to compile. `tsx` and `concurrently` are
# runtime dependencies — the worker and the migration step run TypeScript
# directly — so they survive the prune while TypeScript, Tailwind, the type
# packages and the test runner do not. Clearing the npm cache and Next's build
# cache in the same layer keeps them out of the image rather than merely
# shadowed by a later deletion.
RUN npm prune --omit=dev \
  && rm -rf /root/.npm /app/.next/cache

# Set after the build: Next needs devDependencies to compile.
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/supplysaathi.db
ENV PORT=3000

# The entrypoint drops from root to `node`, but dropping privileges does not
# change HOME. Left as /root, npm tries to write caches and logs into a
# directory this user cannot touch and reports errors that look like failures.
ENV HOME=/home/node
# Nothing here should be nagging about npm releases in production logs.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV NPM_CONFIG_FUND=false

# Created here so the image works without a mounted disk too. When a platform
# mounts a volume over this path at runtime it arrives root-owned, which the
# entrypoint corrects before dropping privileges.
#
# Only the data directory is chowned. A recursive `chown -R /app` would rewrite
# every file's metadata, and because layers are copy-on-write that duplicates
# the entire application and node_modules into a new layer — several hundred
# megabytes for no benefit. Nothing outside /app/data is written at runtime.
RUN mkdir -p /app/data && chown node:node /app/data

COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

# Starts as root purely so the entrypoint can chown the mounted disk; it then
# drops to the unprivileged `node` user before running anything application-level.
ENTRYPOINT ["docker-entrypoint.sh"]

# Runs migrations, then `exec`s the supervisor so it *replaces* the shell and
# becomes PID 1. Neither `npm start` nor `npx` will do here: both leave npm as
# PID 1, where it swallows SIGTERM, reports the stop as an error, and the worker
# never runs its shutdown handler to release an in-flight job. Invoking the
# binaries directly puts the supervisor itself at PID 1. Same two processes as
# `npm start` locally — only the signal path differs.
CMD ["sh", "-c", "npm run migrate && exec node_modules/.bin/concurrently --kill-others -n web,worker -c green,cyan 'node_modules/.bin/next start -H 0.0.0.0' 'node_modules/.bin/tsx worker/index.ts'"]