#!/usr/bin/env bash
#
# Thins out the local backups (Stage 19). Hourly dumps for 14 days is 336 copies
# on the SAME disk as the database; a full disk stops Postgres. So:
#
#   - every backup is kept for KEEP_ALL_DAYS (default 2),
#   - after that only the first backup of each UTC day (taken in hour 00) is kept,
#   - and nothing is kept past KEEP_DAYS (default 14).
#
#   deploy/scripts/prune-backups.sh [backup-dir] [keep-all-days] [keep-days]
#
# Off-site copies are the storage's job (bucket lifecycle rules). Only files
# named ledgerly-* are ever touched. Called by backup.sh after every backup.
set -euo pipefail

DIR="${1:-${BACKUP_DIR:-backups}}"
KEEP_ALL_DAYS="${2:-${BACKUP_KEEP_ALL_DAYS:-2}}"
KEEP_DAYS="${3:-${BACKUP_KEEP_DAYS:-14}}"

# Names are UTC timestamps: ledgerly-YYYYMMDDTHHMMSSZ.<ext>. "T00" is the hour.
find "$DIR" -maxdepth 1 -name 'ledgerly-*' -type f -mtime "+$KEEP_DAYS" -print -delete
find "$DIR" -maxdepth 1 -name 'ledgerly-*' -type f -mtime "+$KEEP_ALL_DAYS" \
  ! -name 'ledgerly-????????T00*' -print -delete
