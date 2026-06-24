#!/bin/sh
# Container start script for Tarasa Historic Extractor
# Baked into the Docker image so the Railway UI start-command cannot break it.
#
# IMPORTANT (root-cause fix): migrations must NEVER be a hard gate on the server
# starting. Previously this script used `set -e` and ran `prisma migrate deploy`
# directly, so if Postgres was briefly unreachable at boot the script aborted
# and the node server never started. Combined with the self-heal watchdog
# (which restarts the container when the DB is unreachable) and Railway's
# restart-retry cap, a transient DB blip could turn into a PERMANENT 502:
# every fresh container died at the migrate step before binding its port.
#
# New behavior: retry migrations a few times with backoff, but ALWAYS exec the
# server afterwards. Migrations are idempotent (`migrate deploy` is a no-op when
# the schema is already applied), and the running server handles DB reconnection
# on its own — so a degraded-but-up site always beats a dead one.

echo "[START] start.sh launched"

MAX_ATTEMPTS="${MIGRATE_MAX_ATTEMPTS:-5}"
attempt=1
migrated=0

while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  echo "[START] prisma migrate deploy (attempt ${attempt}/${MAX_ATTEMPTS})"
  if npx prisma migrate deploy; then
    echo "[START] migrations applied successfully"
    migrated=1
    break
  fi
  echo "[START] migrate attempt ${attempt} failed (DB may be temporarily unreachable)"
  attempt=$((attempt + 1))
  if [ "$attempt" -le "$MAX_ATTEMPTS" ]; then
    # Backoff: 5s, 10s, 15s, 20s ... gives a cold/restarting Postgres time to
    # come back without holding the server hostage for long.
    sleep_for=$(( (attempt - 1) * 5 ))
    echo "[START] retrying in ${sleep_for}s"
    sleep "$sleep_for"
  fi
done

if [ "$migrated" -ne 1 ]; then
  echo "[START] WARNING: migrations did not complete after ${MAX_ATTEMPTS} attempts."
  echo "[START] Starting the server ANYWAY so the site stays up; the server will"
  echo "[START] reconnect to the DB as it recovers and migrations apply on the"
  echo "[START] next successful boot/deploy. A degraded site beats a dead one."
fi

echo "[START] exec-ing node server"
exec node --max-old-space-size=1024 dist/server.js
