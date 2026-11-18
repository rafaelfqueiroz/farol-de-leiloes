# Stripe billing — setup, checks and what to do when a subscription looks wrong

**Use when:** setting Stripe up for the first time (or for a new account/mode), a customer says their plan is not what they paid for, a payment went through and the office did not appear, or the daily reconcile job reports failures.

**Governs:** SPEC-012 (BR-012-09, BR-012-13, BR-012-16..BR-012-21, BR-012-29), [ADR-005](../adr/005-office-subscriptions-on-stripe.md), ARCHITECTURE §13, SECURITY SC-11.

## Known gaps

- **Hosting is not live yet** ([ADR-002](../adr/002-hosting-and-environments.md)) and production holds placeholder Stripe keys: nothing below has run against a real account. Run the whole [setup](#setup-owner-actions) in **test mode** first.
- **Whether Stripe accepts every plan change we send is unverified** (interval changes with `pending_if_incomplete`, a price change while a schedule is attached): see "A customer says the plan is wrong" and verify in test mode.
- **Offices do not exist until SPEC-011.** A first checkout answers `OFFICE_CREATION_UNAVAILABLE` (503) and charges nothing until that spec binds `OFFICE_PROVISIONER`. A paid checkout for an existing office needs no provisioner.
- **No alert on a failing reconcile run.** It is recorded in `jobexecutions` (`subscriptions-reconcile`, `PARTIAL_FAILURE` when some record could not be read) and logged, but nobody is paged.
- **A duplicate payment is cancelled, not refunded, by the code.** The warning "duplicates ... refund by hand" names ids; refund in the Stripe dashboard.

## Setup (owner actions)

All of it per Stripe account and per mode (test, live). Nothing here is a secret except the first two.

1. **Prices.** In Stripe, create one recurring **BRL** Price per plan (monthly or yearly). Prices are immutable at Stripe: a new price is a new plan code in the catalog and the old plan is withdrawn (subscribers keep paying the old one).
2. **Catalog.** Write a `catalog.json` (see `backend/README.md`) and run `npm run plans:upsert -- --file catalog.json` against the target database. The script reads each price from Stripe and **refuses** (`refused_price_mismatch`, exit 1, nothing written) a price that does not exist, is archived while the plan is offered, or differs in amount, interval or currency from the file. Re-run the same file after a crash: it is idempotent.
3. **Webhook.** Endpoint `https://<api-domain>/api/payments/webhook`, listening to exactly: `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Store the signing secret as `STRIPE_WEBHOOK_SECRET` (secret).
4. **Dunning ends in CANCEL.** Stripe Dashboard → Settings → Billing → Subscriptions and emails → *Manage failed payments*: Smart Retries on, and after the last retry **cancel the subscription** (not "mark as unpaid", not "leave as is"). The product reads `canceled` as `LAPSED` and starts the 10-day grace period; the reconcile job assumes a subscription that stops being paid ends. Check it again after any change to Stripe's billing settings.
5. **Billing Portal restricted.** Dashboard → Settings → Billing → *Customer portal* → create a configuration that allows **only** updating the payment method and viewing invoices: **no** subscription cancellation, **no** plan switching, **no** quantity change. Those go through our endpoints, which apply the upgrade/downgrade timing (BR-012-16, BR-012-17), the 7-day refund (BR-012-29) and the read-only rules. Put the configuration id (`bpc_...`) in `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` (a variable, not a secret). **Required before the portal works in production**: the variable is optional for the deploy, but with `NODE_ENV=production` and no id the billing-portal route answers `BILLING_PORTAL_FAILED` (502) and logs a warning, because Stripe would otherwise use the account's default configuration, which may allow what we forbid. Outside production the default configuration is used.
6. **Refunds.** The 7-day full refund (`REFUND_WINDOW_DAYS`, default 7) is made by the API through Stripe, to the original payment method; the Stripe account must allow refunds on its payment methods. Pending the lawyer's confirmation (Q-21).
7. **Variables** (`gh variable set ... --env deploy-production`): `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`, `SUBSCRIPTIONS_RECONCILE_ENABLED` (leave unset or `true`), `SUBSCRIPTION_GRACE_DAYS`, `REFUND_WINDOW_DAYS`. Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
8. **Migrations** `0006` and `0007` ran in the deploy's migration step (they build the unique indexes the guarantees rest on).

## The daily reconcile job

`subscriptions-reconcile` runs at 03:30 Brasília time, in the API process, under a run lock (a document of the event ledger with an expiry), so two replicas do not both run it; a run that finds the lock held logs "skipped: another instance is running it" and records nothing. In order it:

1. **Finishes refunds left half done**: a subscription still in effect with a refund requested or made (the money went back, or was about to) is ended at the provider and re-read (LAPSED, the grace period starts). A live claim is another member's cancel in progress and is left alone.
2. **Asks Stripe about checkouts that have a session and no subscription of ours after 10 minutes.** A session the buyer PAID is read through the normal sync, as if its events had arrived: the office is created, a duplicate payment is cancelled (refund it by hand). An expired session is removed; one still open after 24 hours is closed and removed. A record is **never** removed unless Stripe confirms its session expired: if Stripe cannot be reached the record stays and the run is recorded `PARTIAL_FAILURE`. The success page does the same for its own buyer when it is opened.
3. **Re-reads** every subscription with a provider id that is not lapsed (and those lapsed in the last 14 days) last synced more than 12 hours ago, oldest first, at most 200 per run. A record it cannot read is marked and sorts after the others next time.
4. **Removes** checkouts whose creation never finished (no session id) after 3 days.

- **Did it run?** `jobexecutions` rows with `jobName: "subscriptions-reconcile"`; `status: FAILED` with `errorCode: PARTIAL_FAILURE` means some item could not be handled (Stripe unreachable, a subscription deleted at Stripe); any other `errorCode` is the run failing as a whole.
- **Read the log line:** `Subscriptions reconciled: N re-read, M healed, F failed, P abandoned checkouts removed, R paid checkouts recovered, X refunds finished`. `healed` is the number of records whose status was wrong: a few means a webhook was lost (check the endpoint in Stripe → Developers → Webhooks → failed deliveries); many means the endpoint is broken. `recovered` above zero means payments whose events never arrived.
- **Switch it off** with `SUBSCRIPTIONS_RECONCILE_ENABLED=false` (and redeploy); the webhook still works.
- It changes our copy, creates the office of a recovered payment, cancels a duplicate it finds (through the normal sync) and finishes a refund that was already made. It never starts a refund and never cancels a subscription by itself otherwise.

## A customer says the plan is wrong

1. **They paid and have no office / no plan.** The checkout success page shows "awaiting payment confirmation" until the provider's confirmation is processed. Stripe Dashboard → Developers → Webhooks → the endpoint: failed deliveries are retried for about 3 days. A delivery answering 503 `WEBHOOK_BUSY` is retried; 5xx on `checkout.session.completed` for a first subscription usually means `OFFICE_PROVISIONER` is not bound yet (SPEC-011). Once the endpoint is healthy the event processes by itself; otherwise the next reconcile run re-reads the subscription (the record carries the ref in the provider subscription's metadata). **Do not** edit `subscriptions` by hand: the provider is the source of truth, and the next sync would overwrite it.
2. **They upgraded and the limit did not rise, or the change was refused (`CHANGE_PLAN_FAILED`).** The upgrade is billed immediately but takes effect when the prorated invoice is **paid** (`pending_if_incomplete`). If the invoice failed, the plan stays as it was; the customer updates the card (billing portal) and tries again. `CHANGE_PLAN_FAILED` means Stripe rejected the change and nothing was changed (a scheduled downgrade is kept): **verify in Stripe test mode** that an upgrade works across billing intervals (monthly to yearly) with `pending_if_incomplete`, and on a subscription that still has a downgrade schedule attached; a combination Stripe refuses has to be offered another way before launch.
3. **They cancelled within 7 days and were not refunded.** Cancelling the office's *first* paid subscription inside the window refunds in full: check `refundedAt` on the record and the refunds in Stripe (idempotency key `refund:<subscription ref>:<invoice id>`, one per paid invoice). Not eligible: a later subscription of an office that already paid for one (a first subscription that was free, with a 100% coupon, does not count), a request made exactly 7 days or more after the first confirmed payment (a request accepted inside the window and retried later still completes), or already refunded.
4. **Two subscriptions for one office.** The code keeps the one paid first and cancels the other at Stripe (a warning names both ids). **Refund the cancelled one by hand** in the dashboard.
5. **A refund is half done** (refund made, subscription still active). The next reconcile run finishes it, or ask a member to press cancel again: the retry reads the provider's own refunded amounts, finds nothing left to refund and only records it and ends the subscription. A member who gets "another member is already cancelling" (`CANCEL_IN_PROGRESS`) should wait a few minutes: a claim whose holder died expires after 5 minutes.
6. **The refund covers more than the first charge.** "A full refund" is every paid invoice of the first subscription, so an upgrade paid inside the 7 days is refunded with it; an unpaid proration invoice is voided. Check the invoices in the Stripe dashboard (keys `refund:<subscription ref>:<invoice id>`).

## A customer says the plan page shows a wrong amount or no history

- **The amount an upgrade will charge** (`POST /api/office/subscription/change-preview`) is Stripe's own upcoming-invoice figure for the same `always_invoice` proration the change uses, read at that moment: it can differ from what is charged by the cents of the seconds in between, and an annual switch shows the new price minus the credit for the unused time. `CHANGE_PREVIEW_FAILED` (502) means Stripe could not compute it: nothing was changed; if it persists, check Stripe's status and that the target price is active.
- **The billing history** (`GET /api/office/subscription/invoices`) shows the newest 100 invoices of the Stripe customer (six a page, cached 30 s per customer); older ones are in Stripe or in the billing portal. `BILLING_HISTORY_UNAVAILABLE` (502) means Stripe could not be read; the plan page itself does not depend on it. A refunded first subscription shows its invoices with the amounts charged, not the refund.
- **A scheduled change shows "Desfazer mudança"**: it is the member choosing the plan already in effect, which releases the subscription schedule at Stripe. If a schedule exists at Stripe that the page does not show, the next sync (webhook or daily job) reads it.

## What not to do

- Do not change a subscription's plan, status or dates in the Stripe dashboard to "fix" it unless you also expect the next sync to follow it: the dashboard is the provider, and the product will reflect whatever it says.
- Do not delete the webhook endpoint to "stop" retries: a confirmed payment would then wait for the daily reconcile run.
- Do not paste a customer's name, e-mail or card details into an issue or a log (SC-32): use the subscription ref and the office id.
