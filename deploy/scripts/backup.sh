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
# Off-site copies are ENCRYPTED (Stage 16): the dump holds every household's
# finances, emails and password hashes, and a bucket is one wrong setting away
# from public. Set BACKUP_AGE_RECIPIENT to an `age` public key (age1…); the
# matching private key, kept elsewhere, is the only way to read the copies.
# The script refuses to upload without it (BACKUP_UPLOAD_UNENCRYPTED=1 to
# insist, e.g. for a bucket that encrypts with its own keys you control).
#
# Set BACKUP_HEARTBEAT_URL to a check-in URL (healthchecks.io, Cronitor, Better
# Stack…): it's requested after every SUCCESSFUL backup, and that service
# emails you when the requests stop. A backup that silently stopped working is
# found in an hour, not on the day you need it.
#
# What's in the box:
#   <name>.dump         pg_dump "custom" format: compressed, restorable table by table
#   <name>.sha256       checksum, so a corrupted copy is detected before you rely on it
#   <name>.counts.json  exact row count of every table, read from the SAME database
#                       snapshot as the dump; restore-drill.sh compares against it
set -euo pipefail

# Where this script lives, as an ABSOLUTE path, before the cd below: $0 may be
# relative to the directory we were started in (CI runs deploy/scripts/backup.sh
# from the repo root), and a sibling script looked up afterwards wouldn't be found.
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPTS/.."                            # → deploy/
ENV_FILE="${ENV_FILE:-.env}"
DIR="${BACKUP_DIR:-backups}"
mkdir -p "$DIR"
name="ledgerly-$(date -u +%Y%m%dT%H%M%SZ)"
log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"

# Decide BEFORE dumping: an upload that's going to be refused should fail now.
if [[ -n "${BACKUP_UPLOAD:-}" && -z "$RECIPIENT" && "${BACKUP_UPLOAD_UNENCRYPTED:-}" != "1" ]]; then
  log "refusing to upload an unencrypted backup: set BACKUP_AGE_RECIPIENT (see docs/runbook.md)" >&2
  exit 1
fi
if [[ -n "$RECIPIENT" ]] && ! command -v age >/dev/null; then
  log "BACKUP_AGE_RECIPIENT is set but \`age\` isn't installed (apt install age)" >&2
  exit 1
fi

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
  dump="$DIR/$name.dump"
  if [[ -n "$RECIPIENT" ]]; then
    log "encrypting for $RECIPIENT"
    age --recipient "$RECIPIENT" --output "$dump.age" "$dump"
    dump="$dump.age"
  fi
  # The checksum is of the PLAIN dump: the drill checks it after decrypting.
  for f in "$dump" "$DIR/$name.sha256" "$DIR/$name.counts.json"; do
    log "uploading $f"
    eval "${BACKUP_UPLOAD//\{\}/\"$f\"}"
  done
  # The local copy stays plain (it sits next to the database it came from).
  [[ "$dump" == *.age ]] && rm -f "$dump"
fi

# Local retention, thinned (Stage 19): every copy for 2 days, then one per UTC
# day until day 14. (Off-site retention is the storage's job, e.g. bucket lifecycle rules.)
"$SCRIPTS/prune-backups.sh" "$DIR" | sed 's/^/deleted old backup: /'

# Every step above succeeded (set -e stops at the first failure): check in.
if [[ -n "${BACKUP_HEARTBEAT_URL:-}" ]]; then
  curl -fsS --max-time 10 --retry 3 "$BACKUP_HEARTBEAT_URL" >/dev/null ||
    log "warning: the heartbeat check-in failed (the backup itself is fine)"
fi
