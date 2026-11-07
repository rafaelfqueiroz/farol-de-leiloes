# Deploy and rollback — production on the VPS

**Use when:** provisioning the production server for the first time, deploying a release by hand, or rolling back one that misbehaves.

**Governs:** DEVELOPMENT.md DV-33 (SHA-tagged images, rollback), DV-34 (migrations before new code), DV-35 (runtime secrets outside the repository), SECURITY.md SC-16 and SC-17, ARCHITECTURE.md AR-28 and AR-48, [ADR-002](../adr/002-hosting-and-environments.md). The files are in [`deploy/`](../../deploy/): `compose.production.yml`, `Caddyfile`, `setup-server.sh`.

## Known gaps

- **`deploy.yml` does not do this yet.** Its deploy job (SSH, pull, migrate, restart, health check, rollback) arrives later; until then every step below is manual, as the deploy user.
- **A short outage on each deploy.** There is one backend instance, stopped before its replacement starts, because the cron jobs have no lock and two instances could send a reminder twice. Caddy answers 503 with a maintenance message meanwhile.
- **Single server.** No redundancy: the host is a single point of failure against BR-003-01.
- Staging does not exist (#103); there is nothing to rehearse a deploy on.

## Do not

- **Do not lose the Caddy `/data` volume** (`caddy_data`). It holds the certificates and the ACME account; reissuing them can hit Let's Encrypt rate limits and leave the site without HTTPS. Never run `docker compose down -v` or `docker volume rm` on it.
- Do not start Caddy before the DNS records point at the server: the certificate challenge fails and repeated failures are rate limited.
- Do not run two backend instances, and do not use `docker compose up --scale backend=2`.
- Do not use a floating tag. `RELEASE_SHA` is always a full commit SHA that exists in GHCR (DV-33).
- Do not put a secret in `compose.production.yml`, the Caddyfile or a command line. Secrets live only in `/etc/farol/*.env` (SC-16).
- Do not run `npm run migrate` from a laptop once the server exists; the `migrate` service is the gated step (DV-34).
- Do not paste `/etc/farol/*.env` or container logs into an issue without checking them first (SC-15).

## Steps

### First provisioning (once)

1. **As root on the fresh Ubuntu LTS VPS, run the setup script** with two public keys, the owner's (for `admin`) and the deploy key (for `deploy`); the same key may be passed twice: `bash setup-server.sh "<admin public key>" "<deploy public key>"`. It installs Docker and Compose, creates `admin` (sudo, no password, key only) and `deploy` (docker group only, no sudo), closes SSH to passwords and root, enables the firewall (SSH, 80, 443/tcp and udp) and automatic updates, and creates `/etc/farol` and `/srv/farol`. **Before closing the root session**, open a second one as `admin` and confirm `sudo -v` works. The docker group is root-equivalent, so guard the deploy key (it will live in the `deploy-production` GitHub environment, DV-35).
2. **As `deploy`, copy the `deploy/` folder** to `/srv/farol`.
3. **As `admin`, with sudo, fill the env files** in `/etc/farol` (root:deploy, mode 640; `deploy` can only read them), by hand, e.g. `sudoedit /etc/farol/backend.env`:
   - `backend.env`: every variable of `backend/.env.example` (AR-41). Production values: `FRONTEND_URL=https://<site-domain>`; `GOOGLE_CALLBACK_URL=https://<api-domain>/api/auth/google/callback`, also registered with Google; `TRUST_PROXY_HOPS=1` (Caddy is one hop; without it every request looks like it comes from the proxy and throttling by origin, SC-04, breaks); `LOG_HASH_SECRET`; `SENTRY_DSN`; and the Atlas `MONGODB_URI` whose access list allows only this server's IP. `NODE_ENV=production` comes from the image. **Do not change the hop count on its own:** turning on Cloudflare's proxy also needs a Caddy change, see [Turn on Cloudflare's proxy](#turn-on-cloudflares-proxy).
   - `frontend.env`: `BACKEND_API_URL=http://backend:3000`, because the frontend's server code (SSR, API routes, sitemap) reaches the backend over the private network. `NEXT_PUBLIC_*` is inlined into the image at build time and is not set here.
   - `caddy.env`: `SITE_DOMAIN=<domain>` and `API_DOMAIN=api.<domain>`.
4. **Register the Stripe webhook** in the Stripe dashboard: endpoint `https://<api-domain>/api/payments/webhook`, and put its signing secret in `STRIPE_WEBHOOK_SECRET` in `backend.env`.
5. **Set the build variables, then build the images with them.** As a repository admin on GitHub, create the repository variables `NEXT_PUBLIC_AUCTIONS_API_URL` (`https://<api-domain>`, no trailing slash, no `/api`) and `NEXT_PUBLIC_SITE_URL` (`https://<domain>`). `deploy.yml` does not pass `NEXT_PUBLIC_SENTRY_DSN` today, so the browser has no Sentry until it does. Then rebuild by pushing to `main` or running `deploy.yml`, and **use that commit's SHA** for `RELEASE_SHA`. Images built before the variables exist have the wrong URLs baked in, and so does any rollback to an SHA from before this step.
6. **Point DNS at the server before Caddy starts.** In Cloudflare, DNS-only (grey cloud) A/AAAA records for `<domain>`, `www.<domain>` and `api.<domain>`. Check with `dig +short <domain>` that they answer with the server's address.
7. **As `deploy`, log in to GHCR** with a read-only token (`read:packages`, created for this purpose): `docker login ghcr.io -u <github-user>`. Enter the token at the prompt, never on the command line.
8. Continue with a deploy, below.

### Deploy a release

Run in `/srv/farol`, as `deploy` (use `admin` with sudo only for server administration, never for deploys). Set `export RELEASE_SHA=<full commit SHA>` first, and `alias dc='docker compose -f compose.production.yml'`.

1. **Note the running SHA** (`docker inspect` of the backend image tag, or the last deploy note), so there is something to roll back to.
2. **Pull:** `dc pull frontend backend` (the `migrate` service uses the backend image).
3. **Migrate (DV-34):** `dc --profile migrate run --rm migrate`. If it exits non-zero, **stop**: the running version is untouched; fix forward or abandon the release. Before a risky migration take a `mongodump` first ([backup-and-restore.md](backup-and-restore.md)).
4. **Replace the backend, one instance only:** `dc stop backend && dc up -d backend`. Then `dc up -d frontend caddy` (a no-op when unchanged).
5. **Check health (AR-48):** wait for the container to leave `starting` (`dc ps`), then `curl -s -o /dev/null -w '%{http_code}\n' https://<api-domain>/api/health`. 200 is `ok` or `degraded` (the API is serving, see [health-check.md](health-check.md)); 503 is `down`. Also open the site and a property page.
6. **Roll back if it fails** (below).

### Roll back (DV-33)

1. Set `RELEASE_SHA` to the previous SHA and repeat the deploy steps 2, 4 and 5. Skip step 3: migrations are forward-only and expand/contract (AR-28), so the previous code runs on the migrated database. A contract step that already removed the old shape cannot be rolled back this way; restore is then the only path ([backup-and-restore.md](backup-and-restore.md)).
2. Write down what failed and when, and open an issue.

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
