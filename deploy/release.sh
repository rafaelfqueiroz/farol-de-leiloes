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
#           compose.production.yml and Caddyfile, and into .incoming/env the env files it rendered
#           from the deploy-production environment (deploy/render-env.sh, ADR-004). Prints the
#           running release's SHA (empty on the first deploy): the backend container's image tag
#           while it is healthy, else the last successful release in /srv/farol/.release.
# deploy    Backs up the running release's files to /srv/farol/.previous (from
#           /srv/farol/.released, the files of the last successful release, when that is what
#           runs) and installs the incoming ones, the env files in /srv/farol/env, before anything
#           else, because the migration reads them too. Then pulls, runs the gated migration
#           (DV-34), replaces the single backend, starts frontend and Caddy, reloads Caddy and
#           waits for the backend's Docker health check (AR-48). Writes the SHA to
#           /srv/farol/.release, and the files to /srv/farol/.released, only on success.
# rollback  Restores the files, env files included, from /srv/farol/.previous and redeploys the
#           given (previous) SHA without migrations: they are forward-only and expand/contract
#           (AR-28, DV-33).
#
# The files form two sets, each backed up and restored whole: the compose file and Caddyfile, and
# the three env files. A server whose last release predates ADR-004 has no env set yet: its first
# deploy then backs up the compose set alone, and a rollback puts back a compose file that still
# reads /etc/farol, which therefore stays in place until that deploy has succeeded.
#
# A container is recreated when its env file changes. Compose would do it anyway (its
# configuration hash covers the environment it reads from env_file), but the deploy asks for it
# explicitly with --force-recreate, so it does not depend on that. Caddy needs a recreate: a
# reload re-reads the Caddyfile, not the container's environment.
#
# Exit codes: 0 done; 1 failed before the backend was touched, so the running version is
# untouched and there is nothing to roll back; 2 failed after the backend was replaced.
#
# Secrets reach the server only as the env files the workflow copies over SSH, never on a command
# line. They are kept in directories of mode 700, in files of mode 600 owned by `deploy`, and
# nothing below prints them (SC-16, DV-35). One backend instance only, never scaled (ADR-002).
set -euo pipefail

readonly APP_DIR=/srv/farol
readonly RELEASE_FILE="$APP_DIR/.release"
readonly INCOMING_DIR="$APP_DIR/.incoming"
readonly BACKUP_DIR="$APP_DIR/.previous"
readonly RELEASED_DIR="$APP_DIR/.released"
readonly CONFIG_FILES=(compose.production.yml Caddyfile)
readonly ENV_FILES=(env/caddy.env env/frontend.env env/backend.env)
# The services whose env file the files being installed change (set by note_env_changes).
RECREATE=()
# The image's HEALTHCHECK has a 60 s start period, then 3 failures 30 s apart before `unhealthy`.
readonly HEALTH_WAIT_SECONDS=300

log() { printf '==> %s\n' "$*" >&2; }
error() { printf '::error::%s\n' "$*" >&2; }

is_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

dc() { docker compose -f "$APP_DIR/compose.production.yml" "$@"; }

# copy_files <from> <to> <file>... The compose file and Caddyfile are copied in place (cp keeps
# the inode), because compose bind-mounts the Caddyfile as a single file and a replaced inode would
# stay invisible to the running Caddy. Env files are read by compose only; they get mode 600 in a
# directory of mode 700.
copy_files() {
  local from="$1" to="$2" file
  shift 2
  for file in "$@"; do
    case "$file" in
      env/*)
        install -d -m 700 "$to/env"
        chmod 700 "$to/env"
        install -m 600 -- "$from/$file" "$to/$file"
        ;;
      *)
        cp -- "$from/$file" "$to/$file"
        ;;
    esac
  done
}

# has_files <dir> <file>...
has_files() {
  local dir="$1" file
  shift
  for file in "$@"; do
    [[ -s "$dir/$file" ]] || return 1
  done
}

# copy_sets <from> <to>: copies each set whose files are all in <from>.
copy_sets() {
  local from="$1" to="$2"
  if has_files "$from" "${CONFIG_FILES[@]}"; then
    copy_files "$from" "$to" "${CONFIG_FILES[@]}"
  fi
  if has_files "$from" "${ENV_FILES[@]}"; then
    copy_files "$from" "$to" "${ENV_FILES[@]}"
  fi
}

# note_env_changes <dir>: the services whose env file in <dir> differs from the installed one.
note_env_changes() {
  local from="$1" service
  RECREATE=()
  has_files "$from" "${ENV_FILES[@]}" || return 0
  for service in caddy frontend backend; do
    if ! cmp -s -- "$from/env/$service.env" "$APP_DIR/env/$service.env"; then
      RECREATE+=("$service")
    fi
  done
  if ((${#RECREATE[@]})); then
    log "Env file changed for: ${RECREATE[*]}"
  fi
}

needs_recreate() { [[ " ${RECREATE[*]-} " == *" $1 "* ]]; }

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
  local backend_flags=() recreate=() service
  if needs_recreate backend; then
    backend_flags=(--force-recreate)
  fi
  log "Replacing the backend (one instance)"
  dc stop backend || return 1
  dc up -d --no-deps "${backend_flags[@]}" backend || return 1
  for service in frontend caddy; do
    if needs_recreate "$service"; then
      recreate+=("$service")
    fi
  done
  if ((${#recreate[@]})); then
    log "Recreating ${recreate[*]} for its new env file"
    dc up -d --no-deps --force-recreate "${recreate[@]}" || return 1
  fi
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
  install -d -m 700 "$RELEASED_DIR"
  chmod 700 "$RELEASED_DIR"
  copy_sets "$APP_DIR" "$RELEASED_DIR"
  printf '%s\n' "$1" >"$RELEASE_FILE.tmp"
  mv -f -- "$RELEASE_FILE.tmp" "$RELEASE_FILE"
}

# Keeps the files of the running release in $BACKUP_DIR, each set on its own: the snapshot of the
# last successful release when that is what runs, otherwise (a release deployed by hand) the files
# in place. A set with nothing to back up leaves none behind, so a rollback never restores a set
# older than the running one.
back_up_files() {
  local running saved="" snapshot=false
  running="$(running_sha)"
  [[ -f "$RELEASE_FILE" ]] && saved="$(head -n 1 "$RELEASE_FILE")"
  if [[ -n "$running" && "$running" == "$saved" ]]; then
    snapshot=true
  fi
  install -d -m 700 "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  back_up_set "$snapshot" "${CONFIG_FILES[@]}"
  back_up_set "$snapshot" "${ENV_FILES[@]}"
}

# back_up_set <true to prefer the last release's snapshot> <file>...
back_up_set() {
  local snapshot="$1" file
  shift
  for file in "$@"; do
    rm -f -- "${BACKUP_DIR:?}/$file"
  done
  if [[ "$snapshot" == true ]] && has_files "$RELEASED_DIR" "$@"; then
    copy_files "$RELEASED_DIR" "$BACKUP_DIR" "$@"
  elif has_files "$APP_DIR" "$@"; then
    copy_files "$APP_DIR" "$BACKUP_DIR" "$@"
  fi
}

prepare() {
  install -d -m 700 "$INCOMING_DIR"
  chmod 700 "$INCOMING_DIR"
  rm -rf -- "${INCOMING_DIR:?}"/*
  install -d -m 700 "$INCOMING_DIR/env"
  running_sha
}

deploy() {
  local sha="$1"
  if ! has_files "$INCOMING_DIR" "${CONFIG_FILES[@]}" "${ENV_FILES[@]}"; then
    error "Missing ${CONFIG_FILES[*]} ${ENV_FILES[*]} in $INCOMING_DIR"
    return 1
  fi
  export RELEASE_SHA="$sha"

  # Before the migration, which reads the new env files too.
  log "Installing this release's compose file, Caddyfile and env files (previous ones kept in $BACKUP_DIR)"
  back_up_files
  note_env_changes "$INCOMING_DIR"
  copy_files "$INCOMING_DIR" "$APP_DIR" "${CONFIG_FILES[@]}" "${ENV_FILES[@]}"
  rm -f -- "$INCOMING_DIR"/env/*.env

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

# Puts back the files of the running version, env files included, after a failure before the
# backend was touched. Its containers never read the new ones, so none needs recreating.
restore_files() {
  copy_sets "$BACKUP_DIR" "$APP_DIR"
}

rollback() {
  local sha="$1"
  export RELEASE_SHA="$sha"
  log "Restoring the previous compose file, Caddyfile and env files"
  note_env_changes "$BACKUP_DIR"
  copy_sets "$BACKUP_DIR" "$APP_DIR"
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
