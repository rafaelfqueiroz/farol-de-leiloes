# Architecture Decision Records

Spec Decision Logs (`DL-NNN-nn`) record **product** decisions. ADRs record **technical** decisions taken during implementation that the specs did not anticipate (DEVELOPMENT §10).

Write one when a choice is hard to reverse, contradicts a guideline, adds a dependency that overlaps a canonical one, or is one a future reader would otherwise reopen (DV-31). Never edit a decided ADR — supersede it with a new one and link both ways (DV-32).

Files are `NNN-short-title.md`, numbered in order, starting from the template below.

| ADR | Title | Status |
|---|---|---|
| — | *None yet* | |

## Template

```markdown
# ADR-NNN — Title

**Status:** Proposed | Accepted | Superseded by ADR-NNN
**Date:** YYYY-MM-DD
**Related:** SPEC-NNN, AR-nn, #issue

## Context
What forced a decision.

## Options
What was considered, and what breaks under each.

## Decision
What was chosen.

## Consequences
What this makes easy, what it makes hard, what it forecloses.
```
