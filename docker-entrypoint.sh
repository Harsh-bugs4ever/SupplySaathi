#!/bin/sh
# Container entrypoint.
#
# The problem this solves: the Dockerfile creates and chowns /app/data at BUILD
# time, but a hosting platform mounts the persistent disk there at RUNTIME,
# replacing that directory with a fresh one owned by root. A container running
# as an unprivileged user then cannot write the database, and the first thing
# anyone sees is an opaque SQLITE_CANTOPEN.
#
# So: if we start as root, fix ownership of the data directory and drop
# privileges before exec'ing the app. If we are already unprivileged, verify the
# directory is writable and fail with something a human can act on.

set -eu

DATA_DIR="$(dirname "${DATABASE_PATH:-/app/data/supplysaathi.db}")"
APP_USER="${APP_USER:-node}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R "$APP_USER":"$APP_USER" "$DATA_DIR"

  # exec so the app becomes PID 1 and receives SIGTERM on shutdown, letting the
  # worker release its in-flight job instead of being killed mid-run.
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid="$APP_USER" --regid="$APP_USER" --init-groups "$@"
  elif command -v su-exec >/dev/null 2>&1; then
    exec su-exec "$APP_USER" "$@"
  elif command -v gosu >/dev/null 2>&1; then
    exec gosu "$APP_USER" "$@"
  fi

  echo "entrypoint: no privilege-dropping tool found; continuing as root." >&2
  exec "$@"
fi

# Already unprivileged. The mount may still be root-owned, so check now rather
# than letting it surface later as a database error.
if ! mkdir -p "$DATA_DIR" 2>/dev/null || ! [ -w "$DATA_DIR" ]; then
  echo "entrypoint: cannot write to $DATA_DIR (running as uid $(id -u))." >&2
  echo "  The persistent disk is probably owned by root." >&2
  echo "  Either let the container start as root so this script can fix it," >&2
  echo "  or chown the mount to uid $(id -u) on the host." >&2
  exit 1
fi

exec "$@"