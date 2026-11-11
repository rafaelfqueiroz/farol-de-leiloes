# ADR-003 — Reaching Caixa from the production VPS

**Status:** Proposed
**Date:** 2026-11-11
**Related:** SPEC-004 (BR-004-18, BR-004-20, DL-004-11, D-50), SC-24, SC-30, CLAUDE.md rule 5, [ADR-002](002-hosting-and-environments.md), #108, #4, #40

> **Warning.** The proposed decision conflicts with SC-24, CLAUDE.md rule 5 and D-50 as they are written today: it routes Caixa traffic through a shared VPN and runs a browser that Radware does not flag as automated. Accepting this ADR means changing those rules in the same PR, and it should wait for legal advice (see Consequences).

## Context

ADR-002 puts the backend on a Hostinger VPS in Brazil. The importer and scraper need three things from `venda-imoveis.caixa.gov.br`: the daily national list (`Lista_imoveis_geral.csv`), each property's detail page, and its files (matrícula, photo, edital). Tests from 2026-11-07 to 2026-11-11 found two separate barriers in front of that site.

**Azion's edge firewall blocks the VPS outright.** Every path, including the home page, returns HTTP 403 with Azion's default error page on the first request. The site has no IPv6 record. The VPS belongs to Hostinger's network (AS47583) and geolocates to Campinas, Brazil, so this is a rule against Hostinger's network or this range, not against Brazil.

**Radware Bot Manager challenges automated clients, everywhere.** It sits behind Azion, so it is the same whatever network the request comes from.

| Request | Home connection | Google Cloud Shell | VPS direct | VPS through Cloudflare WARP |
|---|---|---|---|---|
| List, `curl` | 200, then CAPTCHA after about 8 downloads in a day | 200, then CAPTCHA after about 4 | 403 (Azion) | 200, 8 MB in 1.5–9.6 s |
| Detail page, `curl` | CAPTCHA on the first request | CAPTCHA (address already flagged) | 403 | not tried |
| Detail page, headless Chromium | CAPTCHA on the first request | — | 403 | CAPTCHA on the first request |
| Detail page, visible Chromium (Xvfb) | 200 (a normal browser, by hand) | — | — | **200**, then **30 of 30** at one page a minute |
| Detail page, headless + stealth plugin | — | — | — | **200** (one request) |
| Matrícula PDF and photo, `curl` | — | no challenge (path 404) | — | **200**, real files, 4 requests 5 s apart |

Three more facts shape the design:

- **Files do not need the detail page.** The matrícula is at `/editais/matricula/{UF}/{code}.pdf` and the photo at `/fotos/F{code}21.jpg`, both built from the list. Only the edital (`/editais/{auction code}.PDF`) needs the detail page, to learn the auction code.
- **Editais are shared.** In the pacing test, 20 auction properties used 11 editais. Detail pages are needed for new auctions and for new or changed properties, not for every property every day.
- **Radware is two controls.** Detail pages are challenged by client fingerprint (headless Chromium on the first request), while the list is challenged by frequency (a handful of downloads per address per day).

## Options

The ⚠ mark means the option conflicts with SC-24, CLAUDE.md rule 5 or D-50 as written, and sits in a legal gray area that needs a lawyer's view: Brazilian Penal Code art. 154-A as amended by Lei 14.155/2021, and Caixa's terms of use.

1. **Honest only, as SC-24 reads today.** Headless Chromium with an honest identity, a daily budget, and stop on the first challenge. Radware challenges headless Chromium on the first detail page, so this collects **no detail pages**, and Azion still blocks the VPS for everything. It forecloses the product's detail data, and needs a host Caixa serves just to get the list.
2. **Move the Caixa jobs to another host** (Google Cloud and others). It solves Azion, because Google Cloud was served, but not Radware, which challenged Google Cloud the same way. It adds a second platform to run and pay for, and gains nothing on detail pages.
3. ⚠ **Cloudflare WARP on the VPS for Caixa traffic only, with visible Chromium for detail pages and `curl` for the list and files** (proposed). WARP runs in proxy mode, a local SOCKS5 port, so only requests that opt in leave through Cloudflare; the site, SSH and Atlas keep the VPS's own address. Visible Chromium runs on an Xvfb display and sends its real user agent, with nothing patched. It worked for the list, the files and 31 detail pages, at no cost.
4. ⚠ **Visible Chromium without WARP.** It would remove the shared VPN from the design. It cannot run from the VPS as long as Azion blocks Hostinger, so it depends on a new IPv4 from Hostinger that Azion serves, or on a host Caixa serves. Not tested (see Experiments).
5. ⚠ **Headless Chromium with `puppeteer-extra-plugin-stealth`.** It passed one detail page through WARP. It patches the headless traces, which makes it a further step from "undisguised" than option 3. The plugin's last release was in 2023, so it may break with future Chromium versions. **Kept as the fallback** if visible Chromium starts being challenged.
6. ⚠⚠ **CAPTCHA-solving services, or scraping services that solve them** (2Captcha, ZenRows, ScraperAPI, Bright Data Web Unlocker). They would work, but solving a "prove you are not a robot" check is the clearest case of getting around a security control, and the weakest legal ground. **Rejected.**
7. ⚠ **Rotating residential or mobile proxies.** These spread requests over many home addresses, which is exactly what Radware's frequency control exists to stop. Paid per GB, and the provider's consent model matters. **Rejected** while options 3 and 5 work.
8. **Buying the data** (Apify "Caixa leilões" scrapers, from about US$30/month). The provider collects the data, but its origin is the same and the product would depend on a third party for its core data. **Not chosen.**

## Decision

**Proposed: option 3, with option 5 as the fallback, under these guardrails.**

- **Egress.** Cloudflare WARP, installed on the host in proxy mode (`warp-cli mode proxy` before `connect`, so SSH is never routed through it). Only requests to `venda-imoveis.caixa.gov.br` use it. The backend container reaches the proxy over a dedicated path chosen in implementation, a host-network sidecar or a `socat` bridge, never by moving the whole backend to host networking. If WARP is down, the run stops; it never falls back to the VPS's own address.
- **List and files.** `curl` or Node `fetch` with the honest `FarolDosLeiloes/1.0` user agent, through WARP. The list once per Brasília day. The spoofed `Mozilla/5.0` in `downloader.ts` is removed (#4).
- **Detail pages.** One reused, visible Chromium on Xvfb, with the backend image gaining `xvfb` and keeping `init: true`. It sends its real user agent; no user agent override, no fingerprint patching. Detail pages only for new auctions (to learn the edital code) and new or changed properties, in #4's priority order.
- **Pace and budget.** One page at a time, at a **fixed** interval, with no randomised timing. Start at **one page per 60 seconds** and a daily budget well below what the pacing test sustained, then move only as the Experiments below show. Configured through #4's `ENRICHMENT_DAILY_PAGES` and `ENRICHMENT_MIN_PAUSE_MS`.
- **On a challenge.** Stop the whole run on the first Radware page, record `blocked: true` and alert the admin (#4), and resume at the next scheduled run. Never retry harder, never switch address, never solve a CAPTCHA.
- **Fallback.** If visible Chromium is challenged on several consecutive days at a pace that used to pass, switch to option 5 through a reviewed change, and record it here.

### Experiments before Accepted

Tracked in #108. Each runs from the VPS with the test image (`farol-radware-test`) and the pacing script, one experiment per day, stopping on the first challenge. The owner runs them; results are added to the Context table.

1. **Visible Chromium without WARP.** Only possible once Azion serves the VPS directly, for example after Hostinger assigns an IPv4 from another range. It shows whether WARP is needed at all once Azion lets the VPS in. If Azion keeps blocking Hostinger, run the same 30-page test from a host Azion serves, to learn whether visible Chromium passes Radware on its own merit.
2. **Faster pace.** 30 pages at one per 30 seconds, then 30 at one per 15 seconds, on separate days, followed by a 2-hour run at the pace chosen for production. It finds the real threshold and sets `ENRICHMENT_MIN_PAUSE_MS` with a margin.
3. **Stealth plugin under load.** The 30-page pacing test with `MODE=stealth`, so the fallback is known to work before it is needed.

Also: a week of daily runs at the production budget, to see whether Radware's tolerance changes from day to day.

## Consequences

- **Easy:** the product can collect detail data and files from the existing VPS, at no extra cost, and the Hostinger choice in ADR-002 stands.
- **Easy:** most detail data comes without a browser. Matrículas and photos come from paths built from the list, and one detail page per auction serves all of its properties' editais.
- **Hard:** **legal exposure.** Getting past Azion's address block through WARP, and past Radware's headless check with a visible browser, may be read as accessing a system against its owner's tacit wishes. A Brazilian lawyer should confirm before this is Accepted. Caixa may also escalate its blocking or send a notice.
- **Hard:** **fragility.** Radware and Azion can change their rules at any time. WARP's addresses are shared with other users, whose traffic counts toward the same limits. Collection may stop without warning, which #4's alerts must make visible.
- **Hard:** **WARP's terms.** The free client is meant for personal devices. Cloudflare One (Zero Trust, free up to 50 users) offers the same client under business terms, and should be used instead.
- **Hard:** **resources.** A visible Chromium uses more memory than a headless one, inside the backend's 3,584 MB limit.
- **Hard:** **personal data.** Matrículas name the owners, so storing them in R2 stays under SC-25 and LGPD, as before.
- **Forecloses:** while this stands, nobody may add CAPTCHA solving, rotating proxies or user agent spoofing without a new ADR.

### Changes when Accepted

In the same PR that marks this Accepted:

- **SC-24 (SECURITY.md):** allow WARP egress and visible Chromium within these guardrails; keep the bans on CAPTCHA solving, proxy rotation and user agent spoofing.
- **CLAUDE.md rule 5:** match the new SC-24.
- **SPEC-004 D-50 and DL-004-11 (wiki):** a new Decision Log entry superseding the "honest request identity, no workaround" wording for detail pages.
- **SECURITY.md subprocessors (SC-30):** Cloudflare WARP carries the requests to Caixa. Those requests hold only public listing data, no personal data.
- **ADR-002:** a note that Caixa traffic leaves through WARP, linking here.
- **#4:** the enrichment design takes the guardrails above.
