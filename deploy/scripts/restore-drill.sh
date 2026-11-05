#!/usr/bin/env bash
#
# Prove a backup can be restored — and that what comes back is complete and
# usable. A backup that has never been restored is a hope, not a backup.
#
#   deploy/scripts/restore-drill.sh [backups/ledgerly-<time>.dump]   (default: the newest)
#   BACKUP_AGE_IDENTITY=key.txt deploy/scripts/restore-drill.sh ledgerly-<time>.dump.age
#
# Drill the OFF-SITE copy when you can (Stage 16): download the newest one with
# your storage's tool, then pass the .dump.age with the private key that
# decrypts it. That proves what you'd actually restore from after losing this
# server: the copy elsewhere, the key, and the steps. DRILL_HEARTBEAT_URL is
# requested when the drill passes (see backup.sh), so a drill that stopped
# running or passing is noticed.
#
# Everything happens in THROWAWAY containers on a private network; production
# is never touched. Steps:
#   1. verify the checksum (is the file what was written?);
#   2. restore into a fresh Postgres of the same version (stops at the first error);
#   3. compare every table's row count with the counts saved at backup time;
#   4. bring the restored schema up to date with the app's own migrator
#      (a backup from before a release has migrations to apply — that's normal);
#   5. start the API on the restored database and check it reports ready.
# Exit code 0 only if all of them pass. Run it on a schedule, e.g. weekly.
set -euo pipefail

cd "$(dirname "$0")/.."                     # → deploy/
DIR="${BACKUP_DIR:-backups}"
# Names are UTC timestamps, so the newest sorts last.
dump="${1:-$(printf '%s\n' "$DIR"/ledgerly-*.dump | sort | tail -n 1)}"
[[ -f "$dump" ]] || { echo "no backup found in $DIR/" >&2; exit 1; }
base="${dump%.age}"
base="${base%.dump}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:18.6-alpine3.24}"
API_IMAGE="${API_IMAGE:-${REGISTRY:-ghcr.io/a7madalabed}/ledgerly-api:${IMAGE_TAG:-latest}}"
run="drill-$$"
log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
plain=""
# shellcheck disable=SC2317,SC2329 # invoked by the trap below (older shellcheck: SC2317)
cleanup() {
  docker rm -f "$run-db" "$run-api" >/dev/null 2>&1 || true
  docker network rm "$run" >/dev/null 2>&1 || true
  [[ -n "$plain" ]] && rm -f "$plain"
}
trap cleanup EXIT

if [[ "$dump" == *.age ]]; then
  [[ -n "${BACKUP_AGE_IDENTITY:-}" ]] || {
    echo "$(basename "$dump") is encrypted: set BACKUP_AGE_IDENTITY to the private key file" >&2
    exit 1
  }
  log "0/5 decrypting $(basename "$dump")"
  plain="$(mktemp)"
  age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$plain" "$dump"
  dump="$plain"
fi

log "1/5 checksum (the file is what backup.sh wrote)"
expected="$(cut -d' ' -f1 "$base.sha256")"
actual="$(sha256sum "$dump" | cut -d' ' -f1)"
if [[ "$expected" != "$actual" ]]; then
  echo "    checksum MISMATCH: the backup is damaged or isn't the one the .sha256 describes" >&2
  exit 1
fi

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
log "4/5 bringing the schema up to date (the app's own migrator, with $API_IMAGE)"
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
    log "✅ restore drill passed: $(basename "$base").dump is a working backup"
    if [[ -n "${DRILL_HEARTBEAT_URL:-}" ]]; then
      curl -fsS --max-time 10 --retry 3 "$DRILL_HEARTBEAT_URL" >/dev/null ||
        log "warning: the heartbeat check-in failed (the drill itself passed)"
    fi
    exit 0
  fi
  sleep 1
done
echo "    the API did not become ready on the restored database" >&2
docker logs --tail 20 "$run-api" >&2
exit 1
