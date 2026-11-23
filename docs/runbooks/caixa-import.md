# Caixa import — how Caixa is reached, the holiday calendar, the manual live test

**Use when:** the Caixa list did not arrive or the import says it was blocked, Caixa has to be reached another way, the holiday calendar needs its yearly edit, or the owner wants to try Caixa by hand.

**Governs:** SPEC-004 (BR-004-18, BR-004-20, BR-004-31), ARCHITECTURE AR-10 (the `CaixaAccess` port), SECURITY SC-24, [ADR-003](../adr/003-reaching-caixa-from-the-vps.md) (Proposed).

## Known gaps

- **Only the list goes through the port today.** The daily list download (`CaixaAccess.downloadList()`) does. The detail-page scraper (puppeteer) and the storage copies of photos and matrículas still reach Caixa on their own; they move behind the port with SPEC-004 part 3. A block seen by them is not yet recorded as a block.
- **The run does not yet decide `no new list` or `no update`.** Part 1 has the pieces (the list validator, the business calendar); the Import Run that uses them is part 2. Until then, a blocked or failed download is a `FAILED` row of `auctions-import` in `jobexecutions` with the error class as its code (`CaixaBlockedError`, `CaixaUnreachableError`).
- **The cleanup job's filter is wrong under `sanitizeFilter`, and is left as is on purpose.** `AuctionCleanupService` builds its `$or` the way `verifyAvailability` used to (a wrapper around the array, bare operators inside), so under the production setting it throws a CastError instead of running. Fixing it would make a deletion run that contradicts SPEC-004 (BR-004-17: the import never deletes a property), so it waits for the owner's answer on #120. Do not "fix" the filter on its own.
- **How production reaches Caixa is not decided.** Azion blocked the Hostinger VPS in the tests of ADR-003. Until #108 decides, the import stays off in production (`IMPORT_ENABLED` false in `deploy-production`).

## How Caixa is reached

Every request to `venda-imoveis.caixa.gov.br` goes through one port, `CaixaAccess` (`backend/src/auctions/caixa/caixa-access.ts`): `downloadList()`, `fetchDetailPage(url)` and `fetchFile(url)`. Its default adapter, `HttpCaixaAccess`, uses Node's `fetch` and does the same things for each:

- it sends the product's own user agent, `FarolDosLeiloes/1.0` (SC-24); nothing impersonates a browser;
- it gives up after `CAIXA_REQUEST_TIMEOUT_MS` (default 30000, at most 120000) and refuses a response over `CAIXA_MAX_DOWNLOAD_BYTES` (default 20 MiB, at most 100 MiB; the list is about 8 MB);
- it decodes the list as Windows-1252 unless the response names another charset;
- it only talks to Caixa's own site: a URL from Caixa's data that points elsewhere is refused before any request is made;
- it **stops on a block** and never retries, never switches address, never answers a challenge (BR-004-20).

Tests never reach Caixa: they use `FakeCaixaAccess` (`backend/test/fakes/`) or a server on the loopback interface.

### The proxy setting

`CAIXA_PROXY_URL` (optional, a `deploy-production` **secret** because it may carry credentials) sends Caixa traffic through one `http://` or `https://` proxy. Unset, the backend connects directly. It is a transport setting, not rotation: one proxy, always the same. Rules:

- **SOCKS is refused at boot** (`socks5://...` stops the API with a clear error). A SOCKS endpoint, such as Cloudflare WARP in proxy mode, needs a small bridge to an HTTP proxy first; that choice belongs to #108 and ADR-003, which is still Proposed.
- **It is not a way past a block.** Do not add it, or change it, because Caixa blocked a request: changing the address Caixa sees after a refusal is evasion (SC-24). It is set only after ADR-003 / #108 is accepted. The backend logs a warning at boot whenever it is set (never the URL).
- If the proxy is down, the request fails (`CaixaUnreachableError`). It never falls back to a direct connection.
- The value is never printed: the boot error and the logs name the variable, not its content (SC-16).

Changing the transport later (a bridge, another host) changes the adapter and its settings, not the code that uses the port.

### What a block means

`CaixaBlockedError` is raised for HTTP 401, 403, 407, 429 and 451, the Radware or ShieldSquare challenge page (also when it stands in place of the list or a file, and when it comes with a 5xx status: the adapter reads at most 64 KiB of a 5xx body to tell), and a redirect away from Caixa's site. Its `reason` is one of `HTTP_401`, `HTTP_403`, `HTTP_407`, `HTTP_429`, `HTTP_451`, `CHALLENGE_PAGE`, `REDIRECT_OFF_SITE`. A 407 from the proxy itself reaches the adapter as a failed connection (`CaixaUnreachableError`, `NETWORK`), because Node's `fetch` turns it into a network error before any status is seen: a proxy that answers 407 is a proxy to fix, not a retry. It means: **stop for today**.

1. Do not run the import again to "see if it passes": a second request is what Radware counts (ADR-003: a handful of list downloads per address per day).
2. Do not add a different user agent, a rotating proxy, a CAPTCHA service or a stealth plugin. They are banned by SC-24 and a structural test fails on them.
3. Wait for the next scheduled run, and check [health-check.md](health-check.md) for the age of the data.
4. If blocks repeat on several days, the owner decides on transport in #108; that is a decision, not a code fix.

`CaixaUnreachableError` is different: a network failure, a timeout, a 5xx or another status (`status` says which; a 404 on a file is how "Caixa has no such file" arrives), a response over the size cap. It affects only what was being fetched.

## The holiday calendar

`NATIONAL_HOLIDAYS` is a comma-separated list of Brasília days, `YYYY-MM-DD`, for example `2026-12-25,2027-01-01,2027-02-16,2027-02-17`. A business day (BR-004-31) is a day that is not Saturday, not Sunday and not in the list; the calendar is configuration, never fetched from the internet at run time.

**Edit it once a year**, before the year starts, for the whole year:

1. List the national holidays of the coming year (the federal list, plus any other day on which Caixa is known to publish no list, which the product should treat as one).
2. In GitHub, set the `deploy-production` environment variable: `gh variable set NATIONAL_HOLIDAYS --env deploy-production --body "2027-01-01,2027-02-15,..."` (keep the old year's entries or drop them; both work).
3. Deploy (or re-run the deploy workflow): the value is read when the backend boots, so it takes effect after the restart.
4. An invalid entry (`2027-02-30`, `25/12/2027`) stops the boot and the error names the position of the entry, never its text. Fix the list and deploy again.

**If the calendar has no entry for the current year**, the backend logs one warning per year per process (`NATIONAL_HOLIDAYS has no entries for 2027: only weekends count as non-business days`) and treats only weekends as non-business days. Nothing breaks, but a holiday with no list would then count as a failed business day and alert the admins (BR-004-03, BR-004-29), so do not ignore the warning.

An empty variable and an unset one are the same: no holidays.

## Related settings

| Variable                   | Default  | What it does                                                                                                                     |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `CAIXA_PROXY_URL`          | unset    | The optional http(s) proxy, above.                                                                                               |
| `CAIXA_REQUEST_TIMEOUT_MS` | 30000    | One request, connection to last byte; at most 120000.                                                                            |
| `CAIXA_MAX_DOWNLOAD_BYTES` | 20971520 | The largest response accepted. At most 104857600 (100 MiB).                                                                      |
| `NATIONAL_HOLIDAYS`        | empty    | The holiday calendar, above.                                                                                                     |
| `IMPORT_MIN_ROW_RATIO`     | 0.8      | A new list with fewer rows than this share of the last applied list is rejected as truncated (BR-004-04). Above 0 and at most 1. |

All are in `backend/.env.example` and, for production, the `deploy-production` environment (`deploy/render-env.sh`). `IMPORT_ENABLED` and `SCRAPER_ENABLED` stay `false` there until the transport is decided.

## The manual live test (the owner runs it; nothing automates it)

No test, job or script of this repository calls Caixa on its own: the suites use fixtures and fakes (TS-07), and agents never contact Caixa. To learn whether Caixa answers from a given host, the owner runs one request by hand, once, on that day:

1. Log in to the host to test (the VPS, or a laptop for comparison). If a proxy is part of the test (only once ADR-003 / #108 allows it), put it in a curl config file with mode 600, never on the command line, where `ps` and the shell history would show its credentials: `install -m 600 /dev/null ~/.caixa-curl.conf`, then write `proxy = "http://user:password@host:port"` into it, typed at the editor's prompt, not pasted into a command. Check it with `curl -q -K ~/.caixa-curl.conf -I https://example.com` first, so a broken proxy is not mistaken for a block, and delete the file after the test.
2. Request the list **once**, with the product's own user agent and no other header tricks (add `-K ~/.caixa-curl.conf` before the URL only when the proxy is part of the test):
   ```
   curl -sS -o /tmp/list.csv -w '%{http_code} %{size_download}\n' \
     -A 'FarolDosLeiloes/1.0' \
     https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_geral.csv
   ```
3. Read the result. `200` and about 8 MB means Caixa served the list: `head -c 300 /tmp/list.csv | iconv -f WINDOWS-1252 -t UTF-8` should show `Lista de Imóveis da Caixa` and `Data de geração`. `403`, `429`, or an HTML body naming Radware or ShieldSquare means a block: stop, write the result in #108 with the date, the host and the status, and do not retry that day.
4. Delete the file when done. It holds only public listing data, but there is no reason to keep it.
5. Record what happened (date, host, proxy yes or no, status) on #108; the pacing experiments of ADR-003 are run the same way, one per day, stopping on the first challenge.

To test the backend's own adapter rather than `curl`, do it from the VPS once with `IMPORT_ENABLED=true` and `IMPORT_ON_START_UP=true` for a single boot, then set them back; the run is recorded in `jobexecutions` and `GET /api/health` shows it. That is the owner's call, on a day when no other Caixa request was made.

## Do not

- Do not call Caixa from tests, from CI or from an agent's session.
- Do not set `CAIXA_PROXY_URL` to a rotating pool, or change the user agent: both are what SC-24 forbids.
- Do not raise `CAIXA_MAX_DOWNLOAD_BYTES` to make a failing download "work": a response far over 8 MB is not the list.
