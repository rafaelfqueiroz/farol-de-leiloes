# Design System

| | |
|---|---|
| **Status** | Draft v1.0 — structure and rules. **Brand values pending** (§2) |
| **Companion docs** | [ARCHITECTURE.md](ARCHITECTURE.md), [TESTING.md](TESTING.md) |
| **Specs** | [SPEC-003](https://github.com/rafaelfqueiroz/farol-de-leiloes/wiki/SPEC-003-Platform-Qualities) BR-003-11–BR-003-22 (responsive, accessibility, language and formats) |

How the interface is built: tokens, theming, colour semantics, typography, layout, components, text and accessibility. Rules are numbered `DS-nn`.

The system is built **on MUI**. MUI supplies the primitives and their behaviour; the project owns the theme (the tokens), the patterns built from MUI, and the rules about how pages use them. Tailwind is not used (DS-23).

> **Brand identity is decided separately.** This document fixes the token *structure* and the rules every screen follows. The brand values — palette, typeface, radius scale — are chosen in the design-system task; until it lands, the current values in `frontend/app/theme.ts` stand. Changing the brand then means changing the theme, not the screens. That is the test of whether these rules are being followed.

## 1. Layers

| Layer | Where | Owns |
|---|---|---|
| Tokens | `frontend/app/theme/` (`createTheme` with `colorSchemes`) | Named values: palette, typography, spacing, shape, shadows, breakpoints. No opinion about usage |
| Primitives | MUI (`@mui/material`), styled through the theme's `components` overrides | Button, TextField, Select, Dialog, Chip, Card, Table, Tabs, DatePicker… |
| Patterns | `frontend/app/components/patterns/` | `PageShell`, `PageHeader`, `EmptyState`, `ErrorState`, `Money`, `DateText`, `StatusBadge`, `DataTable`, `ConfirmDialog`, `FilterDrawer` |
| Feature components | `frontend/app/components/<feature>/` | `AuctionCard`, `JourneyTimeline` — one feature's composition |
| **Pages** | `frontend/app/**/page.tsx` | Screen composition. **Not part of the design system** |

**DS-01 — A component never hardcodes a colour, font size, radius, shadow or pixel spacing.** Every value comes from the theme: `sx={{ color: 'text.secondary', p: 2, borderRadius: 1 }}`, `theme.palette.*`, `theme.spacing()`, a typography `variant`. No hex, `rgb()`, `px` literal or `fontSize: 13` in `sx`, `styled()` or inline `style`. Lint enforces the hex/px half (TESTING §9).

**DS-02 — Something belongs in the system when a second, unrelated screen would need the exact same thing.** A status badge: yes. The journey timeline: no — it is one feature's answer to one spec and lives with the feature.

**DS-03 — A pattern knows nothing about the domain**, with deliberate exceptions that need exactly one home: `Money` (AR-21, BR-003-19) and `DateText` (AR-23, BR-003-20).

## 2. Tokens

The vocabulary is MUI's palette, extended through module augmentation (`theme.d.ts`) so project tokens are type-checked:

| Token | Means |
|---|---|
| `primary` | The brand. Primary actions, links, current navigation, focus |
| `secondary` | Supporting brand accent |
| `background.default` / `background.paper` | Page and raised surfaces (cards, menus, dialogs) |
| `text.primary` / `text.secondary` / `text.disabled` | Text emphasis levels |
| `divider` | Hairlines between regions |
| `error`, `warning`, `info`, `success` | Feedback: form errors, alerts, toasts |
| **`status.onTime` / `status.late` / `status.done` / `status.cancelled` / `status.neutral`** (+ `Surface`) | Project addition. State of a journey, phase or reminder — text on its own surface |
| **`figure.positive` / `figure.negative`** | Project addition. A figure that went up or down (ROI, discount vs appraisal) — never an action |
| **`destructive`** | Project addition. A dangerous action — delete, remove member, cancel journey |
| `shape.borderRadius` + the radius scale | Two radii: panels and controls. Values with the brand |
| `typography.*` variants | The only font sizes and weights in the product (DS-11) |
| `spacing` | The 8 px base unit; every gap, margin and padding is a multiple via `theme.spacing` |

**DS-04 — Tokens are CSS variables.** The theme is created with `cssVariables: true`, so components read `var(--mui-palette-…)` and the colour scheme switches without re-rendering. Raw `colors.*` constants are not exported for use outside the theme.

**DS-05 — Every token is defined in both colour schemes.** A token that exists only in `light` is a dark-theme gap. A structural test fails when the `light` and `dark` palettes don't have the same keys.

**DS-06 — `destructive`, `figure.negative`, `error` and `status.late` are not interchangeable**, even when they share a hue. A delete button is not a loss; a late phase is not a form error. Picking the token by meaning is what lets the brand change later without breaking semantics.

## 3. Theming

**DS-07 — Three states: light, dark and system.** MUI `colorSchemes: { light, dark }` with `colorSchemeSelector: 'class'`; the default mode is `system`; the user's explicit choice is persisted and wins. `InitColorSchemeScript` in the root layout prevents a flash of the wrong scheme. One `ThemeProvider` (with `AppRouterCacheProvider`) in the root layout — never one per page.

**DS-08 — Contrast is measured, not eyeballed.** A structural test computes contrast from the theme for every text/surface pair the tokens promise, in both schemes: 4.5:1 for text, 3:1 for control borders, focus rings and icons that carry meaning (WCAG 2.1 AA, BR-003-14). axe in E2E covers what is actually rendered (TS-23).

**DS-09 — The dark scheme is layered.** `background.default` < `background.paper` < raised surfaces in lightness, so a card is visible because it is lighter than the page — not because of a border or a shadow, which dark backgrounds swallow.

## 4. Colour

**DS-10 — Colour never carries meaning alone** (BR-003-15). A status shows its label ("No prazo", "Atrasada"); a figure shows its sign or an arrow; a chart has its values available as text or a table. Icons that convey state have an accessible name.

**DS-24 — The brand marks what the user can do** — a button, a link, the current destination, focus. Figures are `text.primary`, or `figure.*` with a sign. A brand-coloured number reads as a link.

## 5. Typography and numerals

**DS-11 — Only theme typography variants** (`h1`–`h6`, `subtitle1/2`, `body1/2`, `caption`, `overline`, `button`). No ad-hoc `fontSize`/`fontWeight`. A missing size is a new variant in the theme, added in the design system, not on a page.

**DS-12 — Money, areas, counts and dates in tables render with `font-variant-numeric: tabular-nums`**, built into `Money`, `DateText` and `DataTable`. Columns of values must line up.

The typeface is part of the brand decision (§2). Until then: the system font stack in `theme.ts`, no webfont.

## 6. Layout and responsiveness

**DS-13 — Phone first, from 360 px wide, with no horizontal page scroll** (BR-003-11, BR-003-12). Wide tables scroll inside their own container or collapse to a card list. Every screen is checked at 360 px and desktop (TS-23).

**DS-14 — Pages lay out with `Stack`, `Grid` and `Container` using theme spacing**, and with `PageShell` for the page frame and its single width. Breakpoints come from the theme (`{ xs, sm, md }` objects in `sx`), never media queries with pixel values.

**DS-15 — One `<h1>` per page, via `PageHeader`.** Heading levels follow the outline; a visual size never picks a heading level.

**DS-16 — Touch targets are at least 44 × 44 px** on interactive controls, including icon buttons in cards.

## 7. Components

**DS-17 — Reach for what exists, in this order:** an MUI component as is → a theme variant or `components` override → a pattern → a new component. A new component is a permanent maintenance obligation.

**DS-18 — Restyling an MUI component for the whole product happens once, in the theme's `components` overrides** (`MuiButton`, `MuiCard`, …), not by repeating the same `sx` on every instance.

**DS-19 — Every pattern handles its four states:** loading (skeletons, not spinners for content), empty (`EmptyState` with a next action), error (`ErrorState` with retry, the message from the error code, AR-39), and populated.

**DS-25 — Icons come from `@mui/icons-material` only.** Decorative icons are `aria-hidden`; an icon-only button has an `aria-label` from the catalogue.

**DS-26 — Dates use `@mui/x-date-pickers` with the date-fns adapter, `ptBR` locale and the Brasília zone** (AR-23), accept typed input in `dd/mm/aaaa` (BR-003-20), and are keyboard operable (BR-003-16).

**DS-27 — Destructive actions confirm through `ConfirmDialog`**, which names what will be lost and puts the safe action first. Irreversible ones (delete account, cancel journey) say so in words.

## 8. Text

**DS-20 — No string literals in components.** Every user-facing string — labels, `aria-label`s, placeholders, errors, toasts, empty states, emails — comes from the next-intl pt-BR catalogue (`frontend/messages/pt-BR.json`). Enforced by `react/jsx-no-literals` (TESTING §9). pt-BR is the only locale; the catalogue exists so the vocabulary is consistent and checkable (BR-003-18), not because a second language is planned.

**DS-28 — One concept, one wording.** Auction terms are Caixa's (*modalidade*, *edital*, *matrícula*, *arremate*, *desocupação*); journey phases use the PRD's names. A second catalogue string for an existing concept is a review failure.

**DS-29 — Numbers and dates are formatted only through the shared formatters** (`Money`, `DateText`, `formatPercent`, `formatArea`): `R$ 1.234,56`, `dd/mm/aaaa HH:mm`, `12,5%`, `1.250 m²` (BR-003-19–BR-003-21).

## 9. Accessibility

**DS-21 — Accessible before pretty.** WCAG 2.1 AA (BR-003-14): every flow works by keyboard alone and with a screen reader (BR-003-16); focus is always visible (never `outline: none` without a replacement); every form control has a visible label; errors are announced and tied to their field (`aria-describedby`); dialogs trap and return focus; motion respects `prefers-reduced-motion`.

**DS-22 — Accessibility is tested where it can be:** axe in every component test (TS-19) and on every E2E page (TS-23); contrast by the token test (DS-08). The manual keyboard and screen-reader pass at the end of each milestone (BR-003-17) is recorded on the milestone's issue.

## 10. What is not used

**DS-23 — Tailwind is not used.** It is removed from the frontend; the three files that use `className` utilities are migrated to `sx`/theme. Two styling systems means two sets of tokens that drift. Likewise no CSS modules, no global CSS beyond the MUI baseline, and no second component library.

## 11. Known gaps

| Rule | Today |
|---|---|
| §2 | Brand values not decided; `theme.ts` V2 palette stands meanwhile |
| DS-04, DS-05, DS-07 | Light theme only, no `colorSchemes`, no CSS variables |
| DS-07 | `ThemeProvider` repeated per page (`page.tsx`, `not-found.tsx`) |
| DS-01 | Hardcoded hex values in components (`#FFFFFF`, `#091413`, `#4CAF50`…) and colours in theme typography |
| DS-20 | Strings are literals; next-intl not installed |
| DS-23 | Tailwind installed and used in 3 files |
| DS-26 | Date pickers on `dayjs` |
