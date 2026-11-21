# Legal validation, retention and the launch checklist

**Use when:** the owner has the lawyer's opinion and must record it, someone asks "can we launch?", a legal-analysis feature answers `LEGAL_VALIDATION_REQUIRED`, a gate that was open closed again, or the document retention job misbehaves.

**Governs:** SPEC-010 BR-010-18 to BR-010-26 and DL-010-07, ARCHITECTURE AR-43 (settings), SECURITY SC-25 and SC-28.

## How it works

- **Four gates**, one per scope of the lawyer's validation (BR-010-26): `third-party-processing` (the processing of third parties' data by SPEC-015 and SPEC-024, BR-010-25), `retention-periods`, `privacy-policy` and `terms`. A validation is a row in `legalValidations` (insert-only): scope, date, validator, the document versions reviewed (`terms:1.0`, `privacy:1.0`), an optional reference and, for `retention-periods`, the `DOCUMENT_RETENTION_YEARS` the lawyer reviewed.
- **Only an operator records one**, with `npm run legal:record-validation` run from the compiled output. No HTTP route writes a validation, so nobody who reaches the API can open a gate.
- **What counts:** `terms` and `privacy-policy` count only while the recorded version is the one in force; `retention-periods` counts only while the setting equals the period reviewed; `third-party-processing` counts once a record exists. The newest record decides.
- **The production gate:** a route marked `@RequiresLegalValidation('third-party-processing')` answers `403 LEGAL_VALIDATION_REQUIRED` (with the scope only) until that gate is validated, when `LEGAL_GATE_ENFORCED` is true. Unset, it is true when `NODE_ENV=production` and false elsewhere; set `LEGAL_GATE_ENFORCED=true` on a staging environment to see it as production will. It fails closed: if the validations cannot be read, the request is refused.
- **The launch checklist:** `GET /api/admin/launch-checklist` (admin only, never cached).

## What reopens a gate

| Change | Gate that closes again |
|---|---|
| A new version of the terms takes effect | `terms` (and nothing else) |
| A new version of the privacy policy takes effect | `privacy-policy` |
| `DOCUMENT_RETENTION_YEARS` is changed after the review | `retention-periods`, and the periods are provisional again |
| A new validation of the same scope | The newest record decides, so it replaces the earlier one |

A validation is never edited or deleted; record a new one.

## Warning: lowering `DOCUMENT_RETENTION_YEARS` deletes for good

**Lowering the period deletes irreversibly at the next 04:30 run**: every journey between the old and the new date becomes due and its files go, with no recovery. Confirm the new value against the lawyer's opinion **before** changing it. Raising it is safe (nothing is deleted that was not already due).

The job has a brake against accidents. Before deleting it compares the setting with the `retentionYears` of the newest `retention-periods` validation:

- the setting is **lower** than the validated period, or **no validation is recorded** (the period is provisional): the run deletes **at most 25 journeys**, logs a `warn` ("... shorter than the period the lawyer validated ..." or "... not validated yet (provisional) ...") and, when it stopped at the cap, a second `warn` ("stopped at its cap"); the rest waits for the next days' runs, so someone notices before everything goes;
- the newest validation names the same period, a shorter one, or no period (or a later validation names the new value): no cap.

So before launch, while nothing is validated, the job deletes at most 25 journeys a day. To lift the brake, restore the validated period or record the lawyer's validation of the new one. The cap only slows a deletion down: it is never a reason to ignore the warning.

## Do not

- Do not record a validation before the lawyer has opined: the record is the evidence that the gate may open.
- Do not put the validator's name or the reference in a ticket, a log or a chat: the script prints the outcome only, and the checklist shows no name (SC-15).
- Do not insert into `legalValidations` by hand with `mongosh`: the script checks the versions against the registry and refuses a draft.
- Do not set `LEGAL_GATE_ENFORCED=false` in production to "unblock" a feature. It exists for development and tests; production without a recorded validation must stay closed (BR-010-25). If it is set anyway, the backend logs a warning at every boot and the launch checklist is **not ready** (`launchReady: false`) while it stays so.
- Do not lower `DOCUMENT_RETENTION_YEARS` without the lawyer's opinion (see the warning above).

## Steps

### Record the lawyer's validation

1. Publish the reviewed texts first when the opinion is about them: the lawyer reviews a final text, which is published as a **new version** of `terms` or `privacy` (`backend/src/privacy/legal/`, `draft: false`, no banner). A version still marked draft ("RASCUNHO — pendente de revisão jurídica") **cannot be validated**: the script refuses it.
2. Build and run the script against production (inside the production image, so it reaches the production database with the validated environment):

   ```text
   npm run legal:record-validation -- --scope terms --validator "<lawyer or firm>" --versions terms:1.0 [--reference <opinion id>]
   npm run legal:record-validation -- --scope privacy-policy --validator "<name>" --versions privacy:1.0
   npm run legal:record-validation -- --scope retention-periods --validator "<name>" --retention-years 5
   npm run legal:record-validation -- --scope third-party-processing --validator "<name>"
   ```

   `--versions` takes `<type>:<version>` entries, comma separated, and each must exist in the legal registry and not be a draft. `terms` needs a `terms:` entry and `privacy-policy` a `privacy:` entry. `--retention-years` belongs to `retention-periods` and is required there: write the period the lawyer actually reviewed. Exit code 0 means recorded; 1 means refused, with the reason, and nothing was written.
3. Read the checklist (below). The gate opens on the next request: nothing is cached.

### Read the launch checklist

`GET /api/admin/launch-checklist` as an admin:

- `gates`: per scope `validated`, `validatedAt` and `documentVersions` when validated, and `blocks`, what stays blocked meanwhile (SPEC-015 manual legal analysis, SPEC-024 AI document analysis, the F1 launch).
- `drafts`: the current legal documents still marked draft. The launch needs none.
- `retention`: `documentYears` and `provisional`, true until `retention-periods` is validated (BR-010-24).
- `lawyerSetPeriods`: billing records (BR-010-22), the admin access log and account status records (BR-010-23). Each says `deleted: false`: nothing is deleted until the lawyer sets the period (Q-21). When the periods are set, the change that implements their deletion also updates this list.
- `settings`: `termsEnforcementEnabled`, `accountPurgeEnabled`, `dataExportEnabled`, `documentRetentionEnabled`, `privateBucketConfigured` (exports and client files need `R2_PRIVATE_BUCKET`) and `legalGateEnforced`.
- `launchReady`: every gate validated, no draft, the periods not provisional and, in production, the legal gate enforced (`settings.legalGateEnforced`).

The checklist holds no personal data: no validator, no reference, no account.

### A feature answers `LEGAL_VALIDATION_REQUIRED`

It is the gate working. Read the checklist; if `third-party-processing` is not validated, record it after the lawyer's opinion. If it was validated and closed again, nothing changed for this scope except a failed read: the guard logs `The legal validation could not be read; refusing: <code>` (a database problem, see [health-check.md](health-check.md)).

### The document retention job

`DocumentRetentionJob` runs daily at 04:30 Brasília time (`DOCUMENT_RETENTION_ENABLED`, run-level lock `job:document-retention`, each run a row in `jobexecutions` named `document-retention`; `PARTIAL_FAILURE` when some journey failed). It asks SPEC-017's closed-journey files source for journeys closed at or before today minus `DOCUMENT_RETENTION_YEARS` years, re-checks each one, has the source delete the files, writes one row to `retentionDeletions` (journey, owner ids, number of files, date, never a name or content, BR-010-21) and only then **acknowledges** the journey to the source, which keeps listing it until then.

- The documents are kept **through** the Nth anniversary of the closing date in Brasília and deleted from the next day; a journey closed on 29 February is kept through 28 February (BR-010-19). Won, lost and cancelled journeys follow the same rule (D-41).
- The re-check does not trust the source: a closing kind other than `won`, `lost` or `cancelled`, a closing date before 2020-01-01 or in the future, or a journey not due is **never purged**. Those the source should not have listed are counted as `out of contract` and each is warned by its id, so the source's defect can be found.
- Until SPEC-017 binds its source, the job finds nothing and records itself.
- Logs are counts: `N journeys deleted (F files), X out of contract, Y failed, Z unrecorded`. `unrecorded` above zero means files were deleted but the log row could not be written (an `error` log); the journey stays listed (not acknowledged), so the next run repeats the deletion (finds nothing), writes the row and acknowledges it. **The only consequence is that the logged file count of such a journey undercounts (0)**; compare with the run's earlier log line if the exact number matters.
- A failed journey leaves no row, is left out of the rest of the run (the source is told to exclude it, so a head of journeys that keep failing does not hide the newer ones) and is tried again the next day.
- To change the period, change `DOCUMENT_RETENTION_YEARS`; the dates move with no code change, and `retention-periods` needs the lawyer's validation of the new value. Read the warning above before lowering it.

## Known gaps

- The legal text is a placeholder until the lawyer writes it (Q-21); every gate is closed until then.
- The periods for billing records, the admin access log and account status records are not set: nothing is deleted.
- The file count logged for a journey whose deletion had to be repeated after a crash is 0, not the real number (the repeat found nothing left).
