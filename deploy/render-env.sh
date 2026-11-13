#!/usr/bin/env bash
# Production runtime configuration, rendered on the deploy job's runner (ADR-004, DV-35, SC-16).
# The values come from the GitHub `deploy-production` environment: environment secrets for secret
# values, environment variables for the rest. deploy.yml maps every name listed in ENTRIES below
# into the environment of the steps that run this script, and nothing else does; the structural
# test backend/test/structural/deploy-config.spec.ts keeps that mapping, this list and
# backend/.env.example equal, so a new variable cannot be forgotten.
#
#   bash deploy/render-env.sh check        # preflight: every required value is set and writable
#   bash deploy/render-env.sh render <dir> # deploy: writes <dir>/{caddy,frontend,backend}.env
#
# `render` runs the same checks first, then (re)creates <dir> with mode 700 and the three files
# with mode 600. An optional value that is unset or empty gets no line at all, so the
# application's default applies (AR-41). The job sends the files to /srv/farol/.incoming/env and
# deploy/release.sh installs them in /srv/farol/env, which compose.production.yml reads.
#
# Quoting. Docker Compose v2 reads env_file lines as KEY=VALUE, and a single-quoted value is used
# literally: no `$` interpolation, no escape sequences such as \n, and `#` is not a comment
# (https://docs.docker.com/reference/compose-file/services/#env_file-format). Every value is
# therefore written as KEY='value'. Such a value cannot hold a line break (each line is a
# variable), a single quote (it ends the value) or a backslash (`\'` is an escaped quote, so a
# trailing one would swallow the closing quote), and a value holding any of them is rejected:
# the error names the variable, never its value.
#
# Values are never printed, and nothing here may run with `set -x`: GitHub masks secrets in the
# log, but the variables are not secrets and the masking is not relied on (SC-16).
set -euo pipefail

# NAME, SOURCE (secret = environment secret, variable = environment variable), FILE (the env file
# it goes to) and NEED: required, optional, or llm:<provider> (required when LLM_PROVIDER is that
# provider). `required` is what src/config/env.schema.ts requires in production, plus
# TRUST_PROXY_HOPS (Caddy is one hop; the schema's default of 0 would break SC-04 behind it) and
# Caddy's two host names.
readonly ENTRIES=(
  # caddy.env
  "SITE_DOMAIN                  variable  caddy    required"
  "API_DOMAIN                   variable  caddy    required"
  # backend.env, in the order of backend/.env.example. NODE_ENV comes from the image.
  "FRONTEND_URL                 variable  backend  required"
  "TRUST_PROXY_HOPS             variable  backend  required"
  "MONGODB_URI                  secret    backend  required"
  "JWT_SECRET                   secret    backend  required"
  "GOOGLE_CLIENT_ID             variable  backend  required"
  "GOOGLE_CLIENT_SECRET         secret    backend  required"
  "GOOGLE_CALLBACK_URL          variable  backend  required"
  "STRIPE_SECRET_KEY            secret    backend  required"
  "STRIPE_WEBHOOK_SECRET        secret    backend  required"
  "STRIPE_STANDARD_PRICE_ID     variable  backend  required"
  "EMAIL_FROM                   variable  backend  required"
  "SMTP_HOST                    variable  backend  required"
  "SMTP_PORT                    variable  backend  optional"
  "SMTP_SECURE                  variable  backend  optional"
  "SMTP_USER                    variable  backend  required"
  "SMTP_PASS                    secret    backend  required"
  "SMS_PROVIDER_API_KEY         secret    backend  required"
  "WHATSAPP_API_KEY             secret    backend  required"
  "LLM_PROVIDER                 variable  backend  optional"
  "OLLAMA_MODEL                 variable  backend  optional"
  "OLLAMA_BASE_URL              variable  backend  optional"
  "GROQ_MODEL                   variable  backend  optional"
  "GROQ_API_KEY                 secret    backend  llm:groq"
  "GEMINI_MODEL                 variable  backend  optional"
  "GOOGLE_API_KEY               secret    backend  llm:gemini"
  "OPENAI_MODEL                 variable  backend  optional"
  "OPENAI_API_KEY               secret    backend  llm:openai"
  "ANTHROPIC_MODEL              variable  backend  optional"
  "ANTHROPIC_API_KEY            secret    backend  llm:anthropic"
  "CLOUDFLARE_ACCOUNT_ID        variable  backend  required"
  "R2_ACCESS_KEY_ID             secret    backend  required"
  "R2_SECRET_ACCESS_KEY         secret    backend  required"
  "R2_BUCKET                    variable  backend  required"
  "R2_PUBLIC_URL                variable  backend  required"
  "IMPORT_ENABLED               variable  backend  optional"
  "IMPORT_ON_START_UP           variable  backend  optional"
  "SCRAPER_ENABLED              variable  backend  optional"
  "SCRAPER_ON_START_UP          variable  backend  optional"
  "REMINDERS_ENABLED            variable  backend  optional"
  "CLEANUP_ON_STARTUP           variable  backend  optional"
  "NEIGHBORHOODS_CACHE_ENABLED  variable  backend  optional"
  "NEIGHBORHOODS_CACHE_TTL      variable  backend  optional"
  "LOG_LEVEL                    variable  backend  optional"
  "LOG_HASH_SECRET              secret    backend  required"
  "SENTRY_DSN                   secret    backend  optional"
)

# Fixed by compose.production.yml rather than configured: the Caddyfile and the frontend reach the
# backend on port 3000 over the private network.
readonly BACKEND_CONSTANTS=(
  "PORT=3000"
)
readonly FRONTEND_CONSTANTS=(
  "BACKEND_API_URL=http://backend:3000"
)

readonly FILES=(caddy frontend backend)
readonly LLM_PROVIDERS=" ollama groq gemini openai anthropic "

error() { printf '::error::%s\n' "$*" >&2; }

value_of() { printf '%s' "${!1-}"; }

# True when the value can be written single-quoted (see Quoting above).
is_writable() {
  case "$1" in
    *$'\n'* | *$'\r'* | *"'"* | *\\*) return 1 ;;
  esac
  return 0
}

kind_of() {
  if [[ "$1" == secret ]]; then printf 'Secret'; else printf 'Variable'; fi
}

check() {
  local problems=0 entry name source need value provider
  provider="$(value_of LLM_PROVIDER)"
  if [[ -n "$provider" && "$LLM_PROVIDERS" != *" $provider "* ]]; then
    error "Variable LLM_PROVIDER must be one of:${LLM_PROVIDERS% } (AR-41)"
    problems=1
  fi
  for entry in "${ENTRIES[@]}"; do
    read -r name source _ need <<<"$entry"
    value="$(value_of "$name")"
    if [[ -z "$value" ]]; then
      if [[ "$need" == required || "$need" == "llm:$provider" ]]; then
        error "$(kind_of "$source") $name is not set in the deploy-production environment (ADR-004, DV-36)"
        problems=1
      fi
    elif ! is_writable "$value"; then
      error "$(kind_of "$source") $name holds a line break, a single quote or a backslash, which an env file cannot carry literally (ADR-004)"
      problems=1
    fi
  done
  return "$problems"
}

write_line() {
  printf "%s='%s'\n" "$2" "$3" >>"$1"
}

render() {
  local dir="$1" file entry name target value constant
  check || return 1
  umask 077
  rm -rf -- "$dir"
  mkdir -m 700 -- "$dir"
  for file in "${FILES[@]}"; do
    printf '# Rendered by deploy/render-env.sh from the deploy-production environment (ADR-004).\n# Do not edit: the next deploy replaces it.\n' >"$dir/$file.env"
  done
  for constant in "${FRONTEND_CONSTANTS[@]}"; do
    write_line "$dir/frontend.env" "${constant%%=*}" "${constant#*=}"
  done
  for constant in "${BACKEND_CONSTANTS[@]}"; do
    write_line "$dir/backend.env" "${constant%%=*}" "${constant#*=}"
  done
  for entry in "${ENTRIES[@]}"; do
    read -r name _ target _ <<<"$entry"
    value="$(value_of "$name")"
    if [[ -n "$value" ]]; then
      write_line "$dir/$target.env" "$name" "$value"
    fi
  done
  chmod 600 "$dir"/*.env
  printf 'Rendered %s into %s\n' "${FILES[*]/%/.env}" "$dir"
}

main() {
  case "${1:-}" in
    check)
      check
      echo "Every required runtime value is set"
      ;;
    render)
      if [[ -z "${2:-}" ]]; then
        error "Usage: render-env.sh render <dir>"
        return 1
      fi
      render "$2"
      ;;
    *)
      error "Usage: render-env.sh check | render <dir>"
      return 1
      ;;
  esac
}

main "$@"
