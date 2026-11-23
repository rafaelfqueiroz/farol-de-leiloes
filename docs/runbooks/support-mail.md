# Support request emails

**Use when:** a requester says they got no confirmation, the support mailbox did not get a request that the product accepted, or the logs show `Support mail for request <id> gave up after 8 failed rounds`.

**Governs:** SPEC-009 BR-009-07 and BR-009-10, ARCHITECTURE §4 (Support requests, the outbox), SECURITY SC-15.

## How it works

- A support request is **stored first**; its two emails (the confirmation to the requester, the notice to `SUPPORT_EMAIL`) are tried at once and, when SMTP fails, by `SupportMailJob` every minute (flag `SUPPORT_MAIL_JOB_ENABLED`). The request is never lost because of a mail: the requester has the protocol either way.
- A failed round is retried after 1, 2, 5, 15, 60, 180 and 180 minutes; the **eighth** failed round gives up (`supportRequests.mailGaveUpAt` set, an `error` log with the request id only, a `support-mail` row in `jobexecutions` with `MAIL_GAVE_UP`). Nothing is tried after that.
- One claim per request (`mailClaimToken`, `mailClaimUntil`, a lease of 2 minutes) makes sure two workers never send the same mail at once; a worker that died leaves a claim that expires by itself.
- SMTP cannot be exactly-once: after a crash between "sent" and "marked" the next round can send the same mail again. The confirmation has a stable Message-ID per request, so a provider can drop the repeat.
- A deactivated account gets no confirmation, and a closed or purged one gets nothing; the team still gets the notice of a deactivated account's request (`confirmationSkippedAt`, `teamNoticeSkippedAt`).

## Do not

- Do not copy a subject, a message, a name or an address from a request into a ticket or a log line (SC-15): use the protocol and the request id.
- Do not delete a `supportRequests` document to "stop" a retry: set the flag off, or fix the cause.

## Steps

1. `jobexecutions`: the latest `support-mail` rows. A `FAILED` row with `MAIL_GAVE_UP` means a request ran out of retries; another code means a whole run failed (database). No row is normal when nothing was owed.
2. Backend logs: `Support mail confirmation failed for request <id>: <code>` and `... team_notice failed ...` name the request and the failure kind. Check the SMTP settings (`SMTP_*`, `EMAIL_FROM`) and the provider's status first, and that `SUPPORT_EMAIL` is a mailbox somebody reads.
3. Once the cause is fixed, requests still retrying send by themselves. For one that **gave up**, ask the engineer on call to clear `mailGaveUpAt` and set `mailNextAttemptAt` to now on that request (a reviewed one-off, never a laptop script against production: DEVELOPMENT §6); the next run delivers what is still owed. A request that gave up has its team notice unsent only if `teamNoticeSentAt` is absent: read the request in the database by its protocol and answer the requester from the support mailbox.
4. To pause delivery during an incident, set `SUPPORT_MAIL_JOB_ENABLED=false` and redeploy; requests keep being stored and their first attempt is still made. Switch it back on afterwards.
