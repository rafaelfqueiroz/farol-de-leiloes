#!/usr/bin/env bash
# Server side of the deploy job in .github/workflows/deploy.yml (ADR-002, DEVELOPMENT §12). It
# automates the runbook's "Deploy a release" and "Roll back" (docs/runbooks/deploy-and-rollback.md)
# and runs as `deploy` in /srv/farol. The workflow sends this file over SSH on every run, so the
# server never runs a stale copy:
#
#   ssh <server> bash -s -- prepare        < deploy/release.sh   # prints the SHA to roll back to
#   ssh <server> bash -s -- deploy <sha>   < deploy/release.sh
#   ssh <server> bash -s -- rollback <sha> < deploy/release.sh
#
# prepare   Empties /srv/farol/.incoming, where the workflow then copies this commit's
#           compose.production.yml and Caddyfile, and prints the running release's SHA (empty on
#           the first deploy): the backend container's image tag while it is healthy, else the last
#           successful release in /srv/farol/.release.
# deploy    Backs up the running release's compose file and Caddyfile to /srv/farol/.previous
#           (from /srv/farol/.released, the files of the last successful release, when that is
#           what runs), installs the incoming ones, pulls, runs the gated migration (DV-34),
#           replaces the single backend, starts frontend and Caddy, reloads Caddy and waits for
#           the backend's Docker health check (AR-48). Writes the SHA to /srv/farol/.release, and
#           the files to /srv/farol/.released, only on success.
# rollback  Restores the files from /srv/farol/.previous and redeploys the given (previous) SHA
#           without migrations: they are forward-only and expand/contract (AR-28, DV-33).
#
# Exit codes: 0 done; 1 failed before the backend was touched, so the running version is
# untouched and there is nothing to roll back; 2 failed after the backend was replaced.
#
# No secret passes through here: the containers read /etc/farol/*.env themselves (SC-16, DV-35),
# and nothing below prints them. One backend instance only, never scaled (ADR-002).
set -euo pipefail

readonly APP_DIR=/srv/farol
readonly RELEASE_FILE="$APP_DIR/.release"
readonly INCOMING_DIR="$APP_DIR/.incoming"
readonly BACKUP_DIR="$APP_DIR/.previous"
readonly RELEASED_DIR="$APP_DIR/.released"
readonly FILES=(compose.production.yml Caddyfile)
# The image's HEALTHCHECK has a 60 s start period, then 3 failures 30 s apart before `unhealthy`.
readonly HEALTH_WAIT_SECONDS=300

log() { printf '==> %s\n' "$*" >&2; }
error() { printf '::error::%s\n' "$*" >&2; }

is_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

dc() { docker compose -f "$APP_DIR/compose.production.yml" "$@"; }

# Copies in place (cp keeps the inode), because compose bind-mounts the Caddyfile as a single file
# and a replaced inode would stay invisible to the running Caddy.
copy_files() {
  local from="$1" to="$2" file
  for file in "${FILES[@]}"; do
    cp -- "$from/$file" "$to/$file"
  done
}

has_files() {
  local dir="$1" file
  for file in "${FILES[@]}"; do
    [[ -s "$dir/$file" ]] || return 1
  done
}

backend_container() {
  # Compose needs RELEASE_SHA to read the file even for `ps`; any value will do here.
  RELEASE_SHA="${RELEASE_SHA:-unset}" dc ps -a -q backend 2>/dev/null | head -n 1
}

running_sha() {
  local id image tag health saved
  id="$(backend_container || true)"
  if [[ -n "$id" ]]; then
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || true)"
    image="$(docker inspect --format '{{.Config.Image}}' "$id" 2>/dev/null || true)"
    tag="${image##*:}"
    if [[ "$health" == "healthy" ]] && is_sha "$tag"; then
      printf '%s\n' "$tag"
      return
    fi
  fi
  if [[ -f "$RELEASE_FILE" ]]; then
    saved="$(head -n 1 "$RELEASE_FILE")"
    if is_sha "$saved"; then
      printf '%s\n' "$saved"
      return
    fi
  fi
  printf '\n'
}

wait_for_backend() {
  local deadline=$((SECONDS + HEALTH_WAIT_SECONDS)) id status
  id="$(backend_container)"
  if [[ -z "$id" ]]; then
    error "No backend container after starting it"
    return 1
  fi
  while true; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo missing)"
    case "$status" in
      healthy)
        log "Backend container is healthy"
        return 0
        ;;
      unhealthy | missing | none)
        error "Backend container health is '$status'"
        return 1
        ;;
    esac
    if ((SECONDS >= deadline)); then
      error "Backend container still '$status' after ${HEALTH_WAIT_SECONDS}s"
      return 1
    fi
    sleep 5
  done
}

# A no-op when the Caddyfile did not change; fails on an invalid one. Retried because a Caddy
# container that `up` has just created needs a moment before its admin endpoint answers.
reload_caddy() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
      return 0
    fi
    log "Caddy reload attempt $attempt failed, retrying"
    sleep 5
  done
  error "Caddy did not accept the Caddyfile"
  return 1
}

# Runbook steps 4 and 5: one backend instance only, stopped before its replacement starts. Each
# step returns explicitly: callers test this function, and `set -e` does not apply inside a test.
replace_and_wait() {
  log "Replacing the backend (one instance)"
  dc stop backend || return 1
  dc up -d --no-deps backend || return 1
  log "Starting frontend and Caddy"
  dc up -d frontend caddy || return 1
  log "Reloading Caddy's configuration"
  reload_caddy || return 1
  log "Waiting for the backend's health check (up to ${HEALTH_WAIT_SECONDS}s)"
  wait_for_backend
}

# The SHA and the files of the last successful release, so a later deploy backs up these and not
# the files of a failed release that was never rolled back.
record_release() {
  install -d -m 750 "$RELEASED_DIR"
  copy_files "$APP_DIR" "$RELEASED_DIR"
  printf '%s\n' "$1" >"$RELEASE_FILE.tmp"
  mv -f -- "$RELEASE_FILE.tmp" "$RELEASE_FILE"
}

# Keeps the files of the running release in $BACKUP_DIR: the snapshot of the last successful
# release when that is what runs, otherwise (a release deployed by hand) the files in place.
back_up_files() {
  local running saved=""
  running="$(running_sha)"
  [[ -f "$RELEASE_FILE" ]] && saved="$(head -n 1 "$RELEASE_FILE")"
  install -d -m 750 "$BACKUP_DIR"
  if [[ -n "$running" && "$running" == "$saved" ]] && has_files "$RELEASED_DIR"; then
    copy_files "$RELEASED_DIR" "$BACKUP_DIR"
  elif has_files "$APP_DIR"; then
    copy_files "$APP_DIR" "$BACKUP_DIR"
  fi
}

prepare() {
  install -d -m 750 "$INCOMING_DIR"
  rm -f -- "$INCOMING_DIR"/*
  running_sha
}

deploy() {
  local sha="$1"
  if ! has_files "$INCOMING_DIR"; then
    error "Missing ${FILES[*]} in $INCOMING_DIR"
    return 1
  fi
  export RELEASE_SHA="$sha"

  log "Installing this release's compose file and Caddyfile (previous ones kept in $BACKUP_DIR)"
  back_up_files
  copy_files "$INCOMING_DIR" "$APP_DIR"

  log "Pulling frontend and backend $sha"
  if ! dc pull frontend backend; then
    restore_files
    error "Pull failed; the running version is untouched"
    return 1
  fi

  log "Running the migrations (DV-34)"
  if ! dc --profile migrate run --rm -T migrate; then
    restore_files
    error "Migration failed; the running version is untouched (DV-34). Fix forward or abandon the release"
    return 1
  fi

  if ! replace_and_wait; then
    error "Release $sha failed after the backend was replaced"
    return 2
  fi
  record_release "$sha"
  log "Released $sha"
}

# Puts back the files of the running version after a failure before the backend was touched.
restore_files() {
  if has_files "$BACKUP_DIR"; then
    copy_files "$BACKUP_DIR" "$APP_DIR"
  fi
}

rollback() {
  local sha="$1"
  export RELEASE_SHA="$sha"
  if has_files "$BACKUP_DIR"; then
    log "Restoring the previous compose file and Caddyfile"
    copy_files "$BACKUP_DIR" "$APP_DIR"
  fi
  # No migrations on the way back (AR-28, DV-33).
  log "Rolling back to $sha: pulling frontend and backend"
  dc pull frontend backend || return 2
  if ! replace_and_wait; then
    error "Rollback to $sha failed"
    return 2
  fi
  record_release "$sha"
  log "Rolled back to $sha"
}

main() {
  local command="${1:-}" sha="${2:-}"
  cd "$APP_DIR"
  case "$command" in
    prepare)
      prepare
      ;;
    deploy | rollback)
      if ! is_sha "$sha"; then
        error "Usage: release.sh $command <full 40-character commit SHA>"
        return 1
      fi
      "$command" "$sha"
      ;;
    *)
      error "Usage: release.sh prepare | deploy <sha> | rollback <sha>"
      return 1
      ;;
  esac
}

# The script arrives on stdin (`bash -s`), so nothing it runs may read stdin: bash has read up to
# this line once main runs, and main's stdin is /dev/null.
main "$@" </dev/null
