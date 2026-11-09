#!/usr/bin/env bash
#
# Tests for prune-backups.sh: exactly which local backups survive. Runs in a
# temp folder; nothing real is touched.   deploy/scripts/prune-backups.test.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

# make <name-time> <age-in-days>: one whole backup (its three files), aged by mtime.
make() {
  local ext
  for ext in dump sha256 counts.json; do
    touch -d "$2 days ago" "$dir/ledgerly-$1Z.$ext"
  done
}

make 20261109T143000 0   # an hourly copy from now                -> keep
make 20261108T143000 1   # an hourly copy, 1 day old              -> keep (inside the keep-all window)
make 20261106T143000 3   # an hourly copy, 3 days old             -> DELETE (thinned out)
make 20261106T001500 3   # the first copy of its day, 3 days old  -> keep (one per day)
make 20261027T001500 13  # the first copy of its day, 13 days old -> keep
make 20261025T001500 15  # the first copy of its day, 15 days old -> DELETE (past the limit)
touch -d "30 days ago" "$dir/notes.txt" # not a backup: never touched

"$here/prune-backups.sh" "$dir" 2 14 >/dev/null

expected="$(printf '%s\n' \
  ledgerly-20261027T001500Z \
  ledgerly-20261106T001500Z \
  ledgerly-20261108T143000Z \
  ledgerly-20261109T143000Z | sort)"
# Compare backups as a whole (the part before the first dot), so a lone leftover file shows up too.
actual="$(find "$dir" -maxdepth 1 -name 'ledgerly-*' -printf '%f\n' | sed 's/\..*//' | sort | uniq -c |
  awk '{ if ($1 != 3) print "INCOMPLETE:" $2; else print $2 }' | sort)"

fail=0
if [[ "$actual" != "$expected" ]]; then
  echo "FAIL: the wrong backups survived" >&2
  diff <(echo "$expected") <(echo "$actual") >&2 || true
  fail=1
fi
[[ -e "$dir/notes.txt" ]] || { echo "FAIL: a file that isn't a backup was deleted" >&2; fail=1; }

if [[ $fail -eq 0 ]]; then echo "prune-backups: all checks passed"; fi
exit "$fail"
