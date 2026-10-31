# Security and LGPD Guidelines

| | |
|---|---|
| **Status** | Draft v1.0 |
| **Companion docs** | [ARCHITECTURE.md](ARCHITECTURE.md), [TESTING.md](TESTING.md), [DEVELOPMENT.md](DEVELOPMENT.md) |
| **Specs** | [SPEC-001](https://github.com/rafaelfqueiroz/farol-de-leiloes/wiki/SPEC-001-Accounts-Authentication) accounts · [SPEC-002](https://github.com/rafaelfqueiroz/farol-de-leiloes/wiki/SPEC-002-Access-Control-Isolation) isolation · [SPEC-004](https://github.com/rafaelfqueiroz/farol-de-leiloes/wiki/SPEC-004-Caixa-Daily-Import) import · [SPEC-010](https://github.com/rafaelfqueiroz/farol-de-leiloes/wiki/SPEC-010-Privacy-Data-Rights) privacy |

The specs say **what** must hold; this document says **how the code makes it hold**. Rules are numbered `SC-nn`. Where a spec rule already says it, the guideline cites it rather than restating it.

## 1. What we protect, and from what

| Asset | Worst realistic failure |
|---|---|
| An office's clients, journeys, costs and documents | Another office — possibly a competitor — reads them, or learns the client exists (SPEC-002 BR-002-04) |
| Investor profiles and holdings | Financial position exposed to a stranger |
| Documents in R2 (matrículas, contracts, IDs) | A leaked or long-lived link |
| Third parties in those documents (previous owners, occupants) | Profiling people who never signed up (SPEC-010 BR-010-25, PRD constraint) |
| Accounts and sessions | Takeover through a stolen token or brute force |
| Payments state | A forged webhook upgrading a plan |

## 2. Authentication

| | |
|---|---|
| **SC-01** | Passwords are hashed with `bcrypt`, cost ≥ 10, never logged, emailed or returned (SPEC-001 BR-001-12). Length 8–128, no composition rules (BR-001-13). |
| **SC-02** | **The session token lives only in an `httpOnly`, `Secure`, `SameSite=Lax` cookie** set by the server. Never `localStorage`, `sessionStorage`, a URL or a JS-readable cookie. State-changing requests rely on `SameSite` plus an `Origin` check; a cross-site form cannot act. |
| **SC-03** | A valid signature is not enough: every authenticated request checks the account's current status (deactivated, closed) and current memberships (SPEC-001 BR-001-16, SPEC-002 BR-002-15). Sign-out and password change invalidate existing sessions through a per-account session version. |
| **SC-04** | Sign-in, sign-up, password reset and confirmation resend are throttled with `@nestjs/throttler`, per email and per origin, at the limits SPEC-001 BR-001-15 sets. |
| **SC-05** | Responses never reveal whether an email has an account: same message and same timing on sign-in failure and reset request (BR-001-14). |
| **SC-06** | One-time tokens (email confirmation, password reset, invitation) are ≥ 32 random bytes from `crypto.randomBytes`, stored **hashed**, single-use, and expire (1 hour unless a spec says otherwise). |

## 3. Authorization

| | |
|---|---|
| **SC-07** | **Deny by default.** `JwtAuthGuard` is registered globally; a public endpoint opts out with `@Public()`, which a reviewer reads as a decision. |
| **SC-08** | Ownership and permission are enforced on the server on every request, through the scoped repositories and `AccessContext` of ARCHITECTURE §4 (AR-11–AR-16). Hiding a button is never the control (BR-002-10). |
| **SC-09** | Admin capability grants no client data (BR-002-23). Reads under a support access grant go through a dedicated, read-only, logged path (BR-002-24–BR-002-27); there is no "admin bypass" flag on scoped repositories. |

## 4. Input and output

| | |
|---|---|
| **SC-10** | Every input is a validated DTO (AR-34). Request values never become MongoDB operators: no spreading `req.query`/`req.body` into a filter, `sanitizeFilter: true` and `strictQuery: true` on the connection, and any free-form sort/filter field is checked against an allowlist. |
| **SC-11** | The Stripe webhook verifies the signature against the **raw** body, is idempotent by event id, and is the only path that changes plan state. The checkout redirect never upgrades anything. |
| **SC-12** | CSV/XLSX exports neutralise cells starting with `=`, `+`, `-`, `@`, tab or carriage return (formula injection). |
| **SC-13** | Uploads (SPEC-017) go straight to R2 through a presigned URL scoped to one key, with an allowlist of content types, a size cap, and the type re-checked from the stored object's bytes before it is marked usable. Files are never served from the application origin. |
| **SC-14** | The server never fetches a URL a user supplied. Outbound requests go only to configured hosts (Caixa, Stripe, OpenAI, R2, mail/SMS providers). |

## 5. Data protection in the running system

| | |
|---|---|
| **SC-15** | **No personal or client data in logs, error messages, Sentry, analytics or job records** — no names, emails, phones, CPFs, journey content, figures, profiles or support messages (SPEC-002 BR-002-28). Ids, codes and counts only; a user appears as a hashed id (AR-46, AR-47). |
| **SC-16** | Secrets come from the environment only, are validated at boot (AR-41), never logged, never committed, never sent to the browser. A `NEXT_PUBLIC_` variable is public by definition and never holds a secret. |
| **SC-17** | Transport and headers: HTTPS only with HSTS; `helmet` on the API; on the web, an explicit Content-Security-Policy (no `unsafe-eval`; `unsafe-inline` only where MUI's style injection needs it, with a nonce when available), `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`. CORS is an explicit allowlist, never `*` with credentials. No `dangerouslySetInnerHTML` with anything not sanitised. |
| **SC-18** | R2 buckets are private. Download links are issued per request after an authorization check and expire in 60 seconds (BR-002-09); they are never stored, emailed or logged. Object keys are random and carry no personal data. |

## 6. Supply chain

| | |
|---|---|
| **SC-19** | `npm audit --audit-level=high` blocks CI in both packages; CodeQL runs on every PR. A high or critical advisory with no fix is waived only by an issue that names the exposure and the date to recheck. |
| **SC-20** | A new dependency must be maintained (a release in the last 12 months), have a permissive licence, and not duplicate a canonical one (DEVELOPMENT §1). Install scripts from a new dependency are read before it is merged. |
| **SC-21** | GitHub Actions are pinned to a commit SHA, workflows declare least-privilege `permissions:`, and `pull_request_target` is not used. |

## 7. AI features

| | |
|---|---|
| **SC-22** | Only what the feature needs reaches the model. Natural-language search sends the query text, never account data. Document analysis (SPEC-024) is disabled in production until the lawyer's validation is recorded (SPEC-010 BR-010-25), and sends no more of a document than the analysis needs. Requests to OpenAI opt out of training/retention where the API allows. |
| **SC-23** | Model output is untrusted input. It is parsed against a schema (Zod) into a DTO and validated like any request (SC-10); it is never executed, never used as a query operator, and never rendered as HTML. Text from documents is data, never instructions to the model (prompt injection). |

## 8. Third-party sources

| | |
|---|---|
| **SC-24** | **Scraping Caixa is polite and undisguised** (SPEC-004 BR-004-18, BR-004-20, DL-004-11, D-50): an honest user agent, the configured daily budget, concurrency and pause, public listing data only, and the run **stops** on any block, challenge or rate-limit page. No stealth plugins, fingerprint spoofing, CAPTCHA solving, proxy rotation or other bot-detection evasion — a review of the collection code must find none. Caixa HTML is untrusted: parsed with `cheerio`, never rendered raw. |

## 9. LGPD

### Roles

| Role | Who |
|---|---|
| Controlador | **TBD** — depends on the partnership terms with Efetive (open in the PRD). |
| Encarregado (DPO) | **TBD** — named in the privacy policy before the F1 launch. |
| Operadores (subprocessors) | Table below. |

### Data inventory

The inventory is the source the privacy policy is written from (SPEC-010 BR-010-02, BR-010-06). Legal bases are **proposed** and become final with the lawyer's validation (BR-010-26, Q-21).

| Data | Where | Purpose | Proposed legal basis (LGPD) | Retention |
|---|---|---|---|---|
| Name, email, phone, password hash, Google id | `users` | Account and sign-in | Contract — art. 7º V | Until deletion + 30 days (BR-010-15) |
| Terms/policy acceptances, WhatsApp consent | acceptance records | Proof of acceptance and consent | Legal obligation / accountability — art. 7º II, art. 8º §2º | Lawyer-set (Q-21); not deleted until set |
| Favorites, saved filters, alerts, reminders, notification preferences | own collections | Features the account uses | Contract — art. 7º V | Until deletion + 30 days |
| Investor profile (budget, purpose, financing need) | profiles | Radar and match score (SPEC-013) | Contract — art. 7º V | Until deletion + 30 days (BR-010-17) |
| Journeys, costs, contributions, history | journeys | Acquisition management (SPEC-016, SPEC-018) | Contract — art. 7º V | With the owner; pseudonymised on removal (BR-010-28) |
| Journey documents and photos | R2 | Acquisition management (SPEC-017) | Contract — art. 7º V | 5 years after closing (BR-010-18) |
| Third parties inside documents (previous owners, occupants) | R2, legal analysis | Legal/procedural analysis (SPEC-015, SPEC-024) | Legitimate interest / regular exercise of rights — art. 7º IX / VI, **pending validation** | With the document; features disabled until validated (BR-010-25) |
| Billing records, Stripe customer id | `users`, Stripe | Subscriptions | Contract; tax legal obligation — art. 7º V, II | Tax period (Q-21) |
| Support requests | support | Support (SPEC-009) | Contract — art. 7º V | Lawyer-set |
| Admin access log | access log | Accountability for support grants (BR-002-27) | Legitimate interest / accountability — art. 7º IX | Lawyer-set (BR-010-23) |
| Caixa listings | `auctions` | Search | Public data, not personal | — |

| | |
|---|---|
| **SC-25** | **A PR that adds a field holding personal data updates this inventory** in the same PR: what, where, purpose, basis, retention. A field with no stated purpose is not collected (BR-010-06). |
| **SC-26** | Minimisation in code: collect only what a spec requires; never store a CPF unless a spec requires it; never derive profiles of third parties from CPF or name (PRD constraint, BR-010-25). |
| **SC-27** | Data-subject rights are product features, not manual procedures: access, export, correction and deletion follow SPEC-010 BR-010-08–BR-010-17. Every new owned collection decides, in its PR, what the export includes and what deletion does to it. |
| **SC-28** | Retention periods are typed settings (AR-43), enforced by a daily purge job that logs counts, never content (BR-010-21). Data is never deleted inline in a request (AR-31). |
| **SC-29** | Consent is separate, specific and unticked by default where consent is the basis (WhatsApp, BR-010-27); every acceptance is recorded with versions, time and method (BR-010-03). |

### Subprocessors and international transfer

| Subprocessor | Purpose | Location |
|---|---|---|
| Stripe | Payments | US |
| OpenAI | Natural-language search, document analysis | US |
| Cloudflare R2 | Files | Global |
| Google | Sign-in | US |
| Sentry | Error tracking (scrubbed, SC-15) | US |
| SMTP provider | Email | TBD |
| SMS / WhatsApp provider | Notifications | TBD |
| Hosting + MongoDB | Runtime | TBD (BL-001) |

| | |
|---|---|
| **SC-30** | Adding a subprocessor updates this table and the privacy policy before it receives data. Every non-Brazilian location is an international transfer (LGPD art. 33) and must be disclosed. |
| **SC-31** | A personal-data incident follows [the incident-response runbook](../runbooks/incident-response.md), including notification to the ANPD and data subjects within 3 business days where required (Resolução CD/ANPD nº 15/2024). |
| **SC-32** | Real personal data never enters the repository, issues, PR descriptions, screenshots or AI-agent prompts — including data copied from production to reproduce a bug (TS-27). |

## 10. Security in the lifecycle

| | |
|---|---|
| **SC-33** | A PR that touches authentication, authorization, scoped repositories, payments, uploads, AI prompts or the scraper ticks the security items of the PR template, and gets a security review pass (`/security-review` in Claude Code, or a manual read against this document) before merge. |
| **SC-34** | A suspected vulnerability is reported privately (GitHub private vulnerability reporting), never in a public issue. `SECURITY.md` at the repository root says so. |

## 11. Known violations

Code that predates these guidelines and breaks them. Each has a follow-up issue; new code must not copy the pattern.

| Rule | Where | Today |
|---|---|---|
| SC-02 | `frontend/app/contexts/AuthContext.tsx` | JWT in `localStorage` |
| SC-03 | `backend/src/auth/` | 7-day JWT with no per-request status/version check |
| SC-04 | `backend/src/auth/` | No throttling |
| SC-07 | `backend/src/main.ts`, controllers | Guards per route, not deny-by-default |
| SC-17 | `backend/src/main.ts`, `frontend/next.config.ts` | No `helmet`, no CSP |
| SC-24 | `backend/src/auctions/scraper/details-scraper.ts` | `puppeteer-extra-plugin-stealth` |
| AR-11–AR-16 | all user-data modules | No `ownerType`/`ownerId`, no scoped repositories, no isolation tests |
| AR-45 / DV-11 | 75 call sites | `console.*` |
| DV-01 / DV-02 | `backend/tsconfig.json`, 54 sites | `noImplicitAny: false`, explicit `any` |
