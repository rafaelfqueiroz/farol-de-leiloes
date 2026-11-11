# Deploy and rollback — production on the VPS

**Use when:** provisioning the production server for the first time, turning on the deploy job, deploying a release by hand, or rolling back one that misbehaves.

**Governs:** DEVELOPMENT.md DV-33 (SHA-tagged images, rollback), DV-34 (migrations before new code), DV-35 (runtime secrets outside the repository), SECURITY.md SC-16 and SC-17, ARCHITECTURE.md AR-28 and AR-48, [ADR-002](../adr/002-hosting-and-environments.md). The files are in [`deploy/`](../../deploy/): `compose.production.yml`, `Caddyfile`, `setup-server.sh`, `close-ssh-login.sh`, and `release.sh` and `check-health.sh`, which the deploy job in [`deploy.yml`](../../.github/workflows/deploy.yml) uses.

## Known gaps

- **The deploy job is off until `DEPLOY_ENABLED` is set** ([Turn on the deploy job](#turn-on-the-deploy-job)). Until then, and for the first deploy, every step is manual, as the deploy user.
- **The job rolls back only what it deployed.** It can redeploy the previous SHA, not restore data: a failed contract migration still needs [backup-and-restore.md](backup-and-restore.md). There is no button to roll back to an older SHA either; do that by hand ([Roll back](#roll-back-dv-33)).
- **A short outage on each deploy.** There is one backend instance, stopped before its replacement starts, because the cron jobs have no lock and two instances could send a reminder twice. Caddy answers 503 with a maintenance message meanwhile.
- **Single server.** No redundancy: the host is a single point of failure against BR-003-01.
- Staging does not exist (#103); there is nothing to rehearse a deploy on.
- **No domain yet.** Until one is bought (ADR-002), production runs on the VPS's Hostinger hostname, see [Without a domain](#without-a-domain). Google sign-in stays in OAuth Testing mode (up to 100 test users), because publishing the consent screen needs a domain we own.

## Do not

- **Do not lose the Caddy `/data` volume** (`caddy_data`). It holds the certificates and the ACME account; reissuing them can hit Let's Encrypt rate limits and leave the site without HTTPS. Never run `docker compose down -v` or `docker volume rm` on it.
- Do not start Caddy before the DNS records point at the server: the certificate challenge fails and repeated failures are rate limited.
- Do not run two backend instances, and do not use `docker compose up --scale backend=2`.
- Do not use a floating tag. `RELEASE_SHA` is always a full commit SHA that exists in GHCR (DV-33).
- Do not add the server's host key with `ssh-keyscan` or `StrictHostKeyChecking=no`: that trusts whoever answers on the network. `DEPLOY_KNOWN_HOSTS` comes from the server's own key file ([Turn on the deploy job](#turn-on-the-deploy-job)).
- Do not edit `/srv/farol/.release`, `.released`, `.previous` or `.incoming` by hand, except as the steps below say: the deploy job reads them to know what to roll back to.
- Do not put a secret in `compose.production.yml`, the Caddyfile or a command line. Secrets live only in `/etc/farol/*.env` (SC-16).
- Do not run `npm run migrate` from a laptop once the server exists; the `migrate` service is the gated step (DV-34).
- Do not paste `/etc/farol/*.env` or container logs into an issue without checking them first (SC-15).

## Steps

### First provisioning (once)

1. **As root on the fresh Ubuntu LTS VPS, run the setup script** with two public keys, the owner's (for `admin`) and the deploy key (for `deploy`); the same key may be passed twice: `bash setup-server.sh "<admin public key>" "<deploy public key>"`. Copy `close-ssh-login.sh` to the server together with `setup-server.sh`. The script installs Docker and Compose, creates `admin` (sudo, no password, key only) and `deploy` (docker group only, no sudo), enables the firewall (SSH, 80, 443/tcp and udp) and automatic updates, and creates `/etc/farol` and `/srv/farol`. **It does not close SSH:** root and password login stay open until you have proven that `admin` works. Open a second session with `ssh -i <admin key> admin@<server>` and confirm `sudo -n true` works. `sudo -v` fails here even though sudo works, because `admin` has no password and the stock `%sudo` rule also matches it. Then, from that `admin` session, run `sudo bash close-ssh-login.sh`, which closes SSH to passwords and root (it refuses to run if `admin` has no key or no sudoers file). Check that `admin` can still log in from another session. The docker group is root-equivalent, so guard the deploy key (it will live in the `deploy-production` GitHub environment, DV-35).
2. **As `deploy`, copy the `deploy/` folder** to `/srv/farol`.
3. **As `admin`, with sudo, fill the env files** in `/etc/farol` (root:deploy, mode 640; `deploy` can only read them), by hand, e.g. `sudoedit /etc/farol/backend.env`:
   - `backend.env`: every variable of `backend/.env.example` (AR-41). Production values: `FRONTEND_URL=https://<site-domain>`; `GOOGLE_CALLBACK_URL=https://<api-domain>/api/auth/google/callback`, also registered with Google; `TRUST_PROXY_HOPS=1` (Caddy is one hop; without it every request looks like it comes from the proxy and throttling by origin, SC-04, breaks); `LOG_HASH_SECRET`; `SENTRY_DSN`; and the Atlas `MONGODB_URI` whose access list allows only this server's IP. `NODE_ENV=production` comes from the image. **Do not change the hop count on its own:** turning on Cloudflare's proxy also needs a Caddy change, see [Turn on Cloudflare's proxy](#turn-on-cloudflares-proxy).
   - `frontend.env`: `BACKEND_API_URL=http://backend:3000`, because the frontend's server code (SSR, API routes, sitemap) reaches the backend over the private network. `NEXT_PUBLIC_*` is inlined into the image at build time and is not set here.
   - `caddy.env`: `SITE_DOMAIN=<domain>` and `API_DOMAIN=api.<domain>`. Without a domain, use the VPS's hostname instead: `SITE_DOMAIN=<vps-hostname>` and `API_DOMAIN=api.<vps-hostname>`, see [Without a domain](#without-a-domain).
4. **Register the Stripe webhook** in the Stripe dashboard: endpoint `https://<api-domain>/api/payments/webhook`, and put its signing secret in `STRIPE_WEBHOOK_SECRET` in `backend.env`.
5. **Set the build variables, then build the images with them.** As a repository admin on GitHub, create the repository variables `NEXT_PUBLIC_AUCTIONS_API_URL` (`https://<api-domain>`, no trailing slash, no `/api`) and `NEXT_PUBLIC_SITE_URL` (`https://<domain>`). Optionally `NEXT_PUBLIC_SENTRY_DSN` (public by nature); without it the browser has no Sentry. Then rebuild by pushing to `main` or running `deploy.yml`, and **use that commit's SHA** for `RELEASE_SHA`. Images built before the variables exist have the wrong URLs baked in, and so does any rollback to an SHA from before this step.
6. **Point DNS at the server before Caddy starts.** In Cloudflare, DNS-only (grey cloud) A/AAAA records for `<domain>`, `www.<domain>` and `api.<domain>`. Check with `dig +short <domain>` that they answer with the server's address. Without a domain there is nothing to create: check that `<vps-hostname>` and `api.<vps-hostname>` already answer with it.
7. **As `deploy`, log in to GHCR** with a read-only token (`read:packages`, created for this purpose): `docker login ghcr.io -u <github-user>`. Enter the token at the prompt, never on the command line.
8. Continue with a deploy, below. **The first deploy is manual**, even once the job exists: check each step by eye on a fresh server. Then [turn on the deploy job](#turn-on-the-deploy-job).

### Deploy a release

Run in `/srv/farol`, as `deploy` (use `admin` with sudo only for server administration, never for deploys). Set `export RELEASE_SHA=<full commit SHA>` first, and `alias dc='docker compose -f compose.production.yml'`.

1. **Note the running SHA** (`docker inspect` of the backend image tag, or `cat .release`), so there is something to roll back to.
2. **Pull:** `dc pull frontend backend` (the `migrate` service uses the backend image).
3. **Migrate (DV-34):** `dc --profile migrate run --rm migrate`. If it exits non-zero, **stop**: the running version is untouched; fix forward or abandon the release. Before a risky migration take a `mongodump` first ([backup-and-restore.md](backup-and-restore.md)).
4. **Replace the backend, one instance only:** `dc stop backend && dc up -d backend`. Then `dc up -d frontend caddy` (a no-op when unchanged).
5. **Check health (AR-48):** wait for the container to leave `starting` (`dc ps`), then `curl -s -o /dev/null -w '%{http_code}\n' https://<api-domain>/api/health`. 200 is `ok` or `degraded` (the API is serving, see [health-check.md](health-check.md)); 503 is `down`. Also open the site and a property page.
6. **Record the release** once it is healthy, so the deploy job knows what runs: `echo "$RELEASE_SHA" > .release`.
7. **Roll back if it fails** (below).

### The deploy job (`deploy.yml`)

Once [turned on](#turn-on-the-deploy-job), every push to `main` deploys itself after the images are published. The `deploy` job runs in the `deploy-production` environment, connects over SSH as `deploy` with the pinned host key, and runs the steps above through [`deploy/release.sh`](../../deploy/release.sh), which it sends over SSH on each run (the server never runs a stored copy):

1. **Record the running SHA:** the backend container's image tag while it is healthy, else `/srv/farol/.release` (the last successful release).
2. **Copy this commit's `compose.production.yml` and `Caddyfile`** to `/srv/farol`, keeping the running release's copies in `/srv/farol/.previous/`.
3. **Pull, then migrate (DV-34).** A failed pull or migration stops the job with the running version untouched and the previous files put back; nothing is rolled back because nothing changed.
4. **Replace the backend (one instance), start frontend and Caddy, reload Caddy's configuration,** and wait up to 5 minutes for the backend's Docker health check. Once it is healthy, the SHA is written to `/srv/farol/.release` and the files to `/srv/farol/.released/`.
5. **Health check from the runner (AR-48):** `GET <NEXT_PUBLIC_AUCTIONS_API_URL>/api/health` and the site must answer 200, retried for about 2 minutes ([`deploy/check-health.sh`](../../deploy/check-health.sh)).
6. **Roll back on failure after step 4** (or a dropped connection during it): the job restores the previous files, redeploys the previous SHA without migrations (AR-28), checks health again, and **fails** with an error naming both SHAs. On the first deploy there is no previous SHA: the job fails and the site may be down; fix it by hand.

Runs never overlap: a run waits for the one in progress, and a newer push replaces a run that is still waiting. After a failed run, write down what failed and open an issue, as for a manual rollback. To redeploy a SHA, re-run its `deploy.yml` run; to deploy an older SHA on purpose, follow [Roll back](#roll-back-dv-33) by hand.

### Turn on the deploy job

After the first manual deploy is healthy. All of it is done by the owner: agents never handle the private key.

1. **Create the environment.** In the repository settings, Environments, create `deploy-production`, with deployment branches limited to **protected branches only** (`main`). The job also refuses any ref other than `main`.
2. **Add its three secrets** (environment secrets, not repository secrets, DV-35):
   - `DEPLOY_HOST`: the server's host name alone, e.g. `<vps-hostname>`; no user, no port. The job connects as `deploy` on port 22.
   - `DEPLOY_SSH_KEY`: the private key matching the deploy public key given to `setup-server.sh`, in OpenSSH format, without a passphrase. Use a key made only for this, never your own.
   - `DEPLOY_KNOWN_HOSTS`: the server's host key as a known_hosts line for exactly the name in `DEPLOY_HOST`. Read it from the server itself, in a session as `admin` that you already trust, never with `ssh-keyscan` over the network: `printf '%s %s\n' "<vps-hostname>" "$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"`. Compare its fingerprint (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) with the one your own SSH client recorded.
3. **Check the repository variables** `NEXT_PUBLIC_AUCTIONS_API_URL` (`https://api.<host>`, no trailing slash, no `/api`) and `NEXT_PUBLIC_SITE_URL` (first provisioning step 5). `NEXT_PUBLIC_SENTRY_DSN` is optional; without it the browser has no Sentry.
4. **Set the repository variable `DEPLOY_ENABLED` to `true`.** From then on `preflight` fails loudly if a secret or variable is missing (DV-36). Unset it to stop deploying.
5. **Watch the first automatic run** to the end, and check the site and a property page.

### Roll back (DV-33)

1. Set `RELEASE_SHA` to the previous SHA, put back that release's `compose.production.yml` and `Caddyfile` if they changed (the deploy job keeps them in `.previous/`; otherwise check them out at that SHA), and repeat the deploy steps 2, 4, 5 and 6. If the Caddyfile changed, also run `dc exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`. Skip step 3: migrations are forward-only and expand/contract (AR-28), so the previous code runs on the migrated database. A contract step that already removed the old shape cannot be rolled back this way; restore is then the only path ([backup-and-restore.md](backup-and-restore.md)).
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
4. **Build variables:** set `NEXT_PUBLIC_AUCTIONS_API_URL` and `NEXT_PUBLIC_SITE_URL` to the new addresses, then rebuild by pushing to `main` or running `deploy.yml`, and use that commit's SHA (first provisioning step 5).
5. **As `admin`, update the env files:** `caddy.env` (`SITE_DOMAIN`, `API_DOMAIN`), and in `backend.env` `FRONTEND_URL`, `GOOGLE_CALLBACK_URL` and `STRIPE_WEBHOOK_SECRET`.
6. **As `deploy`, deploy that SHA** ([Deploy a release](#deploy-a-release)), then `dc up -d --force-recreate caddy` so Caddy reads the new names and gets their certificates. Check health on `https://api.<domain>/api/health`.
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
3. **As `admin`, set `TRUST_PROXY_HOPS=2`** in `backend.env`, then, as `deploy`, run `dc stop backend && dc up -d backend`. Caddy then forwards `<client>, <Cloudflare edge>`, and two trusted hops make `req.ip` the client. A direct request still resolves to its real address, because Caddy discards the header it sent.
4. **Turn on the proxy** in Cloudflare.
5. **Keep the ranges current.** Cloudflare's lists change, and requests from a missing range are treated as untrusted, so those users share the edge address. Check the lists when reviewing this runbook.

No endpoint reports the client address today, so this cannot be confirmed from outside. Check it with SC-04's limits once they exist.
