# Deploy and rollback — production on the VPS

**Use when:** provisioning the production server for the first time, turning on the deploy job, changing a production setting or secret, deploying a release by hand in an emergency, or rolling back one that misbehaves.

**Governs:** DEVELOPMENT.md DV-33 (SHA-tagged images, rollback), DV-34 (migrations before new code), DV-35 (deploy and runtime secrets in the `deploy-production` environment), DV-36, SECURITY.md SC-16 and SC-17, ARCHITECTURE.md AR-28 and AR-48, [ADR-002](../adr/002-hosting-and-environments.md), [ADR-004](../adr/004-production-configuration-from-github.md). The files are in [`deploy/`](../../deploy/): `compose.production.yml`, `Caddyfile`, `setup-server.sh`, `close-ssh-login.sh`, and `render-env.sh`, `release.sh` and `check-health.sh`, which the deploy job in [`deploy.yml`](../../.github/workflows/deploy.yml) uses.

## Known gaps

- **The deploy job is off until `DEPLOY_ENABLED` is set** ([Turn on the deploy job](#turn-on-the-deploy-job)). Nothing deploys until then: the env files exist only once a job has written them, so even the first deploy is a run of the job. The by-hand steps below are for emergencies and use the env files the last job wrote.
- **Configuration values are single-line,** without a single quote (`'`) or a backslash (`\`). The job writes them single-quoted, which Docker Compose reads literally, and refuses anything else, naming the variable ([ADR-004](../adr/004-production-configuration-from-github.md)).
- **GitHub holds every production secret,** and anyone who can change a workflow on `main` can read them (today only the owner, ADR-004). Secrets cannot be read back from GitHub; the only readable copy is on the server.
- **The job rolls back only what it deployed.** It can redeploy the previous SHA, not restore data: a failed contract migration still needs [backup-and-restore.md](backup-and-restore.md). There is no button to roll back to an older SHA either; do that by hand ([Roll back](#roll-back-dv-33)).
- **A short outage on each deploy.** There is one backend instance, stopped before its replacement starts, because the cron jobs have no lock and two instances could send a reminder twice. Caddy answers 503 with a maintenance message meanwhile.
- **Single server.** No redundancy: the host is a single point of failure against BR-003-01.
- Staging does not exist (#103); there is nothing to rehearse a deploy on.
- **No domain yet.** Until one is bought (ADR-002), production runs on the VPS's Hostinger hostname, see [Without a domain](#without-a-domain). Google sign-in stays in OAuth Testing mode (up to 100 test users), because publishing the consent screen needs a domain we own.
- **Free database tier.** Production uses the Atlas free cluster until Flex is needed, with no backups; see [backup-and-restore.md](backup-and-restore.md)'s known gaps. Take a `mongodump` before every migration until then, not only risky ones.

## Do not

- **Do not lose the Caddy `/data` volume** (`caddy_data`). It holds the certificates and the ACME account; reissuing them can hit Let's Encrypt rate limits and leave the site without HTTPS. Never run `docker compose down -v` or `docker volume rm` on it.
- Do not start Caddy before the DNS records point at the server: the certificate challenge fails and repeated failures are rate limited.
- Do not run two backend instances, and do not use `docker compose up --scale backend=2`.
- Do not use a floating tag. `RELEASE_SHA` is always a full commit SHA that exists in GHCR (DV-33).
- Do not add the server's host key with `ssh-keyscan` or `StrictHostKeyChecking=no`: that trusts whoever answers on the network. `DEPLOY_KNOWN_HOSTS` comes from the server's own key file ([Turn on the deploy job](#turn-on-the-deploy-job)).
- Do not edit `/srv/farol/.release`, `.released`, `.previous` or `.incoming` by hand, except as the steps below say: the deploy job reads them to know what to roll back to.
- **Do not edit `/srv/farol/env/*.env` on the server.** The next deploy replaces them and a rollback restores the previous set, so a hand edit is silently lost. Change the value in the `deploy-production` environment and redeploy ([Change a setting or a secret](#change-a-setting-or-a-secret)).
- Do not put a secret in `compose.production.yml`, the Caddyfile, a command line or an environment **variable** (variables are shown in logs and settings). Secrets live only in the `deploy-production` environment's secrets, and on the server in the files the job writes (SC-16, ADR-004).
- Do not run `npm run migrate` from a laptop once the server exists; the `migrate` service is the gated step (DV-34).
- Do not paste `/srv/farol/env/*.env` or container logs into an issue without checking them first (SC-15).

## Steps

### First provisioning (once)

1. **As root on the fresh Ubuntu LTS VPS, run the setup script** with two public keys, the owner's (for `admin`) and the deploy key (for `deploy`); the same key may be passed twice: `bash setup-server.sh "<admin public key>" "<deploy public key>"`. Copy `close-ssh-login.sh` to the server together with `setup-server.sh`. The script installs Docker and Compose, creates `admin` (sudo, no password, key only) and `deploy` (docker group only, no sudo), enables the firewall (SSH, 80, 443/tcp and udp) and automatic updates, and creates `/srv/farol` and `/srv/farol/env` (owned by `deploy`, mode 700), where each deploy writes the env files. **It does not close SSH:** root and password login stay open until you have proven that `admin` works. Open a second session with `ssh -i <admin key> admin@<server>` and confirm `sudo -n true` works. `sudo -v` fails here even though sudo works, because `admin` has no password and the stock `%sudo` rule also matches it. Then, from that `admin` session, run `sudo bash close-ssh-login.sh`, which closes SSH to passwords and root (it refuses to run if `admin` has no key or no sudoers file). Check that `admin` can still log in from another session. The docker group is root-equivalent, so guard the deploy key (it will live in the `deploy-production` GitHub environment, DV-35).
2. **Create the environment.** In the repository settings, Environments, create `deploy-production`, with deployment branches limited to **protected branches only** (`main`). The job also refuses any ref other than `main`. Everything below goes into this environment: environment secrets and environment variables, not repository ones (DV-35).
3. **Set the environment's secrets and variables** ([ADR-004](../adr/004-production-configuration-from-github.md)). The deploy job turns them into `caddy.env`, `frontend.env` (only `BACKEND_API_URL=http://backend:3000`, written by the job) and `backend.env` on every deploy; `NODE_ENV=production` comes from the image and `PORT=3000` is written by the job. Use the GitHub CLI as a repository admin, from your own machine:
   - **Secrets**, with `gh secret set NAME --env deploy-production`, which prompts for the value so it stays out of the shell history. Generate the two random ones in place: `openssl rand -base64 48 | gh secret set JWT_SECRET --env deploy-production` and `openssl rand -base64 48 | gh secret set LOG_HASH_SECRET --env deploy-production`.
     - Required: `MONGODB_URI` (the Atlas connection string, whose access list allows only this server's IP), `JWT_SECRET`, `LOG_HASH_SECRET`, `GOOGLE_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (step 4), `SMTP_PASS`, `SMS_PROVIDER_API_KEY`, `WHATSAPP_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
     - Required only for the selected `LLM_PROVIDER`: `GROQ_API_KEY` (groq), `GOOGLE_API_KEY` (gemini), `OPENAI_API_KEY` (openai) or `ANTHROPIC_API_KEY` (anthropic). Ollama needs none.
     - Optional: `SENTRY_DSN` (without it the backend has no Sentry and logs a warning at boot).
   - **Variables**, with `gh variable set NAME --env deploy-production --body '<value>'`.
     - Required: `SITE_DOMAIN` (`<domain>`, or `<vps-hostname>` such as `srvNNNNNNN.hstgr.cloud` until there is one, see [Without a domain](#without-a-domain)); `API_DOMAIN` (`api.<domain>` or `api.<vps-hostname>`); `FRONTEND_URL` (`https://<site-domain>`); `TRUST_PROXY_HOPS` = `1` (Caddy is one hop; without it every request looks like it comes from the proxy and throttling by origin, SC-04, breaks. **Do not change the hop count on its own:** turning on Cloudflare's proxy also needs a Caddy change, see [Turn on Cloudflare's proxy](#turn-on-cloudflares-proxy)); `GOOGLE_CLIENT_ID`; `GOOGLE_CALLBACK_URL` (`https://<api-domain>/api/auth/google/callback`, also registered with Google); `STRIPE_STANDARD_PRICE_ID`; `EMAIL_FROM`; `SMTP_HOST`; `SMTP_USER`; `CLOUDFLARE_ACCOUNT_ID`; `R2_BUCKET`; `R2_PUBLIC_URL`.
     - Optional, unset means the default documented in `backend/.env.example`: `SMTP_PORT`, `SMTP_SECURE`, `LLM_PROVIDER`, `OLLAMA_MODEL`, `OLLAMA_BASE_URL`, `GROQ_MODEL`, `GEMINI_MODEL`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `IMPORT_ENABLED`, `IMPORT_ON_START_UP`, `SCRAPER_ENABLED`, `SCRAPER_ON_START_UP`, `REMINDERS_ENABLED`, `CLEANUP_ON_STARTUP`, `NEIGHBORHOODS_CACHE_ENABLED`, `NEIGHBORHOODS_CACHE_TTL`, `SAVED_FILTERS_MAX_PER_USER` (saved filters per user, default 10), `UNAVAILABLE_AUCTION_RETENTION_DAYS` (days an unavailable auction is kept before the cleanup job removes it, default 14), `LOG_LEVEL`.
   - Check what is set with `gh secret list --env deploy-production` and `gh variable list --env deploy-production`. `preflight` lists any required name still missing, never a value.
4. **Register the Stripe webhook** in the Stripe dashboard: endpoint `https://<api-domain>/api/payments/webhook`, and store its signing secret with `gh secret set STRIPE_WEBHOOK_SECRET --env deploy-production`.
5. **Set the build variables.** As a repository admin on GitHub, create the **repository** variables `NEXT_PUBLIC_AUCTIONS_API_URL` (`https://<api-domain>`, no trailing slash, no `/api`) and `NEXT_PUBLIC_SITE_URL` (`https://<domain>`). Optionally `NEXT_PUBLIC_SENTRY_DSN` (public by nature); without it the browser has no Sentry. Set them before the first deploy run, which builds the images with them. Images built before the variables exist have the wrong URLs baked in, and so does any rollback to an SHA from before this step.
6. **Point DNS at the server before Caddy starts.** In Cloudflare, DNS-only (grey cloud) A/AAAA records for `<domain>`, `www.<domain>` and `api.<domain>`. Check with `dig +short <domain>` that they answer with the server's address. Without a domain there is nothing to create: check that `<vps-hostname>` and `api.<vps-hostname>` already answer with it.
7. **As `deploy`, log in to GHCR** with a read-only token (`read:packages`, created for this purpose): `docker login ghcr.io -u <github-user>`. Enter the token at the prompt, never on the command line.
8. **[Turn on the deploy job](#turn-on-the-deploy-job) and run the first deploy through it.** No deploy by hand is needed: on a fresh server, `release.sh` finds no previous SHA and deploys from scratch.

### Deploy a release

**By hand only in an emergency** (the job cannot run, or GitHub is down): the job is the normal path. These steps use the compose file, Caddyfile and env files that the last job run left in `/srv/farol`; they cannot change a setting, which only a job run delivers. Run in `/srv/farol`, as `deploy` (use `admin` with sudo only for server administration, never for deploys). Set `export RELEASE_SHA=<full commit SHA>` first, and `alias dc='docker compose -f compose.production.yml'`.

1. **Note the running SHA** (`docker inspect` of the backend image tag, or `cat .release`), so there is something to roll back to.
2. **Pull:** `dc pull frontend backend` (the `migrate` service uses the backend image).
3. **Migrate (DV-34):** `dc --profile migrate run --rm migrate`. If it exits non-zero, **stop**: the running version is untouched; fix forward or abandon the release. Before a risky migration take a `mongodump` first ([backup-and-restore.md](backup-and-restore.md)).
4. **Replace the backend, one instance only:** `dc stop backend && dc up -d backend`. Then `dc up -d frontend caddy` (a no-op when unchanged).
5. **Check health (AR-48):** wait for the container to leave `starting` (`dc ps`), then `curl -s -o /dev/null -w '%{http_code}\n' https://<api-domain>/api/health`. 200 is `ok` or `degraded` (the API is serving, see [health-check.md](health-check.md)); 503 is `down`. Also open the site and a property page.
6. **Record the release** once it is healthy, so the deploy job knows what runs: `echo "$RELEASE_SHA" > .release`.
7. **Roll back if it fails** (below).

### The deploy job (`deploy.yml`)

Once [turned on](#turn-on-the-deploy-job), every push to `main` deploys itself after the images are published, and a `workflow_dispatch` run on `main` deploys on demand. `preflight` first checks that every deploy secret and every required runtime value is set (DV-36). The `deploy` job runs in the `deploy-production` environment, connects over SSH as `deploy` with the pinned host key, and runs the steps above through [`deploy/release.sh`](../../deploy/release.sh), which it sends over SSH on each run (the server never runs a stored copy):

1. **Render the env files on the runner** from the environment's secrets and variables ([`deploy/render-env.sh`](../../deploy/render-env.sh)), into a directory only the runner user can read, deleted at the end of the job.
2. **Record the running SHA:** the backend container's image tag while it is healthy, else `/srv/farol/.release` (the last successful release).
3. **Copy this commit's `compose.production.yml` and `Caddyfile`, and the env files,** over SSH, to `/srv/farol` (the env files to `/srv/farol/env`, mode 600), keeping the running release's copies, env files included, in `/srv/farol/.previous/`. They are installed before the migration, which reads them too.
4. **Pull, then migrate (DV-34).** A failed pull or migration stops the job with the running version untouched and the previous files, env files included, put back; nothing is rolled back because nothing changed.
5. **Replace the backend (one instance), recreate any container whose env file changed (Caddy included: a reload does not re-read its environment), start frontend and Caddy, reload Caddy's configuration,** and wait up to 5 minutes for the backend's Docker health check. Once it is healthy, the SHA is written to `/srv/farol/.release` and the files to `/srv/farol/.released/`.
6. **Health check from the runner (AR-48):** `GET <NEXT_PUBLIC_AUCTIONS_API_URL>/api/health` and the site must answer 200, retried for about 2 minutes ([`deploy/check-health.sh`](../../deploy/check-health.sh)).
7. **Roll back on failure after step 5** (or a dropped connection during it): the job restores the previous files and env files, redeploys the previous SHA without migrations (AR-28), checks health again, and **fails** with an error naming both SHAs. On the first deploy there is no previous SHA: the job fails and the site may be down; fix the cause and run the job again.

Runs never overlap: a run waits for the one in progress, and a newer push replaces a run that is still waiting. After a failed run, write down what failed and open an issue, as for a manual rollback. To redeploy a SHA, re-run its `deploy.yml` run (a re-run reads the environment's current secrets and variables); to deploy an older SHA on purpose, follow [Roll back](#roll-back-dv-33) by hand.

### Change a setting or a secret

1. Change it in the `deploy-production` environment: `gh secret set NAME --env deploy-production` or `gh variable set NAME --env deploy-production --body '<value>'` (first provisioning step 3). This is also how a secret is rotated; revoke the old value at its provider once the new one is live.
2. Redeploy: re-run the latest successful `deploy.yml` run, or run the workflow on `main` (`gh workflow run deploy.yml --ref main`). Only the containers whose env file changed are recreated; the backend is restarted by every deploy anyway.
3. A rollback restores the env files of the release it goes back to. After a rollback that crosses a change, redeploy once the cause is fixed so the change is live again.

A **new variable** in `backend/.env.example` also needs a line in `deploy/render-env.sh` and in the `runtime-config` mapping of `deploy.yml`, in the same PR (the structural test fails until both exist), and its value set here before that PR is merged if it is required.

### Turn on the deploy job

After first provisioning steps 1 to 7. All of it is done by the owner: agents never handle the private key.

1. **Check the environment** `deploy-production` exists with deployment branches limited to protected branches (first provisioning step 2), and holds the runtime secrets and variables (step 3).
2. **Add its three deploy secrets** (environment secrets, not repository secrets, DV-35):
   - `DEPLOY_HOST`: the server's host name alone, e.g. `<vps-hostname>`; no user, no port. The job connects as `deploy` on port 22.
   - `DEPLOY_SSH_KEY`: the private key matching the deploy public key given to `setup-server.sh`, in OpenSSH format, without a passphrase. Use a key made only for this, never your own.
   - `DEPLOY_KNOWN_HOSTS`: the server's host key as a known_hosts line for exactly the name in `DEPLOY_HOST`. Read it from the server itself, in a session as `admin` that you already trust, never with `ssh-keyscan` over the network: `printf '%s %s\n' "<vps-hostname>" "$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"`. Compare its fingerprint (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) with the one your own SSH client recorded.
3. **Check the repository variables** `NEXT_PUBLIC_AUCTIONS_API_URL` (`https://api.<host>`, no trailing slash, no `/api`) and `NEXT_PUBLIC_SITE_URL` (first provisioning step 5). `NEXT_PUBLIC_SENTRY_DSN` is optional; without it the browser has no Sentry.
4. **Set the repository variable `DEPLOY_ENABLED` to `true`.** From then on `preflight` fails loudly if a secret or a required variable is missing (DV-36). Unset it to stop deploying.
5. **Run the first deploy:** in Actions, Deploy, Run workflow on `main`, or `gh workflow run deploy.yml --ref main`. Watch it to the end, and check the site and a property page.
6. **On a server provisioned before [ADR-004](../adr/004-production-configuration-from-github.md),** which still has the hand-filled `/etc/farol/*.env`: once that run has succeeded, remove them as `admin`: `sudo rm /etc/farol/*.env && sudo rmdir /etc/farol`. Until then a rollback may put back a compose file that reads them.

### Roll back (DV-33)

1. Set `RELEASE_SHA` to the previous SHA, put back that release's `compose.production.yml` and `Caddyfile` if they changed (the deploy job keeps them in `.previous/`; otherwise check them out at that SHA), and its env files from `.previous/env/` if they changed (`install -m 600 .previous/env/<name>.env env/`), and repeat the deploy steps 2, 4, 5 and 6. If the Caddyfile changed, also run `dc exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`; if `caddy.env` changed, run `dc up -d --force-recreate caddy` instead. Skip step 3: migrations are forward-only and expand/contract (AR-28), so the previous code runs on the migrated database. A contract step that already removed the old shape cannot be rolled back this way; restore is then the only path ([backup-and-restore.md](backup-and-restore.md)).
2. Write down what failed and when, and open an issue.

### Without a domain

Hostinger gives each VPS a hostname of the form `srvNNNNNNN.hstgr.cloud` (shown in hPanel and by `hostname -f` on the server), and every subdomain of it resolves to the same server. Use it as `<vps-hostname>` until a domain is bought:

- **Certificates work unchanged.** Caddy gets Let's Encrypt certificates for `<vps-hostname>`, `www.<vps-hostname>` and `api.<vps-hostname>`. `hstgr.cloud` is on the Public Suffix List, so Let's Encrypt's rate limits count against this hostname alone, not all of Hostinger. Do not use `sslip.io` or `nip.io` instead: they are not on the list, so their limits are shared by every user.
- **The address is Hostinger's, not ours.** It belongs to this VPS, and a rebuilt or replaced server may get a different one. Do not publish it or announce it; search engines may index it.
- **Google sign-in** stays in OAuth Testing mode, with test users added by hand in the Google Cloud console.

### Move to the domain

When the domain is bought, in this order. People are signed out once, because their session cookies belong to the old address.

1. **DNS:** create the Cloudflare records from first provisioning step 6, and wait until `dig +short` answers with the server's address.
2. **Google:** add `https://api.<domain>/api/auth/google/callback` to the OAuth client's redirect URIs (keep the old one until the move is done), and verify the domain if the consent screen is to be published.
3. **Stripe:** add a webhook endpoint for `https://api.<domain>/api/payments/webhook`, and note its new signing secret.
4. **Build variables:** set the repository variables `NEXT_PUBLIC_AUCTIONS_API_URL` and `NEXT_PUBLIC_SITE_URL` to the new addresses (first provisioning step 5).
5. **Update the GitHub values** in the `deploy-production` environment: the variables `SITE_DOMAIN`, `API_DOMAIN`, `FRONTEND_URL` and `GOOGLE_CALLBACK_URL`, and the secret `STRIPE_WEBHOOK_SECRET` (first provisioning step 3).
6. **Deploy:** run `deploy.yml` on `main` (`gh workflow run deploy.yml --ref main`). It rebuilds the images with the new build variables, delivers the new env files and recreates Caddy, which reads the new names and gets their certificates. The job checks health on the new addresses; check `https://api.<domain>/api/health` yourself too.
7. **Clean up:** remove the old Stripe endpoint and the old Google redirect URI. Optionally, redirect `<vps-hostname>` to the domain in the Caddyfile, through a reviewed change.

### Turn on Cloudflare's proxy

The default is DNS-only (ADR-002). Behind the proxy (orange cloud), Cloudflare is one more hop. Caddy [ignores incoming `X-Forwarded-For` from an untrusted peer](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults), so `TRUST_PROXY_HOPS=2` alone makes the backend see Cloudflare's edge address, and per-origin limits (SC-04) then treat many users as one. Do these in order, while the records are still DNS-only:

1. **Update the subprocessor table and the privacy policy** (SC-30): Cloudflare would then see the site's traffic.
2. **Trust Cloudflare's ranges in Caddy, and only those.** Copy the current [IPv4](https://www.cloudflare.com/ips-v4/) and [IPv6](https://www.cloudflare.com/ips-v6/) lists into a global block at the top of the `Caddyfile`, through a reviewed change:

   ```caddyfile
   {
   	servers {
   		trusted_proxies static <every Cloudflare IPv4 and IPv6 range>
   	}
   }
   ```

   Never use `private_ranges` or a wider range here: any peer listed can forge the client address. Then, as `deploy`, run `dc up -d --force-recreate caddy`.
3. **Set the variable `TRUST_PROXY_HOPS` to `2`** (`gh variable set TRUST_PROXY_HOPS --env deploy-production --body 2`), then redeploy ([Change a setting or a secret](#change-a-setting-or-a-secret)). Caddy then forwards `<client>, <Cloudflare edge>`, and two trusted hops make `req.ip` the client. A direct request still resolves to its real address, because Caddy discards the header it sent.
4. **Turn on the proxy** in Cloudflare.
5. **Keep the ranges current.** Cloudflare's lists change, and requests from a missing range are treated as untrusted, so those users share the edge address. Check the lists when reviewing this runbook.

No endpoint reports the client address today, so this cannot be confirmed from outside. Check it with SC-04's limits once they exist.
