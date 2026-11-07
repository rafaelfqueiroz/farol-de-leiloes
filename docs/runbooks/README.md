# Runbooks

Procedures someone follows **while something is going wrong**: no context, no time, and a strong pull towards doing the destructive thing first. They are written as ordered steps, they say what not to do, and they state their own known gaps rather than implying a readiness the project does not have (DEVELOPMENT §11).

| Runbook | When |
|---|---|
| [incident-response.md](incident-response.md) | Any unauthorised access, loss or disclosure of personal data (SC-31) |
| [health-check.md](health-check.md) | The container is unhealthy, a health probe alerts, or the auction data may be out of date: reading `GET /api/health` (AR-48) |
| [deploy-and-rollback.md](deploy-and-rollback.md) | Provisioning the production server, deploying a release by hand, rolling one back (DV-33, DV-34) |
| [backup-and-restore.md](backup-and-restore.md) | A dump before a risky migration, restoring after a loss, the restore drill (ADR-002) |
