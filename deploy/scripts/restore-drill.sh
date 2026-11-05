#!/usr/bin/env bash
#
# Prove a backup can be restored — and that what comes back is complete and
# usable. A backup that has never been restored is a hope, not a backup.
#
#   deploy/scripts/restore-drill.sh [backups/ledgerly-<time>.dump]   (default: the newest)
#
# Everything happens in THROWAWAY containers on a private network; production
# is never touched. Steps:
#   1. verify the checksum (is the file what was written?);
#   2. restore into a fresh Postgres of the same version (stops at the first error);
#   3. compare every table's row count with the counts saved at backup time;
#   4. ask the app's own migrator whether the restored schema is current;
#   5. start the API on the restored database and check it reports ready.
# Exit code 0 only if all of them pass. Run it on a schedule, e.g. weekly.
set -euo pipefail

cd "$(dirname "$0")/.."                     # → deploy/
DIR="${BACKUP_DIR:-backups}"
# Names are UTC timestamps, so the newest sorts last.
dump="${1:-$(printf '%s\n' "$DIR"/ledgerly-*.dump | sort | tail -n 1)}"
[[ -f "$dump" ]] || { echo "no backup found in $DIR/" >&2; exit 1; }
base="${dump%.dump}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:18.6-alpine3.24}"
API_IMAGE="${API_IMAGE:-${REGISTRY:-ghcr.io/a7madalabed}/ledgerly-api:${IMAGE_TAG:-latest}}"
run="drill-$$"
log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
# shellcheck disable=SC2317,SC2329 # invoked by the trap below (older shellcheck: SC2317)
cleanup() { docker rm -f "$run-db" "$run-api" >/dev/null 2>&1 || true; docker network rm "$run" >/dev/null 2>&1 || true; }
trap cleanup EXIT

log "1/5 checksum of $(basename "$dump")"
(cd "$(dirname "$dump")" && sha256sum --check --quiet "$(basename "$base").sha256")

log "2/5 restoring into a throwaway $POSTGRES_IMAGE"
docker network create "$run" >/dev/null
docker run -d --name "$run-db" --network "$run" -e POSTGRES_USER=ledgerly \
  -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=ledgerly "$POSTGRES_IMAGE" >/dev/null
until docker exec "$run-db" pg_isready -U ledgerly -d ledgerly -q 2>/dev/null; do sleep 1; done
sleep 2 # the image restarts Postgres once after initialising; wait for the real one
until docker exec "$run-db" pg_isready -U ledgerly -d ledgerly -q 2>/dev/null; do sleep 1; done
started=$SECONDS
docker exec -i "$run-db" pg_restore -U ledgerly -d ledgerly --exit-on-error --no-owner <"$dump"
log "    restored in $((SECONDS - started)) s"

log "3/5 comparing row counts with the backup's manifest"
restored="$(docker exec "$run-db" psql -U ledgerly -d ledgerly -qAtX -c "
  select json_object_agg(t, n order by t) from (
    select schemaname || '.' || tablename as t,
           (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint as n
      from pg_tables where schemaname in ('public', 'drizzle')) counts;")"
if [[ "$restored" != "$(cat "$base.counts.json")" ]]; then
  echo "    MISMATCH" >&2
  diff <(tr ',' '\n' <"$base.counts.json") <(echo "$restored" | tr ',' '\n') >&2 || true
  exit 1
fi
log "    $(echo "$restored" | tr ',' '\n' | wc -l) tables, every count identical"

db_url="postgres://ledgerly:drill@$run-db:5432/ledgerly"
log "4/5 is the schema current? (the app's own migrator, with $API_IMAGE)"
# A restored backup from before a release has pending migrations: that's normal,
# but the drill says so explicitly. MIGRATION_LOCK_TIMEOUT_MS keeps it from hanging.
docker run --rm --network "$run" -e DATABASE_URL="$db_url" "$API_IMAGE" node dist/migrate.js |
  sed 's/^/    /'

log "5/5 starting the API on the restored data"
# MAIL_DRIVER=log: production requires a mail setting, and a drill must never
# email anyone (the restored data holds real users' addresses).
docker run -d --name "$run-api" --network "$run" -e DATABASE_URL="$db_url" \
  -e ENCRYPTION_KEY="$(head -c 32 /dev/urandom | base64)" -e MAIL_DRIVER=log \
  -e LOG_LEVEL=warn "$API_IMAGE" >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$run-api" node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
    log "✅ restore drill passed: $(basename "$dump") is a working backup"
    exit 0
  fi
  sleep 1
done
echo "    the API did not become ready on the restored database" >&2
docker logs --tail 20 "$run-api" >&2
exit 1
