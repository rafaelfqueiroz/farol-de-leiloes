# Backup and restore — MongoDB Atlas

**Use when:** taking a safety copy before a risky migration, restoring data after a loss or a bad migration, or running the restore drill.

**Governs:** [ADR-002](../adr/002-hosting-and-environments.md) (Backups), DEVELOPMENT.md DV-34 and AR-28/AR-29 (forward-only, expand/contract migrations), SECURITY.md SC-15 (a dump holds personal data) and SC-16 (secrets stay out of commands and files).

## Known gaps

- **Production runs on the Atlas free cluster until Flex is needed.** This is the owner's decision of 2026-11-11; ADR-002 still names Flex as the target. The free cluster has no backups at all, so a `mongodump` (below) is the only copy, and the policy below applies only after the upgrade.
  - **Upgrade to Flex before any of these:** real personal or payment data in production (a lost database could not be restored); storage approaching the free cluster's 512 MB; the free tier's throughput or connection limits being hit (the daily import and the scraper are the likeliest).
- **No restore drill has run yet.** Until one does, this runbook is untested and a backup is a hope, not a fact. It must run before the first external user. Until Flex, the drill runs from a `mongodump` into a temporary cluster, since there is no snapshot to restore.
- Flex's policy is fixed: **8 daily snapshots**, no on-demand snapshot and no point-in-time restore. Up to **24 hours of data can be lost**.
- Where Flex snapshots are stored is not verified (ADR-002).

## Do not

- **Do not restore over production.** Restore into a temporary cluster, check it, and only then decide how to bring data back (a targeted copy of the lost documents, or repointing `MONGODB_URI`).
- Do not keep a dump on the server, on a laptop or in an unrestricted bucket. It holds personal data: private R2 bucket only, delete the local file after the upload, and delete old dumps once the migration is proven (SC-15).
- Do not put the connection string or R2 keys on a command line or in shell history; read them from a file or the environment (SC-16).
- Do not commit dump files, connection strings or drill output containing data.
- Do not delete the temporary cluster of a drill before recording its result.

## Steps

### Before a risky migration

Atlas cannot snapshot on demand, so dump first.

1. From a machine with `mongodump` (MongoDB Database Tools) and the Atlas access list opened for it, run `mongodump --uri "$MONGODB_URI" --gzip --archive=farol-<date>-<release>.archive`, with `MONGODB_URI` read from a file you keep outside the repository.
2. Upload the archive to the **private** R2 bucket for backups (no public URL, a dedicated key with write access to that bucket only), then delete the local file and close the access list entry.
3. Run the migration ([deploy-and-rollback.md](deploy-and-rollback.md)). Keep the dump until the release is proven.

### Restore (after a loss)

1. Stop the damage: if a migration or release caused it, roll back the code first ([deploy-and-rollback.md](deploy-and-rollback.md)).
2. In Atlas, restore the most recent good snapshot **into a new temporary cluster** (or `mongorestore` a dump into one), never over production.
3. Check the temporary cluster: collection counts against production, the latest `jobexecutions` rows, a few known documents, and the `migrations` collection.
4. Bring back only what is needed (copy the lost documents), or, if the whole database is bad, repoint production at the new cluster: change the `MONGODB_URI` secret of the `deploy-production` environment (`gh secret set MONGODB_URI --env deploy-production`) and redeploy ([deploy-and-rollback.md](deploy-and-rollback.md), Change a setting or a secret). Tell the owner what up to 24 hours of data may be gone.
5. If personal data was lost or exposed, follow [incident-response.md](incident-response.md).

### Restore drill

**When:** before the first external user, then every quarter.

1. Restore the latest snapshot into a **temporary cluster** in a separate Atlas project, with its own user and an access list limited to your address.
2. Run the checks of step 3 above, and time the whole restore.
3. Optionally start the backend against it locally with a throwaway env file, never with production secrets other than what the restore needs.
4. Delete the temporary cluster and its credentials.
5. **Record** the date, which snapshot (its age), how long the restore took, what was checked and its result, what failed or was unclear, and what you changed in this runbook. Keep the record in an issue on the board.
