# Health check — reading `GET /api/health`

**Use when:** the container is reported unhealthy, the availability probe alerts, a deploy health check fails, or someone asks whether the auction data is current.

**Governs:** ARCHITECTURE.md AR-48 (the endpoint), AR-03 (every job run is recorded), SPEC-003 BR-003-02 (the availability probe).

## Known gaps

- **Hosting is not live yet** (BL-001, [ADR-002](../adr/002-hosting-and-environments.md)): there is no availability probe or deploy health check calling it. Today only the backend image's Docker `HEALTHCHECK` uses it.
- **No alerting on `degraded`.** The container stays healthy while the import is failed or stale (only `down` answers 503), so a degraded import is noticed only by someone reading the endpoint, or by a probe that checks the body.
- Only the Caixa import is reported. The details scraper and the reminders job record their runs (`jobexecutions`) but do not appear here.

## What the body means

```json
{
  "status": "degraded",
  "database": { "status": "up" },
  "lastImport": { "status": "FAILED", "finishedAt": "2026-01-15T09:00:00.000Z", "ageHours": 3, "stale": false }
}
```

| Field | Values | Meaning |
|---|---|---|
| `status` | `ok` | Database up, and the last import succeeded within 26 h. HTTP 200. |
| | `degraded` | Database up, but the auction data may be out of date: the last import **failed**, is **stale** or **never** ran. HTTP 200: the API still serves. |
| | `down` | MongoDB is unreachable: not connected, a ping slower than 2 s, or the read failed. HTTP **503**: the container is unhealthy. |
| `database.status` | `up` / `down` | Connection state plus `ping` with a 2 s timeout. The reason is never in the body. |
| `lastImport.status` | `SUCCESS` / `FAILED` / `NEVER` | The latest `auctions-import` run in `jobexecutions`, in **any** run mode (daily `AUTO` or startup `MANUAL`). A row written before #36 has no status and reads as `SUCCESS`. With the database down it reads `NEVER`: there was nothing to read. |
| `lastImport.finishedAt` | ISO time / `null` | When that run finished. |
| `lastImport.ageHours` | number / `null` | Hours since it finished, two decimals. |
| `lastImport.stale` | boolean | `true` past **26 h** (`IMPORT_STALE_AFTER_HOURS`: daily at 03:00 Brasília plus 2 h), or when the import never ran. |

The body never holds error details, versions or host names. A failed run's stable code (`errorCode`, an error class or a `DomainError` code, never a message) is in its `jobexecutions` row only.

## Do not

- Do not restart the container because the status is `degraded`: the API is serving. A restart re-runs nothing unless `IMPORT_ON_START_UP=true`, and hides the logs of the failed run on hosts that do not keep them.
- Do not run the import by hand against production from a laptop, or edit `jobexecutions` to make the endpoint read `ok`. The record is the evidence of what happened (AR-03).
- Do not paste log lines into a public issue without checking them first. They should carry no personal data (SC-15), but a line that does is an incident (incident-response.md).

## Steps

1. **Read the endpoint.** `curl -s https://<api-host>/api/health`, or from inside the container: `node -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.text()).then(t => process.stdout.write(t))"`.
2. **`down`** — the API logs `Database unreachable: health reports down` at each failing check, and the probe's own request line at error level. MongoDB first: is the cluster up (Atlas status), did its credentials or network access change, is `MONGODB_URI` the expected one? Once the database answers, the endpoint returns `ok` or `degraded` by itself, with no restart.
3. **`degraded` and `lastImport.status` is `FAILED`** — find the run's lines: the import logs with `"jobName":"auctions-import"`, and every line of one run shares its `correlationId`. Look for the `Failed import: <code>` line (the stable code, never the message), the `errorCode` of the run's `jobexecutions` row, and the run's event in Sentry, tagged `jobName: auctions-import`. Typical causes: Caixa unreachable or answering a bot-protection page (SPEC-004), a CSV layout change the parser refuses. The next daily run at 03:00 Brasília retries on its own: a failed run does not count as "ran recently".
4. **`degraded` and `stale` is `true` with `SUCCESS`** — the daily run did not happen. Check `IMPORT_ENABLED` is not `false`, that the process was running at 03:00 Brasília (a restart loop or a stopped container skips the cron), and the boot lines of `AuctionsImporter`.
5. **`degraded` and `NEVER`** — a new or empty database: no import was ever recorded. Expected right after a first deploy until the first 03:00 run, or set `IMPORT_ON_START_UP=true` for one boot.
6. **Faults** are also in Sentry (backend project), once `SENTRY_DSN` is set: request faults tagged with method and route, failed import and scraper runs with `jobName`. Production logs a warning at boot when the DSN is not set.
