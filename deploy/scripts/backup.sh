#!/usr/bin/env bash
#
# Back up the production database.
#
#   deploy/scripts/backup.sh            → deploy/backups/ledgerly-<UTC time>.dump (+ .sha256, .counts.json)
#
# Run it from cron (e.g. hourly) and COPY THE FILES OFF THIS SERVER: a backup
# on the same disk as the database dies with it. Set BACKUP_UPLOAD to a command
# that uploads one file, e.g.  BACKUP_UPLOAD='aws s3 cp {} s3://my-bucket/ledgerly/'
#
# What's in the box:
#   <name>.dump         pg_dump "custom" format: compressed, restorable table by table
#   <name>.sha256       checksum, so a corrupted copy is detected before you rely on it
#   <name>.counts.json  exact row count of every table, read from the SAME database
#                       snapshot as the dump; restore-drill.sh compares against it
set -euo pipefail

cd "$(dirname "$0")/.."                     # → deploy/
ENV_FILE="${ENV_FILE:-.env}"
DIR="${BACKUP_DIR:-backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$DIR"
name="ledgerly-$(date -u +%Y%m%dT%H%M%SZ)"
log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# psql/pg_dump run INSIDE the postgres container: always the same version as the server.
db() { IMAGE_TAG="${IMAGE_TAG:-unused}" docker compose --env-file "$ENV_FILE" exec -T postgres "$@"; }

# Hold a REPEATABLE READ transaction open and export its snapshot. pg_dump reads
# that exact snapshot, and so do the row counts below: they describe the same
# moment, even while users keep writing.
coproc SNAPSHOT { db psql -U ledgerly -d ledgerly -qAtX; }
echo "begin isolation level repeatable read; select pg_export_snapshot();" >&"${SNAPSHOT[1]}"
read -r snapshot <&"${SNAPSHOT[0]}"
log "snapshot $snapshot"

log "dumping to $DIR/$name.dump"
db pg_dump -U ledgerly -d ledgerly --format=custom --snapshot="$snapshot" >"$DIR/$name.dump.partial"

# Exact row counts of every table, one JSON object on one line.
echo "select json_object_agg(t, n order by t) from (
        select schemaname || '.' || tablename as t,
               (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint as n
          from pg_tables where schemaname in ('public', 'drizzle')) counts;" >&"${SNAPSHOT[1]}"
read -r counts <&"${SNAPSHOT[0]}"
echo "commit;" >&"${SNAPSHOT[1]}"
snapshot_in="${SNAPSHOT[1]}"
exec {snapshot_in}>&- # close psql's input: it exits
wait "$SNAPSHOT_PID" 2>/dev/null || true

echo "$counts" >"$DIR/$name.counts.json"
# Only a complete dump gets its final name: a crash mid-dump leaves a .partial, never a "backup".
mv "$DIR/$name.dump.partial" "$DIR/$name.dump"
(cd "$DIR" && sha256sum "$name.dump" >"$name.sha256")
log "done: $(du -h "$DIR/$name.dump" | cut -f1), $(grep -o ',' "$DIR/$name.counts.json" | wc -l | awk '{print $1 + 1}') tables"

if [[ -n "${BACKUP_UPLOAD:-}" ]]; then
  for f in "$DIR/$name.dump" "$DIR/$name.sha256" "$DIR/$name.counts.json"; do
    log "uploading $f"
    eval "${BACKUP_UPLOAD//\{\}/\"$f\"}"
  done
fi

# Local retention. (Off-site retention is the storage's job, e.g. bucket lifecycle rules.)
find "$DIR" -name 'ledgerly-*' -type f -mtime "+$KEEP_DAYS" -print -delete | sed 's/^/deleted old backup: /'
