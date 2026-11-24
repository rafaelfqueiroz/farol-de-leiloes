# Caixa import — how Caixa is reached, the detail collection, the holiday calendar, the manual live test

**Use when:** the Caixa list did not arrive or the import says it was blocked, Caixa has to be reached another way, the holiday calendar needs its yearly edit, or the owner wants to try Caixa by hand.

**Governs:** SPEC-004 (BR-004-01 to BR-004-04, BR-004-10, BR-004-18 to BR-004-22, BR-004-30, BR-004-20, BR-004-23, BR-004-24, BR-004-27 to BR-004-29, BR-004-31), ARCHITECTURE AR-10 (the `CaixaAccess` port), SECURITY SC-24, [ADR-003](../adr/003-reaching-caixa-from-the-vps.md) (Proposed).

## Known gaps

- **Everything goes through the port now.** The list, the detail pages, the photos and the documents all use `CaixaAccess` (SPEC-004 part 4); nothing in `src/` drives a browser any more, and the scraper cron is gone. Two leftovers wait for #108: the `puppeteer` dependency and the Chromium in `backend/Dockerfile` / `deploy/compose.production.yml` (`shm_size`) are no longer used by the code and are not removed here, because a browser-backed adapter may be #108's outcome.
- **One API instance only.** The rate gate (concurrency and pause), the one-tick-at-a-time guard and the one-pass-at-a-time mutex live in the process. The lease keeps two instances from working the same run, but each would pace itself: two instances ask Caixa twice as fast as `ENRICHMENT_MIN_PAUSE_MS` says. Running more than one API instance is **unsupported until a database-backed gate exists** (a follow-up, SC-24). A redirect Caixa answers on its own site is followed inside the port, so one gate slot is at most 4 requests (`MAX_REDIRECTS` 3 + 1).
- **The cleanup job (#120) contradicts BR-004-17 and the copies, and is untouched.** It is opt-in (`CLEANUP_ON_STARTUP`). If it were switched on it would delete the record of an unavailable property, leaving in R2 its `photos[]`, its older `documentVersions` and its superseded private matrículas (it removes only what the record still names as `image`, `matricula` and `edital`). The decision belongs with #120; do not switch it on meanwhile.
- **The property page loses its Matrícula button until a SPEC-005 follow-up.** `matriculaUrl` is null for a private copy (SC-18); `hasMatricula` says one exists and the link comes from `GET /api/auctions/:code/matricula-link`, which is **platform admins only** for now (an owner decision pending SPEC-005 / SPEC-024: who else may open a document that names people). The frontend was not changed in this part.
- **`IMPORT_ON_START_UP` now runs a real collection.** It forces one attempt at boot; the run that attempt completes also runs the detail pass (and the clock) when `SCRAPER_ENABLED` is on. Development only: never set it in production.
- **Optimisation not done:** the same edital file is downloaded once per property (editais are shared by several properties); the 30-day re-check repeats it. A cache by address is a future change. **`photoUrls`** is in every property response, lists included; trimming a list to its first photo is a SPEC-005 decision.
- **The collection is off in production.** `IMPORT_ENABLED` and `SCRAPER_ENABLED` stay `false` in `deploy-production` until the transport is decided; nothing below runs there yet.
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

## The day's run: window, attempts, cutoff, alerts (SPEC-004 part 3)

The import is a **tick-driven state machine**, not a daily job. The `AuctionsImporter` cron fires every five minutes in Brasília time (`@Cron` with `America/Sao_Paulo`), and each tick asks `ImportOrchestrator.tick()` what the day's Import Run needs. The decision is a pure function of the persisted run and the clock (`decideNextAction`, `backend/src/auctions/domain/import-schedule.ts`), so a restart, a second process or an overlapping tick cannot do the day's work twice. `IMPORT_ENABLED=false` makes every tick a no-op. `IMPORT_ON_START_UP=true` adds one forced attempt about five seconds after boot, even outside the window (development only, recorded as `MANUAL`).

### What a day looks like

| Brasília time (defaults) | What happens |
| --- | --- |
| before `IMPORT_WINDOW_START` (06:00) | nothing: no attempt, no run row |
| from the window start | the first tick creates the day's run (`brasiliaDate`, one per day) and makes attempt 1: it downloads the list (one request to Caixa), validates it and, if it is valid and new, applies it |
| every tick after | waits until `nextAttemptAt` (the attempt's minute plus `IMPORT_ATTEMPT_SPACING_MINUTES`, 30), then attempts again, at most `IMPORT_MAX_ATTEMPTS` (12) times: 06:00, 06:30, ... 11:30 |
| `IMPORT_CUTOFF` (12:00) | the first tick at or after the cutoff makes no attempt and **decides the day** (below). An attempt one millisecond before the cutoff is allowed; one at the cutoff is not |
| after a list is applied | in the same tick: the collection pass, its result stored on the run, then the daily update is completed once (`updateCompletedAt`) and `DailyUpdateCompleted` is emitted |

A run keeps the date it was created for: an applied run whose collection pass was cut short is still completed at 00:10 the next day under its own date, with its own cutoff. **A day nobody attempted** (the process was down all morning, or `IMPORT_ENABLED` was off) is decided at the first tick after the cutoff: on a **business day** the run is created and ends `FAILED` with the code `NO_ATTEMPT` (one alert, a failed health record, nothing is asked of Caixa after the cutoff); on a weekend or holiday nothing is recorded (`NO_UPDATE` needs Caixa to have been reached). **Switching `IMPORT_ENABLED` on after the cutoff on a business day therefore sends one `NO_ATTEMPT` alert: expected the first day, not a fault.** A day the process was down until after midnight is not recorded afterwards (only today and open runs are looked at); the health report shows it.

### How an attempt ends

| Caixa answered | Recorded | Next |
| --- | --- | --- |
| a valid list newer than the last applied one | `progress.applying`, then `SUCCESS` with the counts when applied | collection pass, then the update completes |
| the same or an older list (validator `not_new`) | nothing but `progress.listReached` | retry at the spacing; **not** a failure by itself |
| a list the validator refuses | `progress.rejection` (generation day and code), the code in `failureReasons` | the same file again changes nothing; a **newer** file later the same day is judged on its own and can still be applied |
| `CaixaUnreachableError` (network, timeout, 5xx...) | its reason (`TIMEOUT`, `NETWORK`, `HTTP_STATUS`...) in `failureReasons` | retry at the spacing until the attempts are used up |
| `CaixaBlockedError` | the block reason (`HTTP_403`, `CHALLENGE_PAGE`...) and `LIST_BLOCKED` | **the day ends at once** as `FAILED`; no more attempts that day (BR-004-20, SC-24) |
| the list is valid but applying it throws | `progress.applyFailed`, the error class and, at the end of the day, `APPLY_FAILED` | retry at the spacing with a fresh download (nothing is hidden: unavailability is marked last) |
| a list was being applied and the process died (a **resume**) | `APPLY_INTERRUPTED` in `failureReasons` and `applyFailed` until a list is applied | the next attempt, at the spacing, reads the **stored copy** of that list (never Caixa) and applies it; with no stored copy or one that is no longer valid it falls back to a normal search in the same attempt. A day that ends before a list was applied is `FAILED` `APPLY_FAILED` |
| anything else before a list was read (storage, cache) | the error class in `failureReasons` | counts as an attempt without an answer |

### How the day is decided

The run stays `RUNNING` until it is decided. It is decided at the **first tick where now is at or after the cutoff**, or earlier when nothing a later attempt could do would change the outcome: Caixa **blocked** us (at once), or the **attempts are used up** on a day that ends `FAILED` or `REJECTED_LIST` (so a day Caixa never answered ends at the 12th attempt, about 11:30, not at 12:00). A day that would end `NO_NEW_LIST` or `NO_UPDATE` is always decided at the cutoff ("by the daily cutoff", BR-004-03). The outcome, from the day's history, in this order:

1. a validated list that could not be applied: **`FAILED`** (`APPLY_FAILED`, with the error class);
2. a list was published and refused: **`REJECTED_LIST`** with the validator's code (also on a weekend: a list that exists and is unusable is no quiet day);
3. Caixa answered with a list that is not new: on a **business day** **`NO_NEW_LIST`** (a failure); on a **weekend or holiday** **`NO_UPDATE`** (not a failure, `nonBusinessReason` says `WEEKEND` or `HOLIDAY`);
4. Caixa never answered at all (every attempt unreachable or failed): **`FAILED`** (`LIST_UNREACHABLE`), **whatever the day**: a weekend is no excuse for silence.

"Answered" means at least one attempt of the day got a list from Caixa: one timeout among answers does not turn a quiet Sunday into a failure. A decided run (`FAILED`, `REJECTED_LIST`, `NO_NEW_LIST`, `NO_UPDATE`) changes no property data and does not move "last updated" (BR-004-10, BR-004-24). A valid new list on a weekend or holiday is applied like on any other day.

### Overlap and restarts: the lease

Whoever works a run holds its **lease**: `leaseOwner` and `leaseExpiresAt` on the `importruns` row, taken with one atomic conditional update (five minutes, renewed every ~100 s while it works, released at the end of the tick). A tick that cannot take it returns quietly. A killed process leaves a lease that expires; the next tick after that **resumes**: a run whose list was being applied (`progress.applying` still true) makes its next attempt, **obeying the spacing, the attempt cap and the cutoff like any attempt**, as a *resume*: it gives the half-applied state up (`applying` false, `applyFailed` true, code `APPLY_INTERRUPTED`), reads the **stored copy** of the list and, if that copy is still a valid new list, applies it again (idempotent, BR-004-07, DL-004-04). **A resume never goes to Caixa** (SC-24): with no stored copy (R2 not set up, nothing uploaded, unreadable) it falls back to a normal search in the same attempt, which is one request like any other; a stored copy that is rejected or not new ends the resume without applying. A day that is decided while a list is still half-applied ends `FAILED` `APPLY_FAILED`. An applied run without `updateCompletedAt` runs its collection pass again (the pass must be idempotent) and completes. Every write of the worker is fenced on the lease, and before a long step (the apply, the collection pass, completing the update) the worker checks it still holds the lease: a stalled worker that lost it stops quietly (`The lease ... was lost` in the log), the new holder carries on. **Never edit `leaseOwner` or clear a lease by hand** unless the process is known dead and the lease has not expired yet: wait for it (five minutes at most).

### "Daily update complete" (BR-004-23)

`updateCompletedAt` goes from null to a time with one atomic conditional update, so it happens exactly once per day even when several ticks race, and only then `DailyUpdateCompleted { importRunId, brasiliaDate }` is emitted in process (`DailyUpdateBus`). It is never emitted, and `updateCompletedAt` stays null, for a run that is not `SUCCESS` and for `NO_UPDATE`. The public `GET /api/auctions/last-update` answers the newest `updateCompletedAt` as `{ "finishedAt": ISO | null }`: it moves only when a daily update completes, never after a failed, rejected, no-new-list or no-update day. A fault of the collection pass is logged and reported, and the update still completes (the Radar and the digest do not wait on an enrichment fault).

### Alerts (BR-004-29)

One email per run to **every admin** (an account with the admin capability, a confirmed email and an active status), when the run **ends**:

| Alert | The run | What it says | What the operator does |
| --- | --- | --- | --- |
| Falhou, `LIST_BLOCKED` | `FAILED` | Caixa blocked the list request; the system did not insist | Do not rerun. Read the runbook section "What a block means"; if it repeats on several days the owner decides on transport in #108 |
| Falhou, `NO_ATTEMPT` | `FAILED` | nobody attempted the day by the cutoff (the process was down, or the import was off): expected once when the import is switched on after the cutoff | check the process and the logs; if it was a restart or a deploy, nothing else to do |
| Falhou, `LIST_UNREACHABLE` | `FAILED` | no attempt of the day got a list (network, timeout, a Caixa error) | check whether Caixa's site is up from a browser; the next day's window retries on its own |
| Falhou, `APPLY_FAILED` | `FAILED` | a valid new list could not be applied; the error class is in the codes (`SweepAbortedError`: the list would hide more than `1 - IMPORT_MIN_ROW_RATIO` of the catalogue) | nothing was hidden or changed beyond rows already written; look at the logs of the run (`Applying the list failed: <class>`) and in Sentry; a `SweepAbortedError` on a real market drop is the owner's decision (`IMPORT_MIN_ROW_RATIO`) |
| Lista rejeitada | `REJECTED_LIST` | the code says why (see the outcome table) | do not rerun; a layout change needs a parser change; a real drop below `IMPORT_MIN_ROW_RATIO` is the owner's decision |
| Sem lista nova em dia útil | `NO_NEW_LIST` | Caixa published nothing newer by the cutoff on a business day | if the day was in fact a holiday, add it to `NATIONAL_HOLIDAYS` (below) for next time; if business days keep ending here, Caixa stopped publishing: tell the owner |
| Coleta de detalhes bloqueada | `SUCCESS` with `blocked` | the list was applied, the detail collection stopped on a block | the update completed; collection resumes at the next run (part 4) |

A `NO_UPDATE` day never alerts. A pending alert is retried for the last two Brasília days only, so rows an earlier version left never email on the first deploy. The alert is about the **final** outcome of the run: a day that is `REJECTED_LIST` at 06:00 and `SUCCESS` at 09:00 (a newer valid list) never alerts, its `alertedAt` stays null and the rejection stays in `failureReasons` as history. Several failed attempts alert once. `alertedAt` is claimed with an atomic conditional update **before** sending, so concurrent ticks send once; if no email could be sent at all (no admin, or every send failed) the claim is released and the next tick (five minutes later) tries again; one admin's address failing never stops the others, and a failure to send never fails the run. If you see `alertedAt` set and nobody was told, the process died between the claim and the send: send the alert by hand and note it on the incident. The email names the Brasília date, the outcome and a pt-BR sentence chosen by reason code (`backend/src/auctions/domain/import-alert-text.ts`), plus the codes; it carries no list row, exception text or personal data (SC-15).

### Reading `importruns`

`GET /api/admin/import-runs` (admin only, newest first, paginated) answers the BR-004-27 fields; the same data is in `mongosh` (read only): `db.importruns.find().sort({ brasiliaDate: -1 }).limit(7)`. Fields: `brasiliaDate`, `outcome` (`RUNNING` while undecided), `attempts`, `startedAt`, `finishedAt`, `listGeneratedAt`, `listRows`, `counts`, `detailCollection`, `failureReasons` (codes), `nextAttemptAt`, `progress` (`listReached`, `applying`, `applyFailed`, `rejection`), `nonBusinessReason`, `alertedAt`, `updateCompletedAt`, `leaseOwner` and `leaseExpiresAt`. A `RUNNING` row with a future `leaseExpiresAt` is being worked; with `leaseOwner` null or an expired lease it is waiting for the next tick.

### Decisions to confirm with the owner

- **"Reachable" is any attempt that got a list.** A day with some answers and some timeouts is judged by the answers (`NO_NEW_LIST` or `NO_UPDATE`), not `FAILED`. BR-004-03 says "cannot be reached at all". Alternative: judge by the last attempt.
- **Rejected and unreachable days are decided when the attempts run out** (about 11:30), not at the cutoff, and **the same refused file is downloaded again on every attempt until then** (up to twelve requests a day; ADR-003 asks for "a handful"). Owner question: keep that, lower `IMPORT_MAX_ATTEMPTS` (it is now capped at 48, the spacing at least 5 minutes), or stop searching after a refusal until a newer generation day could appear (for example at the next day's window)?
- **A day nobody attempted** is `FAILED` `NO_ATTEMPT` with one alert on a business day, nothing on a weekend or holiday (decided; switching the import on after the cutoff alerts once).
- **A collection pass that throws still completes the update.** BR-004-23 says "completed or out of budget"; a fault is neither, and holding the Radar and the digest back for it seemed worse.
- **The alert is sent at the end of the run**, not at the first rejection or failure, so a rejection that a later list fixes never alerts. Alternative: alert at the first refusal and again never.
- **The email goes to every admin with a confirmed email.** There is no per-admin opt-out.

## Import Runs and change entries: how to read them (SPEC-004 part 2 and 3)

Every day the import runs has one row in `importruns` (unique `brasiliaDate`, `YYYY-MM-DD`), with the outcome, `listGeneratedAt` (the day Caixa generated the list), `listRows`, `attempts`, `counts` and `failureReasons` (codes only, never a row or a message). The admin endpoint is described above; the admin page waits for the owner's design frame (DS-30).

| Outcome | What it means | What happened to the properties | What to do |
| --- | --- | --- | --- |
| `SUCCESS` | The list was applied. `counts` says how many properties are new, changed (a list field differs, or came back), no longer on the list (unavailable) and active after the run. `updateCompletedAt` is set when the collection pass ended too. | Updated. | Nothing. |
| `REJECTED_LIST` | A list was downloaded and refused, and `failureReasons` says why: `UNRECOGNISED_LAYOUT` or `MISSING_COLUMNS` (Caixa changed the file), `NO_GENERATION_DATE`, `GENERATION_DATE_IN_FUTURE` (generated later than tomorrow in Brasília: a wrong date that would make every real list look old), `EMPTY_LIST`, `TOO_MANY_ROWS_WITHOUT_CODE` (over 1% of the rows have no property number: the number column was renamed or removed), `UNREADABLE_PRICES` (over 10% of the rows have a price or appraisal in a format the parser does not read), `TRUNCATED_LIST` (fewer distinct property numbers than `IMPORT_MIN_ROW_RATIO` of the last applied list: probably an incomplete download). The day ends this way only if no newer valid list came later the same day. | **Nothing**: no property, price, availability or change entry was written, and "last updated" did not move (BR-004-10). | Do not rerun at once (ADR-003 counts requests). A `TRUNCATED_LIST` on a real market drop: the owner decides whether to lower `IMPORT_MIN_ROW_RATIO`; a layout change needs a code change to the parser. An alert was sent. |
| `NO_NEW_LIST` | A business day on which Caixa still served the list already applied at the cutoff (its generation day is not later). A failure (BR-004-03). | Nothing was written. | An alert was sent. If business days keep ending here, Caixa stopped publishing: tell the owner. If the day was a holiday, add it to `NATIONAL_HOLIDAYS`. |
| `NO_UPDATE` | A weekend or a holiday of the calendar with no new list, Caixa reachable (`nonBusinessReason` `WEEKEND` or `HOLIDAY`). **Not a failure.** | Nothing was written. | Nothing. No alert, no daily-update signal, so no Radar run and no digest that day. |
| `FAILED` | The day produced no list to apply: Caixa blocked us (`LIST_BLOCKED`), never answered (`LIST_UNREACHABLE`), a valid list could not be applied (`APPLY_FAILED`, with the error class, or `APPLY_INTERRUPTED` when the process died first), or nobody attempted the day (`NO_ATTEMPT`, business days only). `failureReasons` holds the codes, never a message. | Properties are as the last `SUCCESS` run left them: none was marked unavailable, because that is done only after every row was written. A run that died after writing some chunks leaves those rows updated, which is harmless. | An alert was sent. Look at the logs of the run (`Applying the list failed: <code>`, [health-check.md](health-check.md)); the next day's window retries. |
| `RUNNING` | The day is undecided: attempts are still allowed, a list is being applied, or the process died and the lease has not expired yet. | Possibly partly applied. | Nothing: the next tick after the lease expires takes it over and finishes it. If it stays `RUNNING` into the next day, check `IMPORT_ENABLED` and the logs. |

**What "changes no property data" means (BR-004-10, DL-004-04).** It holds fully for a rejected list, a list that is not new, a download that failed, and for unavailability (nothing is hidden before every row was written, and a sweep over the limit is refused). A run that dies in the middle of writing leaves the chunks it had already written applied, by design: those rows come from a validated list and are correct, and the retry with the same list finishes the rest and ends in the state an uninterrupted run would have. The spec's wording should say "no availability or data change from a list that was not applied" rather than "no change" for a mid-apply failure.

`GET /api/health` reads `jobexecutions`, written when the day is decided: `SUCCESS` when the daily update completed **and for `NO_UPDATE`** (a quiet weekend or holiday keeps the health report `ok`); `FAILED` with `LIST_REJECTED`, `NO_NEW_LIST`, `LIST_BLOCKED`, `LIST_UNREACHABLE`, `APPLY_FAILED` or `NO_ATTEMPT` as the error code for the others.

`propertychanges` is the one record of what changed in a property, written by the import and read by the Radar and the digest (BR-004-26). One entry per tracked field per property per run: `type` is `NEW`, `RETURNED`, `BECAME_UNAVAILABLE`, `PRICE_DROPPED`, `PRICE_RAISED`, `MODALITY_OR_ROUND_CHANGED` (or, from the detail collection of part 3, the financing, FGTS and date types), `field` names what changed (`available`, `modality`, `currentMinimumPrice`) and `oldValue` / `newValue` hold the values (money as a string such as `"120000.50"`). `relevant` marks what the PRD says the Radar and the digest care about. Examples: `db.propertychanges.find({ importRunId: ObjectId("...") })` (what a run changed, and `db.importruns.findOne({ brasiliaDate: "2026-03-10" })._id` gives the id) or `db.propertychanges.find({ propertyCode: "1444419970935" }).sort({ createdAt: -1 })` (the history of one property). Consumers read the entries by time (`PropertyChangeService.findSince` with a cursor, `findCreatedBetween` for a window), not by run: an entry a failed run wrote is real (it is written before the change it describes, and the retry applies that change and writes no second entry), so it is delivered once whichever run wrote it. Properties are never deleted: one that left the list stays stored, `available: false`, with its history, and comes back with a `RETURNED` entry if a later list has it.

A property that came back on the list, changed modality, or is listed with every round date already past is marked to be collected again, first: its old rounds are dropped (not collected yet is unknown and active) so it is not stuck inactive on stale dates. A value the list leaves empty never replaces one already known.

A property is **active** (shown in search and favorites) when it is available and (no sale round was collected yet, or a round date is still ahead, or its round is open-ended). A property that is new and not yet collected is active with its photos, payment methods and occupancy **unknown**, never "no".

## Detail collection: the budget, a block, the log (SPEC-004 part 4)

After the day's list is applied, the same run collects detail pages (photos, round dates and prices, payment methods, occupancy, expense rules, the edital and the matrícula) through the port, then records the clock's round changes, then completes the update. `SCRAPER_ENABLED=false` skips the collection and nothing else: **that is how to pause it** (set it in `deploy-production`, redeploy; the day still completes and signals). To pause everything, `IMPORT_ENABLED=false`.

**The budget.** `ENRICHMENT_DAILY_PAGES` pages per Brasília day (across the day's passes: a pass resumed after a restart takes what is left, `detailsPages` on the Import Run), `ENRICHMENT_CONCURRENCY` in flight (1 to 4) and `ENRICHMENT_MIN_PAUSE_MS` (at least 1000) between two request starts, fixed. Photos, editais and matrículas are requests too and go through the same gate (and count toward `ENRICHMENT_DAILY_REQUESTS`, 2000 by default), so one new property costs its page plus up to 12 photos and 2 documents, and the pause applies to every one: at the defaults (5 s) a pass of 300 new properties can take several hours, and the lease is renewed meanwhile. Sizing: the budget must be at least **active properties / `ENRICHMENT_MAX_STALENESS_DAYS`** pages a day to keep every one within N days, plus the new ones of the day; with 20 000 active properties and N = 7 that is about 2 900 pages a day, which at a 5 s pause is about 4 hours of page requests alone before photos. Raise the budget slowly, watch the log and the Import Runs, and prefer a longer N over a shorter pause. The order when the budget is smaller than the work: new or returned properties, then those whose list row changed today, then the oldest data.

**Reading the collection log.** One line per request, from `DetailEnrichmentPass`:

```
collection.request kind=page code=8787708003668 outcome=OK startMs=0 endMs=412
collection.request kind=file code=8787708003668 outcome=OK startMs=5000 endMs=5230
collection.property code=8787708003668 outcome=COLLECTED changes=0
```

`startMs`/`endMs` are milliseconds from the start of the pass. Check the rate by sorting the `startMs` of one pass: consecutive values must differ by at least `ENRICHMENT_MIN_PAUSE_MS`, and at most `ENRICHMENT_CONCURRENCY` requests may overlap (`startMs <= t < endMs`). There is no URL and no page text in the log, only property numbers and codes (`outcome` is `OK`, `BLOCKED_<reason>`, `UNREACHABLE_<reason>`, `URL_REFUSED`, `ERROR_<class>`; per property also `PAGE_UNAVAILABLE`, `PAGE_UNRECOGNISED`; per copy `collection.copy ... outcome=FILE_WRONG_TYPE | FILE_TOO_LARGE | FILE_TYPE_MISMATCH | FILE_EMPTY | OFF_SITE | UNREACHABLE | STORE_FAILED | PRIVATE_STORAGE_UNCONFIGURED | STORAGE_UNCONFIGURED | UNSAFE_CODE`). The pass ends with `Detail collection ended (DONE | OUT_OF_BUDGET | BLOCKED | CONSECUTIVE_FAILURES)`.

**What a blocked collection means.** Caixa answered a page, a photo or a document with a 401/403/407/429/451/503, any answer carrying a `Retry-After`, a Radware or ShieldSquare challenge page or a redirect off its site. The pass stops at once for the day (workers already waiting at the gate send nothing more) (`blocked` true on the Import Run, `collection.blocked reason=...` in the log), every admin gets one email, the day's update still completes (the list was applied) and the next day's run resumes, the refused property first. What the operator does: read the reason code, note it on #108 with the date, and wait. **Never** switch the address, add or change `CAIXA_PROXY_URL`, change the user agent or lower the pause to "get past" it: that is evasion (SC-24). If it recurs, lower `ENRICHMENT_DAILY_PAGES` or raise `ENRICHMENT_MIN_PAUSE_MS`, or set `SCRAPER_ENABLED=false` and ask Caixa.

**Failures that are not a block.** A page that times out, is unreachable, is unreadable or says the property is "no longer available" keeps the property's previous data, counts as `failed`, and is left alone for 1, 2, 4... days (bounded at 16; `ENRICHMENT_FAILURE_BACKOFF_DAYS`), then retried. `ENRICHMENT_MAX_CONSECUTIVE_FAILURES` (5) requests in a row that fail on the way (a timeout, a network failure or a 5xx, for a page, a photo or a document alike) stop that day's pass without an alert; a sold-out or unreadable page is backed off but does not count toward this, so a run of them does not end the day: look at `failed` on the run and at the log codes (a network fault on the way, or a page layout that changed: `PAGE_UNRECOGNISED`). Only the daily list decides whether a property is available.

**Copies, versions and the matrícula rule.** Photos and editais are public catalogue files in `R2_BUCKET`; keys carry the property number and a content-hash prefix (`auctions/{code}/photos/{hash}.jpg`, `auctions/{code}/edital/{hash}.pdf`), so a new version never overwrites an old one and nothing is deleted. The **matrícula** names people (SC-18, SC-25): it is copied only to `R2_PRIVATE_BUCKET` under `private/auctions/{code}/matricula/{hash}.pdf` and linked per request (`GET /api/auctions/:code/matricula-link`, 60 s, signed-in accounts). **If `R2_PRIVATE_BUCKET` is not set the matrícula is not copied at all** (`collection.copy kind=MATRICULA outcome=PRIVATE_STORAGE_UNCONFIGURED`), it stays unknown, and it never falls back to the public bucket. Files are kept only if they pass the type allowlist (JPEG, PNG, WebP; PDF for documents), the magic-byte check and the size caps (`ENRICHMENT_MAX_PHOTO_BYTES`, `ENRICHMENT_MAX_DOCUMENT_BYTES`); a redirect off Caixa's site is a block. A new edital or matrícula (another address, another publication date, or another content found by the 30-day re-check) is appended to `documentVersions`; the old version stays stored and a history-only change entry (`OTHER_FIELD`, field `edital` or `matricula`) records it.

**The clock's round changes.** When an SFI property's 1st round date passes, the next run records `MODALITY_OR_ROUND_CHANGED` and `PRICE_DROPPED` (source `CLOCK`) for it before the update completes, so the Radar and the digest see what the search already shows. No cron.

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
| `IMPORT_WINDOW_START`      | 06:00    | Brasília `HH:mm`: no attempt before it (BR-004-01). |
| `IMPORT_CUTOFF`            | 12:00    | Brasília `HH:mm`, later than the start: no attempt from it on, and the day is decided (BR-004-03). |
| `IMPORT_MAX_ATTEMPTS`      | 12       | Attempts a day at most, 1 to 48 (BR-004-02). |
| `IMPORT_ATTEMPT_SPACING_MINUTES` | 30 | Minutes between two attempts, at least 5 (the tick; no tight loop on Caixa, BR-004-02, SC-24). |
| `SCRAPER_ENABLED`          | true     | Kill switch of the detail collection (runs inside the import; no start-up switch any more). |
| `ENRICHMENT_DAILY_PAGES`   | 300      | Detail pages a Brasília day, across passes (BR-004-18). Sizing above. |
| `ENRICHMENT_DAILY_REQUESTS` | 2000    | Requests of every kind a day (pages, photos, documents), across passes: the wider bound. |
| `ENRICHMENT_CONCURRENCY`   | 1        | Requests in flight, 1 to 4. |
| `ENRICHMENT_MIN_PAUSE_MS`  | 5000     | Milliseconds between request starts, at least 1000, fixed. |
| `ENRICHMENT_MAX_STALENESS_DAYS` | 7   | Days between two collections of an active property, at most (BR-004-19). |
| `ENRICHMENT_FAILURE_BACKOFF_DAYS` | 1 | First back-off of a failed page, doubling to 16 days (BR-004-21). |
| `ENRICHMENT_MAX_CONSECUTIVE_FAILURES` | 5 | Failures in a row that stop the day's pass (not a block). |
| `ENRICHMENT_MAX_PHOTOS` / `_MAX_PHOTO_BYTES` / `_MAX_DOCUMENT_BYTES` | 12 / 5 MiB / 20 MiB | Copy limits (BR-004-22); `CAIXA_MAX_DOWNLOAD_BYTES` also bounds what the adapter reads. |

All are in `backend/.env.example` and, for production, the `deploy-production` environment (`deploy/render-env.sh`). `IMPORT_ENABLED` and `SCRAPER_ENABLED` stay `false` there until the transport is decided; the `ENRICHMENT_*` variables are optional there (defaults above) and are `vars` of the environment.

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
