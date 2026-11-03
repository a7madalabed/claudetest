#!/usr/bin/env bash
#
# Deploy a version of Ledgerly on this server, with no downtime and an
# automatic rollback.
#
#   deploy/scripts/deploy.sh <image-tag>      e.g. a git commit SHA built by CI
#
# Steps:
#   1. pull the new images (fail here = nothing changed);
#   2. run database migrations (fail here = nothing changed: the old version
#      keeps running, and migrations are always backwards-compatible);
#   3. ROLLING update of api, worker and web: start a new container NEXT TO the
#      old one, wait until it is healthy, then stop the old one gracefully (it
#      drains first). If the new one never gets healthy, the old one is untouched;
#   4. smoke test through the public entrance (Caddy, HTTPS);
#   5. if anything after step 2 fails: roll back to the previous version.
#
# Run from anywhere; needs docker compose and deploy/.env.
set -euo pipefail

NEW_TAG="${1:?usage: deploy.sh <image-tag>}"
cd "$(dirname "$0")/.."                     # → deploy/
ENV_FILE="${ENV_FILE:-.env}"
HISTORY=".deploy-history"                    # one tag per line, newest last
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"      # seconds a new container may take to get healthy

compose() { IMAGE_TAG="$TAG" docker compose --env-file "$ENV_FILE" "$@"; }
log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
site() { grep -E '^SITE_ADDRESS=' "$ENV_FILE" | cut -d= -f2-; }

# Wait until container $1 reports "healthy" (every image here has a HEALTHCHECK).
wait_healthy() {
  local id="$1" deadline=$((SECONDS + HEALTH_TIMEOUT)) status
  while ((SECONDS < deadline)); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo missing)"
    case "$status" in
      healthy) return 0 ;;
      unhealthy | missing) return 1 ;;
    esac
    sleep 2
  done
  return 1
}

# Replace the containers of service $1 with ones running $TAG, one at a time.
roll() {
  local service="$1" old new
  old="$(compose ps -q "$service")"
  if [[ -z "$old" ]]; then
    log "$service: not running yet — starting it"
    compose up -d --no-deps --wait "$service"
    return
  fi
  log "$service: starting a $TAG container next to the running one"
  # --no-recreate leaves the old container alone; scaling to 2 adds one new
  # container built from the CURRENT config, i.e. the new image tag.
  compose up -d --no-deps --no-recreate --scale "$service=2" "$service" >/dev/null
  new="$(compose ps -q "$service" | grep -v -F "$old" || true)"
  if [[ -z "$new" ]] || ! wait_healthy "$new"; then
    log "$service: the new container did not become healthy — keeping the old one"
    [[ -n "$new" ]] && docker logs --tail 30 "$new" 2>&1 | sed 's/^/    /'
    [[ -n "$new" ]] && docker rm -f "$new" >/dev/null
    return 1
  fi
  log "$service: new container healthy — draining and stopping the old one"
  # SIGTERM → the API answers "not ready", finishes in-flight work, exits.
  docker stop --timeout 30 "$old" >/dev/null
  docker rm "$old" >/dev/null
}

# Through the PUBLIC entrance, exactly as a user's browser arrives.
smoke_test() {
  local host base insecure=() body
  host="$(site)"
  base="https://$host"
  # A real domain has a real certificate; "localhost" uses Caddy's internal CA.
  [[ "$host" == "localhost" ]] && insecure=(-k)
  for _ in 1 2 3 4 5; do
    if body="$(curl -fsS "${insecure[@]}" --max-time 5 --resolve "$host:443:127.0.0.1" "$base/healthz")" &&
      [[ "$body" == *"\"version\":\"$TAG\""* ]] &&
      curl -fsS "${insecure[@]}" --max-time 5 --resolve "$host:443:127.0.0.1" "$base/api/health/ready" >/dev/null &&
      curl -fsS "${insecure[@]}" --max-time 5 --resolve "$host:443:127.0.0.1" -o /dev/null "$base/login"; then
      return 0
    fi
    sleep 3
  done
  return 1
}

deploy() {
  for service in api worker web; do roll "$service" || return 1; done
  # Caddy and Postgres aren't part of a release; start them if they aren't running.
  compose up -d --no-deps --no-recreate caddy postgres >/dev/null
  log "smoke test: https://$(site)"
  smoke_test || { log "smoke test FAILED"; return 1; }
}

PREVIOUS_TAG="$(tail -n 1 "$HISTORY" 2>/dev/null || true)"
TAG="$NEW_TAG"
log "deploying $TAG (currently: ${PREVIOUS_TAG:-nothing})"

log "pulling images"
if [[ "${SKIP_PULL:-}" != "1" ]]; then compose pull --quiet migrate api worker web; fi

log "running database migrations"
compose run --rm migrate

if deploy; then
  echo "$TAG" >>"$HISTORY"
  log "✅ $TAG is live"
  exit 0
fi

if [[ -z "$PREVIOUS_TAG" ]]; then
  log "❌ deploy failed and there is no previous version to return to"
  exit 1
fi
log "❌ deploy of $TAG failed — rolling back to $PREVIOUS_TAG"
TAG="$PREVIOUS_TAG"
if deploy; then
  log "↩️  rolled back: $PREVIOUS_TAG is live again"
else
  log "🚨 ROLLBACK FAILED — see docs/runbook.md#failed-deploy"
fi
exit 1
