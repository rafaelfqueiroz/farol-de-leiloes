# ADR-005 — Office subscriptions on Stripe: the provider is the source of truth

**Status:** Accepted
**Date:** 2026-11-17
**Related:** SPEC-012 (BR-012-06, BR-012-08, BR-012-09, BR-012-13, BR-012-14, BR-012-21, BR-012-28), SPEC-002 (`OFFICE_PLAN_SOURCE`), SPEC-011, AR-10, AR-15, AR-17, AR-20, AR-24, SC-11, #12

## Context

SPEC-012 puts an advisor plan on an **office** and requires that state changes come only from the payment provider and are idempotent and order-independent: delivering one event twice changes nothing the second time, and the stored state ends equal to the provider's current state whatever order the events arrived in (BR-012-13). The code before it applied each Stripe event's payload to the **user**, in arrival order, with no event de-duplication.

Stripe delivers at least once, with no ordering guarantee, and retries on any non-2xx. So the handler meets: the same event twice (also concurrently), `customer.subscription.deleted` before the earlier `updated`, `invoice.paid` before `checkout.session.completed`, and a process that dies between two writes. Two further facts shape the design: there is no MongoDB replica set in the Compose and local environments (no transactions, AR-15), and the office does not exist until the first payment is confirmed, while SPEC-011, which owns offices, is not built yet.

## Options

1. **Apply each event's payload, in arrival order, with an event-id check.** Simple. It is wrong whenever order matters: a stale `updated` processed after `deleted` revives a lapsed office. De-duplicating by id does not help, the two events have different ids.
2. **Order events by their creation time and ignore older ones.** Stripe documents that `created` is not a reliable order and a retried event keeps its old time; clocks and retries make "older" a guess, and one lost event leaves the record wrong forever.
3. **Treat the event as a pointer and re-read the provider (chosen).** On any subscription-related event, retrieve the subscription from Stripe and store what it says now. A late, duplicated or reordered event then writes the same thing as the right one. Left alone, two concurrent syncs can still race: sync A reads, the provider changes, sync B reads and writes, then A writes its older read.
4. **Option 3 plus a per-record lease around read-and-write (chosen).** The record carries `syncLeaseToken` / `syncLeaseUntil`. A sync takes the lease with one conditional update, retrieves **inside** it, and writes conditional on the token, releasing it in the same write. Syncs of one subscription are strictly ordered, so each read is newer than the write before it. A busy lease is not an error to hide: the loser answers `WEBHOOK_BUSY` (503) and Stripe retries.
5. **A job that reconciles all subscriptions periodically.** A safety net, not a replacement: it leaves a window of wrong state after every event. Not needed to meet BR-012-13, and it can be added later on top of the same sync.

For the office, which does not exist at checkout:

- **A. Create the office at checkout.** An abandoned checkout would leave an office, and a payment the platform never confirmed would own one. Contradicts BR-012-07/BR-012-09.
- **B. Create it on the first confirmed payment through a port (chosen).** `OFFICE_PROVISIONER`, bound by SPEC-011, must be idempotent by `subscriptionRef` (its unique index), because two deliveries can race; our attach is a conditional update. Until SPEC-011 binds it, the default fails closed and the billing PR refuses a checkout that could not get its office.

## Decision

- **Stripe is the source of truth for a subscription; we store a synchronised copy.** The webhook verifies the signature over the raw body, records the event by its id (`paymentEvents`, unique), and **never reads state from the payload**: it resolves our record (provider id, else the ref in the event, else the ref the provider's subscription carries), takes the lease, retrieves inside it, maps the snapshot with a pure function (`subscriptions/domain/provider-state.ts`) and writes conditional on the lease.
- **Idempotency by event id with reprocessing of the unprocessed.** A repeat of a processed event is a no-op; a repeat of one never marked processed (`processedAt` is set only after full handling) is handled again, which is safe because the sync is idempotent.
- **One in effect per office is enforced by the database**: a partial unique index on `officeId` where the office exists and the status is `ACTIVE`, `PAST_DUE` or `CANCELING`. A write it refuses means a second paid checkout; the later subscription is cancelled at the provider and synced to `LAPSED`, with a warning naming ids only.
- **The plan the access context reads is computed, not flipped**: `SubscriptionOfficePlanSource` is bound to `OFFICE_PLAN_SOURCE` in `AccessModule` only (BR-002-21) and derives `advisorPlanActive` and `readOnly` on every request from the stored `lapsedAt`, the injected clock and `SUBSCRIPTION_GRACE_DAYS`, in a pure `domain/` (100% branch). No job runs when the grace period ends, so no state can go stale; a new payment clears the lapse at the next sync.
- **Ports for what other specs own** (`OFFICE_PROVISIONER`, `OFFICE_MEMBERS_SOURCE`, `PAYMENT_FAILED_NOTIFIER`), each with a fail-closed default, bound in `SubscriptionsModule` when their spec lands. The payment-failed email is **claimed** on the event before it is sent, so a replay sends it once.
- **Our vocabulary at the port** (AR-10, AR-20): `PaymentGateway` takes and returns `Date` and `Decimal` reais and provider ids; only the Stripe adapter imports `stripe`, and the Stripe API's period-on-item and invoice-parent shapes stay inside it.
- **Plan prices are not changed in place.** A plan's provider price id never changes (subscribers keep paying it, BR-012-04); `plans:upsert` refuses a changed price id and a price id that is another plan's. A new price is a new code, and the old one is withdrawn.

## Consequences

- **Correct under duplicates, reordering and concurrency without a transaction or a replica set.** The cost is one extra Stripe API read per subscription event, and a short window in which a concurrent delivery is answered 503 and retried.
- **A confirmed payment never sits unprocessed silently**: any fault (Stripe unreachable, no office store yet) answers 5xx, leaves the event unprocessed and is retried by Stripe, which retries for days.
- **Webhook latency depends on Stripe's API.** A slow retrieve holds the lease up to 30 s; after that another sync may take it, and the first, if it ever writes, finds its token gone and writes nothing.
- **Duplicate payments are cancelled, not refunded, by the code.** The warning is the operator's signal to refund by hand; automating it belongs with the refund flow of the billing PR.
- **`pending_if_incomplete` upgrades take effect when the provider bills the new price**, which is when the proration is paid; the sync follows the price it reads (BR-012-16).
- **The email claim is at-most-once.** A crash between the claim and the send loses that email; a failed send releases the claim and is retried. Preferred over sending twice.
- **Forecloses** trusting any payload field for state, and per-user subscriptions (`users.role`, `subscriptionStatus` and the Stripe ids are no longer written; their removal is an expand/contract follow-up, AR-28).
- **Reopen if** the platform gets a replica set and a need for multi-document guarantees that the lease cannot give, or if Stripe stops allowing a retrieve inside the webhook's time budget.
