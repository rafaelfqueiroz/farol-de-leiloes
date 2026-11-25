# Runbooks

Procedures someone follows **while something is going wrong**: no context, no time, and a strong pull towards doing the destructive thing first. They are written as ordered steps, they say what not to do, and they state their own known gaps rather than implying a readiness the project does not have (DEVELOPMENT §11).

| Runbook                                          | When                                                                                                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [incident-response.md](incident-response.md)     | Any unauthorised access, loss or disclosure of personal data (SC-31)                                                                                                                     |
| [health-check.md](health-check.md)               | The container is unhealthy, a health probe alerts, or the auction data may be out of date: reading `GET /api/health` (AR-48)                                                             |
| [deploy-and-rollback.md](deploy-and-rollback.md) | Provisioning the production server, deploying a release by hand, rolling one back (DV-33, DV-34)                                                                                         |
| [stripe-billing.md](stripe-billing.md)           | Setting Stripe up for office subscriptions (prices, webhook, dunning that ends in cancel, the restricted billing portal), the daily reconcile job, a plan that looks wrong (SPEC-012)    |
| [account-purge.md](account-purge.md)             | A closed account's data is not being deleted (the purge alert), an export is stuck or failed, what the deletion did (SPEC-010)                                                           |
| [legal-validation.md](legal-validation.md)       | Recording the lawyer's validation, reading the launch checklist, a feature answering `LEGAL_VALIDATION_REQUIRED`, the document retention job (SPEC-010)                                  |
| [caixa-import.md](caixa-import.md)               | How the backend reaches Caixa (the `CaixaAccess` port, the proxy setting), what a block means, the national-holiday calendar and its yearly edit, the manual live test (SPEC-004, SC-24) |
| [backup-and-restore.md](backup-and-restore.md)   | A dump before a risky migration, restoring after a loss, the restore drill (ADR-002)                                                                                                     |
