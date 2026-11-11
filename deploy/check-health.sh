#!/usr/bin/env bash
# Health check of a release from outside the server, through Caddy and TLS (AR-48). Used by the
# deploy job in .github/workflows/deploy.yml after a deploy and after a rollback; it also works by
# hand from any machine:
#
#   API_URL=https://api.<host> SITE_URL=https://<host> bash deploy/check-health.sh
#
# `GET <API_URL>/api/health` must answer 200 (ok or degraded: the API is serving; 503 is down, see
# docs/runbooks/health-check.md), and the site must answer 200. Bounded retries cover Caddy
# picking up a restarted container. Only status codes are printed, never a response body.
set -euo pipefail

: "${API_URL:?set API_URL to https://<api-host>}"
: "${SITE_URL:?set SITE_URL to https://<site-host>}"
readonly ATTEMPTS="${HEALTH_ATTEMPTS:-12}"
readonly DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-10}"

status_of() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 10 --location --max-redirs 5 --proto '=https' --proto-redir '=https' \
    -- "$1" || true
}

wait_for_200() {
  local name="$1" url="$2" attempt code
  for ((attempt = 1; attempt <= ATTEMPTS; attempt++)); do
    code="$(status_of "$url")"
    if [[ "$code" == "200" ]]; then
      echo "$name: 200"
      return 0
    fi
    echo "$name: ${code:-no answer} (attempt $attempt of $ATTEMPTS)"
    if ((attempt < ATTEMPTS)); then
      sleep "$DELAY_SECONDS"
    fi
  done
  echo "::error::$name did not answer 200 after $ATTEMPTS attempts"
  return 1
}

wait_for_200 "API health" "${API_URL%/}/api/health"
wait_for_200 "Site" "${SITE_URL%/}/"
