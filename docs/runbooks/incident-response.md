# Incident response — personal data

**Use when:** there is reason to believe personal data was accessed, disclosed, altered, lost or destroyed without authorisation — a leaked credential, a cross-office leak, a public bucket, data in logs or Sentry, a lost device with a database dump, a provider's breach notice.

**Governs:** LGPD art. 48 and Resolução CD/ANPD nº 15/2024 (Regulamento de Comunicação de Incidente de Segurança). SECURITY.md SC-31.

## Known gaps

State these honestly when the runbook is used:

- **Controlador and encarregado are not yet named** (SECURITY §9). Until they are, the developer acts as the contact and the Efetive partner is informed immediately.
- **No hosting yet** (BL-001): there are no production access logs or backups to consult. Steps that depend on them say so.
- No lawyer has reviewed this runbook.

## Do not

- **Do not delete logs, records or the affected data** to "clean up". They are the evidence of scope, and deleting them may itself be an incident.
- Do not discuss the incident in a public GitHub issue, PR or commit message. Use a private channel and a GitHub security advisory draft.
- Do not contact affected people before the facts in step 3 are established — a wrong notice is its own harm.
- Do not paste the leaked data into an AI tool, chat or ticket to "analyse" it (SC-32).

## Steps

1. **Contain (first hour).** Stop the leak without destroying evidence: revoke the exposed credential or key, make the bucket private, disable the affected endpoint or feature flag, end sessions (bump session versions, SC-03). Write down what you did and when — Brasília time.
2. **Open a private record.** A GitHub security advisory draft on the repository, holding a timeline of everything from discovery onward: who found it, when, how.
3. **Establish the facts.**
   - What data categories (SECURITY §9 inventory)? Does it include sensitive data, financial data, documents, or third parties in documents?
   - Whose data, and how many people? Which offices?
   - Since when, until when? Was it actually accessed, or only exposed?
   - What could it cause — fraud, discrimination, financial loss, reputational harm?
4. **Decide whether to notify.** Notification to the ANPD and to the data subjects is required when the incident **may cause relevant risk or damage** to them (art. 48). Document the decision and its reasoning either way — "not notified" without a record is not a decision.
5. **Notify, within 3 business days** of knowing it affected personal data (Res. 15/2024):
   - **ANPD** — through the incident communication form on the ANPD's site (gov.br/anpd). Content: description, data and people affected, measures taken, risks, reasons for any delay, the contact person.
   - **Data subjects** — in clear Portuguese, by email and in the product: what happened, what data, what we did, what they should do, who to contact.
   - **Affected offices** — when their clients' data is involved, since they relate to those clients directly.
   - Information not yet known may be sent in a complementary communication within 20 business days.
6. **Fix the cause.** A PR with the fix and a regression test (isolation test for a cross-office leak, a log-scrubbing test for data in logs). The PR description does not describe the exploit publicly until it is fixed.
7. **Keep the record** of the incident, the decision and the notices for at least 5 years (Res. 15/2024 record-keeping).
8. **Review.** Within two weeks: what let it happen, which guideline should have caught it, and whether a rule or a test needs adding. Amend the guidelines through a PR.
