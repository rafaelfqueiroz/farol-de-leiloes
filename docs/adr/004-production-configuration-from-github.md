# ADR-004 — Production configuration from the GitHub environment

**Status:** Accepted (2026-11-13), owner decision
**Date:** 2026-11-13
**Related:** Supersedes the runtime-secrets paragraph of [ADR-002](002-hosting-and-environments.md) (Deploy). DV-35, DV-36, SC-15, SC-16, AR-41, AR-44, #40 (BL-001)

## Context

ADR-002 kept deploy secrets in the `deploy-production` GitHub environment and said: "A VPS has no secret store, so runtime secrets live in per-environment files outside the repository, readable only by the deploy user." The files were `/etc/farol/{caddy,frontend,backend}.env`, filled by hand by `admin` with `sudoedit`, and `compose.production.yml` read them.

Building the deploy job (#111) showed what this costs:

- **Two places to change one thing.** A new variable needs a code change and a manual edit on the server, in the right order, or the next deploy boots a backend that refuses its environment (AR-41).
- **No history and no review.** Nobody can tell which values the server holds, when they changed, or whether a rollback put back the configuration it ran with.
- **A rebuilt server needs a restore.** ADR-002 says a dead server can be rebuilt without losing data, but its configuration lived only on that server.
- **A by-hand first deploy.** The job could not deploy to a server whose files were still empty, so the first deploy had to be manual.

## Options

1. **Files on the host, edited by hand** (ADR-002, as built). No new place holds the secrets, but every point above stays.
2. **The GitHub `deploy-production` environment** (chosen). Secret values become environment secrets and the rest environment variables. The deploy job renders the env files on the runner and copies them to the server on every deploy. Nothing new to run or pay for, and the deploy secrets already live there (DV-35). GitHub becomes the holder of every production secret.
3. **A secret manager** (Doppler, Infisical, or SOPS with age keys in the repository). Audit logs, versioning and rotation tooling, but one more service, or one more key to guard, for a single server and one environment. SOPS would put encrypted secrets in the repository, so a leaked age key exposes their whole history.

## Decision

Option 2. Production runtime configuration comes from the GitHub `deploy-production` environment: **environment secrets** for secret values, **environment variables** for the rest.

- `deploy/render-env.sh` lists every value, its kind (secret or variable), its file and whether production requires it. `deploy.yml` maps each name explicitly from `secrets` or `vars` into the two steps that run the script, and no other step sees them. `preflight` checks that every required value is set (DV-36); the `deploy` job renders `caddy.env`, `frontend.env` and `backend.env` into a runner directory of mode 700, copies them over SSH (never on a command line) and deletes them at the end of the job.
- On the server, `deploy/release.sh` installs them in `/srv/farol/env` (directory 700, files 600, owned by `deploy`) together with `compose.production.yml` and the Caddyfile, **before** the migration, which reads them too. The previous set is kept in `/srv/farol/.previous` and restored when the migration fails and on rollback, exactly like the compose file. A container whose env file changed is recreated.
- Nobody edits env files on the server. `/etc/farol` is retired; on a server provisioned before this decision, `admin` removes its files once the first job-delivered deploy has succeeded.
- Constants of the compose topology are not configuration: `PORT=3000` and `BACKEND_API_URL=http://backend:3000` are written by the script, and `NODE_ENV` comes from the image.
- The first deploy runs through the job too, as a `workflow_dispatch` run on `main` with `DEPLOY_ENABLED` set. The by-hand procedure stays for emergencies and uses the files the last job wrote.

## Consequences

- **GitHub holds every production secret.** Anyone who can change a workflow that runs on `main` in the `deploy-production` environment can read them, which today is only the owner (ruleset bypass, DV-27; the environment allows protected branches only). Adding a collaborator with write access, or loosening the ruleset, widens that set and needs this ADR revisited.
- **Rotation** is changing the secret or variable in GitHub and redeploying (re-running the latest `deploy.yml` run is enough). A rollback restores the configuration the previous release ran with, so a rotation must be redeployed after any rollback that crosses it.
- **A rebuilt server needs nothing restored:** `setup-server.sh`, then a deploy.
- **Each new variable must be added to the mapping** in `render-env.sh` and `deploy.yml`, and set in the environment. The structural test `backend/test/structural/deploy-config.spec.ts` fails until the first two are done, and `preflight` fails until a required one is set.
- **Values must be single-line,** without a single quote or a backslash: they are written single-quoted, which Docker Compose reads literally, and the script rejects anything else, naming the variable and never its value. A multi-line value (a PEM key, say) would need encoding first.
- **GitHub masks secret values in logs, but variables are not masked.** Nothing that could be secret may become a variable; the structural test keeps secret-looking names in secrets (SC-16).
- **Forecloses** reading production values back from GitHub: secrets are write-only there. The copy on the server is the only readable one, and SC-15 still applies to it.
