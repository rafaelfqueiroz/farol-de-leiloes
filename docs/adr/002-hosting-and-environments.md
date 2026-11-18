# ADR-002 — Hosting, environments and backups

**Status:** Accepted (2026-11-11); runtime secrets superseded by [ADR-004](004-production-configuration-from-github.md)
**Date:** 2026-11-06
**Related:** SPEC-003 BR-003-01, BR-003-02, BR-003-04, DV-33–DV-36, AR-04, AR-28, AR-48, SC-16, SC-30, SC-32, ADR-001, #40 (BL-001), #103

## Context

The first stack (Vercel free, MongoDB Atlas free in São Paulo, Railway at $5) was chosen to develop and validate the application as cheaply as possible. A client is now going to validate the application, which makes a staging environment a requirement and brings BL-001's trigger, "before the first external user", forward. Cost is still a constraint.

What the application needs from a host:

- **Always on.** The import, scraper and reminder jobs run on `@Cron` inside the API process, so scale-to-zero does not work.
- **Room for Chromium.** The scraper runs up to 3 Chromium processes at once inside the backend container.
- **No persistent application disk.** Files live in Cloudflare R2.
- **Nothing tied to one vendor.** The backend uses no Atlas Search, vector search or transactions. The frontend uses no Vercel-only feature and already builds as a standalone image.

The repository had no concept of staging: `NODE_ENV` is the only environment switch, both Dockerfiles set it to `production`, the jobs default to on, and the frontend's API URL is inlined at build time.

## Options

Monthly cost for production plus staging, checked on 2026-11-06. USD services are converted at about R$ 5,53 (PTAX of R$ 5,34 on 2026-10-28 plus 3.5% IOF). The Railway and Fly.io usage figures are estimates, and the Fly.io São Paulo rate and the Vultr prices come from third parties.

| Stack | Now | After the promotion | What breaks or does not fit |
|---|---|---|---|
| A. Vercel Pro + Railway Pro + Atlas Flex | R$ 265–415 | same | Railway has no Brazil region, so personal data is processed in the US and every query crosses from Virginia to São Paulo. Both platforms publish outside the migration gate (DV-34). |
| B. Hostinger KVM 4 with self-hosted MongoDB | ~R$ 65 | ~R$ 155 | One disk holds the application, the database and possibly the backups. Hostinger's own backups are weekly, so dumps, restores, patching and monitoring of MongoDB become ours. |
| **C. Hostinger KVM 2 + Atlas Flex** | **R$ 87–209** | **R$ 122–244** | Single server for the applications, with no contractual uptime on the database tier. |
| D. Fly.io São Paulo + Atlas Flex | R$ 277–498 | same | Lowest operating effort that stays in Brazil, at roughly three times the cost of C. |
| E. Vultr São Paulo + Atlas Flex | R$ 210–498 | same | Same shape as C with no prepayment, at a much higher price for the same memory. |

Also ruled out:

- **Vercel Hobby:** its terms allow only non-commercial use, which excludes this product.
- **Oracle Always Free:** the allowance was reportedly cut to 2 OCPU and 12 GB, idle instances can be reclaimed, and São Paulo was not confirmed.
- **Hetzner:** no Brazil location was found.
- **Atlas M10:** $0.12/hour, about R$ 485/month. It is the next step up, not the starting point (see Consequences).
- **Coolify and Dokploy:** they add 0.35–1.2 GB of idle memory and an administration panel with access to the Docker socket, for a job Compose and `deploy.yml` already do.

## Decision

Stack C. Prices are in Brazilian reais from Hostinger's Brazilian site.

### Application host

Hostinger **KVM 2** (2 vCPU, 8 GB RAM, 100 GB NVMe) in the **Brazil** data center, on the 24-month term: R$ 1.031,76 upfront (R$ 42,99/month), renewing at R$ 77,99/month. Production and staging share this server.

It runs plain **Docker Compose** with **Caddy** as the reverse proxy for TLS, with no administration panel. Estimated peak memory is 4–5 GB: production backend with Chromium 2–3 GB, two frontends about 0.6 GB, staging backend about 0.5 GB, Caddy and the operating system about 0.5 GB. This estimate is not measured, so a real scrape runs inside the 30-day refund window.

Minimum hardening:

- SSH by key only, and a firewall that allows only SSH, 80 and 443.
- Automatic security updates.
- Only Caddy publishes ports.
- Every container has a memory limit, so staging cannot starve production.

### Domain and DNS

Leaving Vercel also leaves its free `*.vercel.app` address and its nameservers. Production needs its own domain, about R$ 40/year (a third-party figure, not confirmed on Registro.br), which adds about R$ 3/month to every VPS option above. **Cloudflare DNS** hosts the records at no cost, in DNS-only mode, because Cloudflare is already a subprocessor for R2 and its proxy would see the site's traffic. Caddy obtains and renews the certificates from Let's Encrypt.

### Database

MongoDB **Atlas Flex** for production, in São Paulo (`sa-east-1`), by upgrading the existing free cluster. Low traffic is expected in the first months, and Flex keeps the database and its backups off the single server. Staging uses a **free cluster in a separate Atlas project**, with its own credentials, so staging configuration cannot reach production data. The Atlas access lists allow only the server's IP address.

### Backups

- **Policy:** Flex's fixed policy of **8 daily snapshots**. It cannot be customised and has no on-demand snapshots or point-in-time restore, so up to 24 hours of data can be lost.
- **Before a risky migration:** run a `mongodump` to a private R2 bucket, since a snapshot cannot be requested. Forward-only, expand/contract migrations (AR-28, AR-29) already limit this risk.
- **Restore drill:** before the first external user, then quarterly, under a new runbook.
- **Staging:** no backups, because it holds no real data.

### Staging

**On hold** until the client is in the loop (#103). The client gets a first look on production first and is asked not to enter real personal data. If real data is expected, the Flex upgrade, the restore drill, the privacy policy update and sign-in throttling (SC-04) must come first. When staging starts, it follows this design:

- **Data:** no real personal data (SC-32). The client validates with fake data. Auctions are public data and are copied from production, so Caixa is not scraped twice (SC-24).
- **Jobs:** `IMPORT_ENABLED`, `SCRAPER_ENABLED` and `REMINDERS_ENABLED` are set explicitly, off by default (AR-04).
- **Accounts:** Stripe test keys, and its own webhook secret, R2 bucket, Google OAuth callback and email configuration.
- **Frontend:** its own image build, because `NEXT_PUBLIC_*` is inlined at build time.
- **Search engines:** blocked from indexing staging.
- **Errors:** Sentry events must carry the real environment name, not `NODE_ENV`.

### Deploy

`deploy.yml` keeps building SHA-tagged images in GitHub Actions, so nothing is built on the server. After `preflight`, it connects over SSH and, in this order:

1. Pulls the new images.
2. Runs `npm run migrate` as a one-off container (DV-34). A failure stops the deploy and leaves the running version untouched.
3. Stops the old backend and starts the new one.
4. Checks `GET /api/health` (AR-48).
5. On failure, redeploys the previous SHA (DV-33).

There is **one backend instance**, stopped before its replacement starts. No lock was found on the cron jobs, so two overlapping instances could send a reminder twice. Each deploy therefore costs a short outage, which counts against BR-003-01.

Deploy secrets stay in the `deploy-production` GitHub environment (DV-35). A VPS has no secret store, so runtime secrets live in per-environment files outside the repository, readable only by the deploy user.

### Availability probe

- **Stage 1, for client validation:** UptimeRobot Free checks the search page, a property page and `/api/health` every 5 minutes and emails on failure. This is a **known gap against BR-003-02**: it is less frequent than the spec requires and does not sign in.
- **Stage 2, before the first paying user:** Checkly Starter API checks every minute, including sign-in, about R$ 160/month.

A browser check every minute meets BR-003-02 literally, but costs about R$ 600–1.575/month, more than the whole stack. BR-003-02 is not amended by this ADR; stage 2 closes most of the gap, using page requests and a login call instead of a real browser.

### Retiring the previous platforms

Production has been served from the Hostinger VPS since 2026-11-14. The Vercel and Railway integrations are removed after that cutover, which also ends Vercel's per-PR preview deployments (#116).

## Consequences

- **Easy:** one pipeline and one rollback path for both applications. The same backend image runs in staging and production. A dead server can be rebuilt without losing data.
- **Easy:** moving from Flex to a dedicated tier is a supported upgrade. Move to M10 when data approaches 4 GB, when paying customers cannot tolerate losing a day of data, or when slow queries need to be visible.
- **Hard:** the server is ours to patch and rebuild, so its setup must be scripted. It is a single point of failure against the 99.5% target of BR-003-01, and neither Flex nor this plan carries an uptime commitment.
- **Hard:** production and staging are separated by containers and credentials only, not by a machine. Chromium runs with `--no-sandbox` in a container that holds production secrets.
- **Hard:** Flex shows only connections, logical size, network and operations counters, with no logs, Performance Advisor or access history. Slow queries are found through application logs and Sentry, and the storage alert is set at 4 GB because Flex has no auto-expand.
- **Hard:** a 24-month prepayment and a location that cannot be changed after setup. Renewal almost doubles the monthly price.
- **Forecloses:** per-PR preview environments, unless they are added back another way, and a global CDN, unless one is put in front of the server later.

### Required before the first external user

- Align the test image and driver with Atlas: tests run on `mongo:7` and the driver is 5.9.2, while Flex runs 8.0 or newer and upgrades automatically. The compatibility table marks that driver as partial on 8.0 and untested on 9.0.
- Run `explain` on the sitemap (`getAllCodes`, an unbounded sort) and on deep listing pages, because Flex limits in-memory sorts to 32 MB with no disk fallback.
- Add a Stripe key-mode check, so a live key cannot run on staging.
- Update the privacy policy and take legal advice on LGPD art. 33. Hostinger and MongoDB are foreign companies, even with the data in Brazil (SC-30).

### Required before stage 2 of the probe

- Sign-in throttling (SC-04) needs a rule for the probe, whose roughly 1,440 logins a day would otherwise be blocked.
- A dedicated email-and-password probe account, and a property page that will not expire.
- The half-budget alert of BR-003-04 was not seen in these tools and may need its own job.

### Not verified when this was written

- The tax on Hostinger's final checkout total, and whether Brazil is selectable there.
- Whether KVM 2 can be upgraded to KVM 4 without a rebuild, and the conditions of the 30-day refund.
- Where Flex snapshots are stored, and Flex's price in `sa-east-1` beyond what the Atlas plan screen shows.
