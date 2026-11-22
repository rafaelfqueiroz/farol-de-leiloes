# Account closure, purge and data exports

**Use when:** a closed account's personal data is not being deleted (the alert `N closed account(s) not purged 25 days after closure` in the logs), the purge or the export job misbehaves, an export is stuck or failed, or someone asks what the deletion did.

**Governs:** SPEC-010 BR-010-08 to BR-010-15 and BR-010-28, ARCHITECTURE AR-31 (nothing is deleted inline), SECURITY SC-27 and SC-28, and the backups rule in [backup-and-restore.md](backup-and-restore.md).

## How it works

- **Closure** (`POST /api/privacy/delete-account`) closes the account at once: `status: 'closed'`, `closedAt`, a new credential version, sessions and links gone, queued exports cancelled. It deletes nothing. It is fenced on the credentials the proof was given for: a request whose password was checked just before a reset or a Google takeover is refused with `UNAUTHENTICATED` and closes nothing (the holder signs in again).
- **Purge** (`AccountPurgeJob`, daily 04:10 Brasília time, flag `ACCOUNT_PURGE_ENABLED`): for each closed account without `purgedAt`, in a fair order (never attempted first, then the least recently attempted, then the fewest attempts, then the oldest closure; read 100 at a time, up to 500 attempts a run). Every attempt is stamped on the account (`lastPurgeAttemptAt`, `purgeAttempts`) in the same update as the claim, so an account that never succeeds goes to the back of the queue after each run and never starves the others across days; it takes a claim (`purgeClaimToken`, 10-minute lease), repeats the closure effects, runs every registered provider's `purge` (the registry), and writes the tombstone last: name, phone, sign-in methods and legacy fields removed, address replaced by `purged-<id>@removed.invalid`, `purgedAt` set. A failure at any step leaves the account unpurged and the next run repeats everything. Run-level lock: `jobLocks`, `job:account-purge`.
- **Residue sweep:** a request that was already past authentication when the account closed can write a favourite, a saved filter, a reminder or a session after the purge. A day after the tombstone (`residueSweepDueAt`) each run re-runs the providers' purge once for the account and sets `residueSweptAt`; the run's log and `jobexecutions` outcome carry the counts (`swept`, `residueDeleted`, `sweepFailed`). `sweepFailed` > 0 records `PARTIAL_FAILURE` and the account is retried the next day: look for `An account residue sweep failed this time: <code>`.
- **Alert:** its own daily check at 04:20 (it runs even with `ACCOUNT_PURGE_ENABLED=false`): an `error` log with a count when a closed account is still unpurged `ACCOUNT_PURGE_ALERT_DAYS` (25) after `closedAt`; the legal ceiling is `ACCOUNT_PURGE_MAX_DAYS` (30). Each run is a row in `jobexecutions` (`account-purge`; `PARTIAL_FAILURE` when some account failed).
- **Exports:** `DataExportJob` builds queued exports every 2 minutes (flag `DATA_EXPORT_ENABLED`) into the **private** bucket, and hourly expires them after `EXPORT_TTL_DAYS` (7) and deletes the files of failed, cancelled and expired ones. Without `R2_PRIVATE_BUCKET` every export fails with `EXPORT_STORAGE_UNAVAILABLE`.

## Do not

- Do not delete a user document or a collection by hand to "finish" a purge: the tombstone keeps the id the retained records (consents, billing, the admin log) refer to.
- Do not put an account id, email or name in a ticket or a log line; counts only (SC-15).
- Do not switch `ACCOUNT_PURGE_ENABLED` off to "pause" a problem for longer than the ceiling.
- Do not edit `consents`, `whatsappConsents`, `subscriptions` or the admin log: they are retained on purpose (`RETAINED_MODELS`).

## Steps

### The alert fired, or accounts stay unpurged

1. `jobexecutions`: the latest `account-purge` rows. `FAILED` with `PARTIAL_FAILURE` means some account failed; another code means the whole run failed (database, lock). No row for a day: the job did not run (flag off, backend down).
2. Backend logs: `An account could not be purged this time: <code>` names the failure kind. Typical: `ClosureHookFailedError` (a closure hook of another module keeps failing: the tombstone waits until it works, by design), `ExportBuildInProgressError` (a worker is still building the account's export; the next run finishes), `EXPORT_FILE_DELETE_FAILED` (the private bucket refuses deletes: check R2 and `R2_PRIVATE_BUCKET`; the row and file are kept and the next run retries), a database error.
3. Fix the cause. The next run (or a restart for an immediate run, see below) repeats every step; nothing needs repairing by hand.
4. If a claim looks stuck (`purgeClaimUntil` in the future for a worker that died), it expires by itself within 10 minutes.

### Run it now

The job runs on its schedule only. For an immediate run, restart the backend container right before 04:10, or, owner-approved, run the job from a one-off script in the compiled output; do not call it from a request. Never run two instances' worth by hand: the lock and the claim keep it safe, but nothing is gained.

### Check a purge

For an id the owner gives you (not a name): `db.users.findOne({ _id: ObjectId("<id>") })` shows `status: 'closed'`, `closedAt`, `purgedAt`, an `@removed.invalid` email and none of name, phone, googleId, password, providers. `db.dataExports.countDocuments({ userId: ObjectId("<id>") })` is 0 and no `private/exports/` file remains for it.

### An export is stuck or failed

- `queued` for long: the worker flag, the lock, and that `R2_PRIVATE_BUCKET` is set. The legal limit to deliver is 15 days (BR-010-11); the worker normally takes minutes.
- `failed` with `errorCode`: `EXPORT_STORAGE_UNAVAILABLE` (bucket not configured or unreachable), `EXPORT_BUILD_FAILED` (a provider failed: see the `A data export could not be built: <code>` log), `EXPORT_ACCOUNT_NOT_ACTIVE` (the account was closed or deactivated meanwhile). The holder can ask again; a failed export frees the slot.

### After a restore

Deleted data is back with a snapshot: replay the purges ([backup-and-restore.md](backup-and-restore.md#restore-replay-the-purges)).

- **Reminders:** closure (and the purge, again) turn the account's pending reminders into `CANCELLED`; the scheduler also cancels a closed or missing account's reminder it still meets. A reminder of a *deactivated* account stays pending. A reminder with no phone for an SMS/WhatsApp channel is skipped each run and stays pending (SPEC-007 owns that semantics).
- **Exports:** a failed export keeps its `fileKey` until the cleanup deletes the file (a crashed worker may have uploaded under it); the cleanup and the purge leave a row alone while its worker's lease is live (10 minutes).

## Known gaps

- Until SPEC-011, SPEC-016 and SPEC-021 land, closure has no client links, memberships or journeys to end (`ACCOUNT_CLOSURE_HOOKS` is empty) and the pseudonym service has no caller.
- The legacy CPF, date of birth, sex and address of **live** accounts are not erased (an open owner decision); the purge removes them from closed ones.
- `notificationLogs.recipient` stores the address or phone a reminder went to; the purge deletes it with the account.
- Backups keep deleted data until they rotate (30 days at most).
