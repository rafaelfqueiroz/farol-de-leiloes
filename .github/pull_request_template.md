## What
<!-- One or two sentences. -->

## Spec
Implements SPEC-NNN — rules BR-NNN-nn, BR-NNN-nn
Spec page: https://github.com/rafaelfqueiroz/farol-de-leiloes/wiki/SPEC-NNN-...
Part of #NN <!-- or "Closes #NN" when this PR completes the spec's issue -->
Frame link (new or changed pages): <!-- approved page frame, DS-30; delete otherwise -->

## Acceptance criteria
<!-- Copy the relevant checkboxes from the spec; tick what this PR satisfies. -->
- [ ] ...

## How it was verified
<!-- Commands run, tests added, manual steps. UI: screenshots light + dark, desktop + 360 px. -->

## Checks
- [ ] `npm run check` passes in every package touched
- [ ] Tests cover the new behaviour; domain rules tested with hand-computed values (TS-04, TS-08)
- [ ] New owned collection → `ownerType`/`ownerId`, owner-scoped repository, isolation spec (AR-11–AR-16)
- [ ] Money as `Decimal`, time through `Clock` and Brasília helpers (AR-17, AR-24)
- [ ] No personal or client data in logs, errors, Sentry or AI prompts (SC-15, SC-22)
- [ ] New personal data field → LGPD inventory updated (SC-25)
- [ ] User-facing text through next-intl, theme tokens only (DS-20, DS-01)
- [ ] Endpoints documented with OpenAPI decorators (AR-33)
- [ ] Docs and `.env.example` updated (DV-29, AR-44)
- [ ] Touches auth, authorization, payments, uploads, AI or the scraper → security review done (SC-33)
