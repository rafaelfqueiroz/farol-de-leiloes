# Design System

| | |
|---|---|
| **Status** | v1.1 — brand decided (issue [#38](https://github.com/rafaelfqueiroz/farol-de-leiloes/issues/38)) |
| **Companion docs** | [ARCHITECTURE.md](ARCHITECTURE.md), [TESTING.md](TESTING.md) |
| **Specs** | [SPEC-003](https://github.com/rafaelfqueiroz/farol-de-leiloes/wiki/SPEC-003-Platform-Qualities) BR-003-11–BR-003-22 (responsive, accessibility, language and formats) |
| **Visual reference** | [Design system artifact](https://claude.ai/artifact/A4Y69knqEHAqZfQKPLrKCf) — brand book, tokens in light and dark, type scale, 33 component cards with live previews, a worked page frame. **Private to the owner until shared from its Share menu** |

How the interface is built: brand, tokens, theming, colour semantics, typography, layout, components, page frames, text and accessibility. Rules are numbered `DS-nn`.

The system is built **on MUI**. MUI supplies the primitives and their behaviour; the project owns the theme (the tokens), the patterns built from MUI, and the rules about how pages use them. Tailwind is not used (DS-23).

## Brand

| | |
|---|---|
| **Name** | **Farol dos Leilões** |
| **Personality** | Trustworthy and sober, like a bank or a brokerage: calm surfaces, white space, restrained colour, data first |
| **Palette — "Harbour navy + beam amber"** | `primary` navy `#1D3B63` carries every action. `accent` (MUI `secondary`) amber `#E5A50A` is for the logo and rare highlights only — never for actions, never as text on light grounds (use `accent-ink`), never as a warning |
| **Typeface** | **Inter**, and nothing else (§5) |
| **Shape** | 6 px controls · 10 px panels · 999 px pills |
| **Density** | Comfortable by default; compact in data tables |
| **Elevation** | Shadows only on floating layers; cards are flat — a line border in light, layering in dark |
| **Icons** | `@mui/icons-material` Outlined; filled only for a selected state (DS-25) |
| **Logo** | A geometric lighthouse — navy tower, roof and base, amber lantern and two beams, a band cut out in the ground colour — and the wordmark "Farol" (Inter 700) "dos Leilões" (Inter 500, `ink-muted`). First version, replaceable by swapping the three SVGs (`farol-mark.svg`, `farol-mark-inverse.svg`, `farol-app-icon.svg`) in `frontend/public/brand/` |
| **Scheme** | Light leads: frames are designed in light and checked in dark. The app follows the system setting with a persisted user choice (DS-07) |

The **old V2 maroon/beige palette** (replaced by the tokens in `frontend/app/theme/` in issue #38) and the **Efetive pitch deck** are *not* sources of truth. The deck is a reference document only.

**The design-system artifact is the visual reference; this document is the rulebook.** If they disagree, DESIGN.md wins and both are updated in the same PR (DV-29). Changing the brand later means changing the theme, not the screens — that is the test of whether these rules are being followed.

## 1. Layers

| Layer | Where | Owns |
|---|---|---|
| Tokens | `frontend/app/theme/` (`createTheme` with `colorSchemes`) | Named values: palette, typography, spacing, shape, shadows, breakpoints. No opinion about usage |
| Primitives | MUI (`@mui/material`), styled through the theme's `components` overrides | Button, TextField, Select, Dialog, Chip, Card, Table, Tabs, DatePicker… |
| Patterns | `frontend/app/components/patterns/` | `AppShell`, `PageShell`, `PageHeader`, `Logo`, `EmptyState`, `ErrorState`, `Money`, `DateText`, `StatusBadge`, `FigureDelta`, `StatTile`, `DataTable`, `ConfirmDialog`, `FilterDrawer` |
| Feature components | `frontend/app/components/<feature>/` | `AuctionCard`, `AuctionDetailHeader`, `KeyFactsGrid`, `JourneyTimeline` — one feature's composition |
| **Pages** | `frontend/app/**/page.tsx` | Screen composition. **Not part of the design system** |

**DS-01 — A component never hardcodes a colour, font size, radius, shadow or pixel spacing.** Every value comes from the theme: `sx={{ color: 'text.secondary', p: 2, borderRadius: 1 }}`, `theme.palette.*`, `theme.spacing()`, a typography `variant`. No hex, `rgb()`, `px` literal or `fontSize: 13` in `sx`, `styled()` or inline `style`. Lint enforces the hex/px half (TESTING §9).

**DS-02 — Something belongs in the system when a second, unrelated screen would need the exact same thing.** A status badge: yes. The journey timeline: no — it is one feature's answer to one spec and lives with the feature. (The design system still *specifies* the timeline's look, so the feature builds it from system parts only.)

**DS-03 — A pattern knows nothing about the domain**, with deliberate exceptions that need exactly one home: `Money` (AR-21, BR-003-19) and `DateText` (AR-23, BR-003-20).

## 2. Tokens

The vocabulary is MUI's palette, extended through module augmentation (`frontend/app/theme/theme-augmentation.d.ts`) so project tokens are type-checked:

| Token | Means |
|---|---|
| `primary` | The brand. Primary actions, links, current navigation, focus |
| `secondary` (`accent`) | Beam amber: the logo and rare highlights. Never an action |
| `background.default` / `background.paper` | Page and raised surfaces (cards, menus, dialogs) |
| `text.primary` / `text.secondary` / `text.disabled` | Text emphasis levels |
| `divider` | Hairlines between regions |
| `error`, `warning`, `info`, `success` | Feedback: form errors, alerts, toasts |
| **`status.onTime` / `status.late` / `status.done` / `status.cancelled` / `status.neutral`** (+ `Surface`) | Project addition. State of a journey, phase or reminder — text on its own surface |
| **`figure.positive` / `figure.negative`** | Project addition. A figure that went up or down (ROI, discount vs appraisal) — never an action |
| **`destructive`** | Project addition. A dangerous action — delete, remove member, cancel journey |
| `shape.borderRadius` + `shape.panelRadius` / `shape.pillRadius` | Three radii: controls, panels, pills |
| `typography.*` variants | The only font sizes and weights in the product (DS-11) |
| `spacing` | The 8 px base unit; every gap, margin and padding is a multiple via `theme.spacing` |

**Module augmentation** (`theme-augmentation.d.ts`) adds, beyond MUI's defaults: `status.*` (+ `*Surface`), `figure.*`, `destructive`, `background.raised` / `background.muted`, `primary.soft`, `secondary.soft` / `secondary.ink`, `*.soft` on `error`, `warning`, `info` and `success`, `border.control`, `focus`, `overlay`, `shape.panelRadius` / `shape.pillRadius`, the typography variant `metric`, and `theme.layout` (container, reading, sidebar, rail and top-bar sizes in px).

**Contrast, measured at design time:** 82 text/surface pairs were computed. All are at least 4.5:1 (text) or 3:1 (`line-strong`, `primary`, focus) in both schemes; the minimum is 4.7:1 (`success` on `success-soft`, light). The structural test (DS-08) keeps it that way in code.

### Colour tokens

Light / dark values and the MUI path each lands on.

| Token | Light | Dark | MUI | Use |
|---|---|---|---|---|
| `bg` | `#F5F7FA` | `#0B1422` | `background.default` | Page background behind everything. |
| `surface` | `#FFFFFF` | `#111D2E` | `background.paper` | Cards, sidebar, top bar, menus, dialogs. |
| `surface-raised` | `#FFFFFF` | `#172638` | `background.raised (augmented)` | Surfaces above paper: menus, dialogs, popovers. In dark it is lighter than surface (DS-09). |
| `surface-muted` | `#EDF1F5` | `#1B2B40` | `background.muted (augmented)` | Quiet fills: table header, skeletons, image placeholders, default chips. |
| `overlay` | `rgba(15, 27, 43, 0.48)` | `rgba(0, 0, 0, 0.64)` | `Backdrop (MuiBackdrop override)` | Scrim behind dialogs and drawers. |
| `ink` | `#0F1B2B` | `#E6EDF5` | `text.primary` | Primary text and figures, on bg, surface, surface-raised and surface-muted. |
| `ink-muted` | `#4A5A70` | `#A9B6C7` | `text.secondary` | Secondary text, labels, metadata, on bg, surface and surface-raised. |
| `ink-disabled` | `#8A97A8` | `#6B7A8F` | `text.disabled` | Disabled labels only (exempt from contrast, never for information). |
| `line` | `#E3E8EF` | `#24344A` | `divider` | Hairlines between regions, card borders, table rules. |
| `line-strong` | `#7A879A` | `#6B7A8F` | `border.control (augmented)` | Resting border of inputs, checkboxes and outlined controls (3:1 on surface). |
| `primary` | `#1D3B63` | `#8DB4E8` | `primary.main` | Harbour navy. Primary actions, links, current navigation, selected state. As text on bg, surface and primary-soft. |
| `primary-hover` | `#142B4A` | `#B5CFF0` | `primary.dark` | Hover and pressed state of primary fills. |
| `primary-soft` | `#E8EEF6` | `#1B3050` | `primary.soft (augmented)` | Selected nav item, selected row, active filter chip background. |
| `on-primary` | `#FFFFFF` | `#0B1422` | `primary.contrastText` | Text and icons on primary and primary-hover fills. |
| `accent` | `#E5A50A` | `#F2BE3D` | `secondary.main` | Beam amber. The logo's light and rare highlights (featured plan, 'Destaque'). Never as text on light grounds, never for actions. |
| `accent-hover` | `#B98300` | `#F5CF63` | `secondary.dark` | Hover of the rare amber fill. |
| `accent-soft` | `#FDF3D7` | `#3A2E0E` | `secondary.soft (augmented)` | Highlight band behind featured content. |
| `accent-ink` | `#8A5F00` | `#F2BE3D` | `secondary.ink (augmented)` | Amber as text: labels on accent-soft or surface. |
| `on-accent` | `#0F1B2B` | `#0B1422` | `secondary.contrastText` | Text on accent fills. |
| `focus` | `{primary}` | `{primary}` | `focus ring (MuiButtonBase/inputs override)` | 2px solid focus ring with 2px offset on every focusable element. |
| `error` | `#B42318` | `#F28B82` | `error.main` | Form errors and error alerts. As text on surface and error-soft. |
| `error-soft` | `#FDECEA` | `#3D1C1A` | `error.soft (augmented)` | Error alert background. |
| `warning` | `#A04A05` | `#F5B76B` | `warning.main` | Warnings: deadline close, missing data. As text on surface and warning-soft. |
| `warning-soft` | `#FEF4E6` | `#3A2A12` | `warning.soft (augmented)` | Warning alert background. |
| `info` | `#22598F` | `#7CB8F0` | `info.main` | Neutral information alerts. As text on surface and info-soft. |
| `info-soft` | `#E8F0FA` | `#13283F` | `info.soft (augmented)` | Info alert background. |
| `success` | `#1E7A4C` | `#6FCF97` | `success.main` | Confirmations: saved, payment approved. As text on surface and success-soft. |
| `success-soft` | `#E6F4EC` | `#13321F` | `success.soft (augmented)` | Success alert and toast accent background. |
| `destructive` | `#B42318` | `#F28B82` | `destructive.main (augmented)` | Dangerous actions: delete, remove member, cancel journey. Not a form error (DS-06). |
| `destructive-hover` | `#8F1C13` | `#F5A097` | `destructive.dark (augmented)` | Hover of destructive fills. |
| `on-destructive` | `#FFFFFF` | `#0B1422` | `destructive.contrastText (augmented)` | Text on destructive fills. |
| `figure-positive` | `#1E7A4C` | `#6FCF97` | `figure.positive (augmented)` | A figure favourable to the user (ROI up, discount vs appraisal). Always with a sign or arrow (DS-10). |
| `figure-negative` | `#B42318` | `#F28B82` | `figure.negative (augmented)` | A figure unfavourable to the user (loss, cost overrun). Always with a sign or arrow. |
| `status-on-time` | `#1E6B45` | `#8FD9AE` | `status.onTime (augmented)` | 'No prazo' label and dot, on status-on-time-surface. |
| `status-on-time-surface` | `#E4F2EA` | `#16352A` | `status.onTimeSurface (augmented)` | Pill background for 'No prazo'. |
| `status-late` | `#A4281C` | `#F5A097` | `status.late (augmented)` | 'Atrasada' label and dot, on status-late-surface. |
| `status-late-surface` | `#FBE9E7` | `#3D1C1A` | `status.lateSurface (augmented)` | Pill background for 'Atrasada'. |
| `status-done` | `#0E5C66` | `#7FD0D8` | `status.done (augmented)` | 'Concluída' label and dot, on status-done-surface. |
| `status-done-surface` | `#E0F1F2` | `#123438` | `status.doneSurface (augmented)` | Pill background for 'Concluída'. |
| `status-cancelled` | `#4A5568` | `#B6C2D1` | `status.cancelled (augmented)` | 'Cancelada' label and hollow dot, on status-cancelled-surface. |
| `status-cancelled-surface` | `#EEF1F5` | `#222E3D` | `status.cancelledSurface (augmented)` | Pill background for 'Cancelada'. |
| `status-neutral` | `#364152` | `#D5DCE6` | `status.neutral (augmented)` | 'Não iniciada' / pending label and dot, on status-neutral-surface. |
| `status-neutral-surface` | `#E3E8EF` | `#2A3A50` | `status.neutralSurface (augmented)` | Pill background for 'Não iniciada'. |

### Typography tokens

The family is Inter and the variant scale is in §5.

### Spacing

| Token | Value | MUI | Use |
|---|---|---|---|
| `space-05` | 4px | `theme.spacing(0.5)` | Icon-to-label gaps, pill padding. |
| `space-1` | 8px | `theme.spacing(1)` | Tight gaps inside controls and between chips. |
| `space-15` | 12px | `theme.spacing(1.5)` | Gaps inside cards between related lines; dense table cell padding. |
| `space-2` | 16px | `theme.spacing(2)` | Card padding on phone, page gutter on phone, form field gap. |
| `space-3` | 24px | `theme.spacing(3)` | Card padding on desktop, gap between cards, page gutter on desktop. |
| `space-4` | 32px | `theme.spacing(4)` | Between page sections. |
| `space-6` | 48px | `theme.spacing(6)` | Empty/error state padding, large section breaks. |
| `space-8` | 64px | `theme.spacing(8)` | Top bar height; hero spacing on public pages. |

### Radius

| Token | Value | MUI | Use |
|---|---|---|---|
| `radius-control` | 6px | `shape.borderRadius` | Buttons, inputs, selects, chips' inner shapes, menu items, tooltips. |
| `radius-panel` | 10px | `shape.panelRadius (augmented)` | Cards, dialogs, drawers' inner sheets, alerts, image frames. |
| `radius-pill` | 999px | `shape.pillRadius (augmented)` | Status pills, filter chips, count badges, avatars. |

### Shadows

| Token | Light | Dark | MUI | Use |
|---|---|---|---|---|
| `shadow-menu` | `0 4px 16px rgba(15, 27, 43, 0.12)` | `0 8px 24px rgba(0, 0, 0, 0.48)` | `theme.shadows[4]` | Menus, popovers, autocomplete lists. |
| `shadow-dialog` | `0 12px 32px rgba(15, 27, 43, 0.18)` | `0 16px 40px rgba(0, 0, 0, 0.56)` | `theme.shadows[8]` | Dialogs, drawers, toasts. Cards use no shadow: a line border in light, layering in dark. |

### Sizes

| Token | Value | Use |
|---|---|---|
| `size-touch` | 44px | Minimum width and height of every interactive control (DS-16). |
| `size-button` | 44px | Button height (medium). Small buttons are 36px only inside dense tables and toolbars from `md` up (DS-16 exception). |
| `size-input` | 48px | TextField, Select and DateField height. |
| `size-table-row` | 44px | Dense table row height (compact tables, comfortable elsewhere). |
| `size-topbar` | 64px | Top bar height from `md` (56px below `md`). |
| `size-sidebar` | 264px | Sidebar width from lg; collapses to 72px icons from md to lg; drawer below md. |
| `size-container` | 1200px | PageShell max width for app pages. |
| `size-reading` | 720px | PageShell max width for forms, settings and reading pages. |

**DS-04 — Tokens are CSS variables.** The theme is created with `cssVariables: true`, so components read `var(--mui-palette-…)` and the colour scheme switches without re-rendering. Raw `colors.*` constants are not exported for use outside the theme.

**DS-05 — Every token is defined in both colour schemes.** A token that exists only in `light` is a dark-theme gap. A structural test fails when the `light` and `dark` palettes don't have the same keys.

**DS-06 — `destructive`, `figure.negative`, `error` and `status.late` are not interchangeable**, even when they share a hue. A delete button is not a loss; a late phase is not a form error. Picking the token by meaning is what lets the brand change later without breaking semantics.

## 3. Theming

**DS-07 — Three states: light, dark and system.** MUI `colorSchemes: { light, dark }` with `colorSchemeSelector: 'class'`; the default mode is `system`; the user's explicit choice is persisted and wins. `InitColorSchemeScript` in the root layout prevents a flash of the wrong scheme. One `ThemeProvider` (with `AppRouterCacheProvider`) in the root layout — never one per page.

**DS-08 — Contrast is measured, not eyeballed.** A structural test computes contrast from the theme for every text/surface pair the tokens promise, in both schemes: 4.5:1 for text, 3:1 for control borders, focus rings and icons that carry meaning (WCAG 2.1 AA, BR-003-14). axe in E2E covers what is actually rendered (TS-23).

**DS-09 — The dark scheme is layered.** `background.default` < `background.paper` < raised surfaces in lightness, so a card is visible because it is lighter than the page — not because of a border or a shadow, which dark backgrounds swallow.

## 4. Colour

**DS-10 — Colour never carries meaning alone** (BR-003-15). A status shows its label ("No prazo", "Atrasada"); a figure shows its sign or an arrow; a chart has its values available as text or a table. Icons that convey state have an accessible name.

**DS-24 — The brand marks what the user can do** — a button, a link, the current destination, focus. Figures are `text.primary`, or `figure.*` with a sign. A brand-coloured number reads as a link. Amber is not the brand's action colour: it never fills a button and never colours a link.

A status is a **soft tinted pill with a leading dot** (`StatusBadge`): the label always shows, and *cancelled* uses a hollow dot.

## 5. Typography and numerals

**DS-11 — Only theme typography variants** (`h1`–`h6`, `subtitle1/2`, `body1/2`, `caption`, `overline`, `button`, and the project variant `metric`). No ad-hoc `fontSize`/`fontWeight`. A missing size is a new variant in the theme, added in the design system, not on a page.

**DS-12 — Money, areas, counts and dates in tables render with `font-variant-numeric: tabular-nums`**, built into `Money`, `DateText`, `DataTable` and `metric`. Columns of values must line up.

**The typeface is Inter, and only Inter.** It is loaded once with `next/font/google` in the root layout and passed to `typography.fontFamily` (fallback `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`). No other webfont, and no second font stack in the theme.

Weights: 400 text · 500 emphasis and labels · 600 headings, buttons and figures · 700 `h1`/`h2` and the wordmark. Headings use `text-wrap: balance`; running text stays near 65 characters (`PageShell` `reading` is 720 px).

| Variant | Size/line | Weight | Tracking | Use |
|---|---|---|---|---|
| `h1` | 32px/40px | 700 | -0.02em | Page title, once per page via PageHeader (DS-15). 28/36 below md. |
| `h2` | 24px/32px | 700 | -0.015em | Section title inside a page. |
| `h3` | 20px/28px | 600 | -0.01em | Card group or panel title; auction detail title on phone. |
| `h4` | 18px/26px | 600 | 0 | Dialog title, sub-section. |
| `h5` | 16px/24px | 600 | 0 | Card title, form section title. |
| `h6` | 14px/20px | 600 | 0 | Small group heading, sidebar group label (overline is preferred there). |
| `subtitle1` | 16px/24px | 500 | 0 | Emphasised body line under a title. |
| `subtitle2` | 14px/20px | 500 | 0 | Emphasised secondary line, table header text. |
| `body1` | 16px/24px | 400 | 0 | Default text, form inputs. |
| `body2` | 14px/20px | 400 | 0 | Secondary text, table cells, card metadata. |
| `caption` | 12px/16px | 400 | 0.01em | Timestamps, helper text, footnotes. |
| `overline` | 12px/16px | 600 | 0.08em | Uppercase group labels (sidebar groups, KPI labels). Set text-transform uppercase. |
| `button` | 14px/20px | 600 | 0.01em | Button and tab labels. No uppercase. |
| `metric` | 28px/36px | 600 | -0.01em | Project variant: the headline figure of a StatTile or auction price. Tabular numerals. |

`h1` is **28/36 below `md`** and 32/40 from `md`. `metric` is the one project variant: the headline figure of a `StatTile` or an auction price.

## 6. Layout and responsiveness

**DS-13 — Phone first, from 360 px wide, with no horizontal page scroll** (BR-003-11, BR-003-12). Wide tables scroll inside their own container or collapse to a card list. Every screen is checked at 360 px and desktop (TS-23).

**DS-14 — Pages lay out with `Stack`, `Grid` and `Container` using theme spacing**, and with `PageShell` for the page frame and its single width. Breakpoints come from the theme (`{ xs, sm, md }` objects in `sx`), never media queries with pixel values.

**DS-15 — One `<h1>` per page, via `PageHeader`.** Heading levels follow the outline; a visual size never picks a heading level.

**DS-16 — Touch targets are at least 44 × 44 px** on interactive controls, including icon buttons in cards. The one exception is the 36 px `small` button inside dense tables and toolbars from `md` up (pointer layouts); below `md` the same control renders at 44 px.

### Navigation — sidebar + drawer

`AppShell` (`patterns/AppShell.tsx`) is the frame: one instance in the `app/(shell)` route-group layout, never per page. `app/(shell)/(authenticated)/layout.tsx` adds the `RequireAuthentication` guard for the signed-in pages; each page keeps its own `RequireRole` or admin check. The root `not-found.tsx` mounts the shell itself (it cannot sit in a group). Landing, login, register, password reset, email verification, the auth callback and `plans/success` / `plans/cancel` stay outside it. Navigation is a **sidebar that becomes a drawer**, chosen over a bottom bar because there are more than five destinations and hiding items by role would be inconsistent. Approved frame: the [design-system artifact](https://claude.ai/artifact/A4Y69knqEHAqZfQKPLrKCf), card `AppShellFrame` (DS-30).

| Width | Navigation |
|---|---|
| ≥ `lg` | Permanent sidebar, 264 px (`size-sidebar`), `background.paper` with a `divider` right border. No toggle |
| `md` to `lg` | 72 px icon rail: groups split by a short divider, no labels; each item has an `aria-label` (name and count) and a tooltip on the right on hover and focus; the count is a small pill on the icon's corner. **Expandir menu** pins the 264 px sidebar open, pushing the content; pinned, **Recolher menu** sits at the bottom (the label carries the state, so no `aria-pressed`). The choice is kept in `localStorage` (`farol.appShell.railPinned`), read and written in `try/catch` — without storage it lasts the visit |
| < `md` | No sidebar. A 56 px top bar — menu button (`aria-expanded`, `aria-controls`), mark, theme button, reminders shortcut (standard and up), avatar — opens the *same list* in a temporary 300 px drawer on the `overlay` scrim, `background.raised` (DS-09) |

The shell's sizes come from `theme.layout` (`sidebarWidth`, `railWidth`, `topbarHeight`, `topbarCompactHeight`), never from `tokens.ts`. The top bar's bottom border is inside its height, so anything placed under the bar (the sidebar, the search filter drawer) offsets by `topbarHeight` / `topbarCompactHeight` alone, and placeholders inside the shell fill the content area with `shellContentMinHeight` (`patterns/shell-content.ts`), not `100vh`. Layout switches on theme breakpoints (DS-14): presentational swaps (mark vs lockup) are breakpoint `display` in `sx`, so the server markup is right; `useMediaQuery` is kept for behaviour (drawer, rail, pin).

Destinations are grouped under `overline` labels, in this fixed order:

| Group | Destinations | Who |
|---|---|---|
| Busca | Buscar imóveis (`/search`) · Favoritos (`/search?view=favorites`, count) | Favoritos from standard |
| Acompanhamento | Lembretes (`/reminders`, count of upcoming reminders) | standard and up |
| Escritório | — reserved, empty until its routes exist, so it never renders | — |
| Conta | Perfil (`/profile`) · Assinatura (`/plans`) · Suporte (`/support`) | everyone |
| Administração | Cupons (`/admin/coupons`) | admin only |

There is no "Início": `/` sends signed-in users to `/search`. Busca com IA, Jornadas, Relatórios, Investidores and Equipe join their groups when their specs ship.

A role sees only the groups where it has a destination — a group with none disappears with its label — and **groups never reorder between roles**, so a shared destination is always in the same place. The navigation model (groups, items, minimum role, count source, how an item matches the location) is one config file owned by the shell, `patterns/app-shell-navigation.ts`; no component keeps its own list of destinations.

- **Current item**: `primary-soft` with `primary` text, a filled icon and `aria-current="page"`. The most specific match wins: `/search?view=favorites` is Favoritos, any other `/search` is Buscar imóveis; nested paths match by prefix (`/admin/coupons/…` is Cupons); a signed-in visitor of `/auction/[code]` is in Buscar imóveis. The search page reads its view from the URL, so the links switch it.
- **Counts** are neutral pills (`background.muted`, `text.primary`, pill radius), only from what `FavoritesContext` and `RemindersContext` already hold (upcoming = `PENDING` reminders). While they load, on failure or at zero there is no pill; above 99 it reads "99+". The item's accessible name carries the count ("Favoritos, 24"; "Lembretes, 3 próximos").
- **Top bar** (`md` and up, 64 px): the Logo lockup linking home; the theme control (`ColorSchemeControl`, light / dark / system) behind an icon button — also in the < `md` bar, so the scheme can be chosen on a phone; the reminders shortcut (standard and up); the avatar menu button ("Conta de <nome>"). The avatar menu has a header with name, email and the plan chip, then Perfil, Assinatura, a divider and Sair. Sair unmounts the page first and then signs out, so it always lands on `/` (never on the guard's `/login`). Suporte is in the navigation, not in the menu.
- **Guest mode** (signed out): the same top bar with no navigation and no menu button — Logo, theme control and "Entrar" (`/login`). `/auction/[code]` and the 404 pages use it for visitors; signed in, they get the full shell. While auth is still loading the bar shows only the Logo and the theme control, so "Entrar" never flashes for a member.
- **Focus** (DS-21): "Pular para o conteúdo" is the first focusable element at every width and targets the shell's single `<main id="app-content">`, so pages never add their own `<main>`. The drawer is a labelled dialog: on open focus goes to "Fechar menu", it is trapped inside, and Esc, the scrim or choosing a destination close it and return focus to the menu button.
- **Targets**: every item and control is at least 44 px (DS-16).

### Page widths

`PageShell` is the only place a page's width, gutters and vertical rhythm are set. `width="app"` (default) is max **1200 px** for lists, dashboards and detail pages; `width="reading"` is max **720 px** for forms, settings, plans and legal text. Gutters are **16 px on phone and 24 px from `sm`**; sections are 32 px apart. Pages never set their own `maxWidth`, padding or background.

## 7. Components

**DS-17 — Reach for what exists, in this order:** an MUI component as is → a theme variant or `components` override → a pattern → a new component. A new component is a permanent maintenance obligation.

**DS-18 — Restyling an MUI component for the whole product happens once, in the theme's `components` overrides** (`MuiButton`, `MuiCard`, …), not by repeating the same `sx` on every instance.

**DS-19 — Every pattern handles its four states:** loading (skeletons, not spinners for content), empty (`EmptyState` with a next action), error (`ErrorState` with retry, the message from the error code, AR-39), and populated.

**DS-25 — Icons come from `@mui/icons-material` only, in the Outlined variants** (`SearchOutlined`, `NotificationsOutlined`). The filled variant is used only for a selected state: the current navigation item, a favourited heart. Decorative icons are `aria-hidden`; an icon-only button has an `aria-label` from the catalogue.

**DS-26 — Dates use `@mui/x-date-pickers` with the date-fns adapter, `ptBR` locale and the Brasília zone** (AR-23), accept typed input in `dd/mm/aaaa` (BR-003-20), and are keyboard operable (BR-003-16).

**DS-27 — Destructive actions confirm through `ConfirmDialog`**, which names what will be lost and puts the safe action first. Irreversible ones (delete account, cancel journey) say so in words.

### Density

**Comfortable by default** (44 px buttons, 48 px inputs, 24 px card padding on desktop); **compact in data tables** (40 px header, 44 px rows, 12 px cell padding). Compact is a property of `DataTable`, not a mode pages switch on. The sizes are in the tokens above (`size-button`, `size-input`, `size-table-row`).

### Component catalogue

Every component the design system specifies. Each has a card in the artifact with a live preview and its usage guidelines. The layer says where it lives (§1): **Primitive** = MUI configured in the theme's `components` overrides; **Pattern** = `frontend/app/components/patterns/`; **Feature** = `frontend/app/components/<feature>/`, specified by the system and built only from system parts.

| Component | Layer | Purpose |
|---|---|---|
| `Button` | Primitive | Starts an action. One contained primary per view; outlined, text and `destructive` variants |
| `IconButton` | Primitive | Icon-only action in a 44 × 44 target; filled icon for a toggled-on state |
| `TextField` | Primitive | Single-line text entry, 48 px, label always shown above the value |
| `Select` | Primitive | One option from a short list (about 7 or fewer); longer lists use `Autocomplete` |
| `SelectionControls` | Primitive | Checkbox, Radio and Switch with `FormControlLabel`; the whole row is the target |
| `DateField` | Primitive | Date and date-time input with typed `dd/mm/aaaa` and the calendar as a convenience (DS-26) |
| `FilterChip` | Primitive | Toggle chips and applied-filter chips; selected state shows a check icon |
| `Tabs` | Primitive | Switches between views of one object; 2–5 tabs, scrollable on phone |
| `Breadcrumbs` | Primitive | The path to the current page, only on pages two or more levels deep |
| `Pagination` | Primitive | Moves through long result lists, with a range summary ("1–20 de 348 imóveis") |
| `Card` | Primitive | A bounded panel for one object or section; flat, line border, 10 px radius |
| `Alert` | Primitive | An inline message about a page or section; `info`, `warning`, `error`, `success` |
| `Toast` | Primitive | A short past-tense confirmation (Snackbar) through one `useToast()` hook |
| `Skeleton` | Primitive | The loading state, shaped like the content that will arrive |
| `Dialog` | Primitive | A focused task or decision on top of the page |
| `AppShell` | Pattern | The app frame: top bar, sidebar / rail / drawer navigation from one config, the skip link and the `<main>` slot; guest mode with no navigation (§6) |
| `PageShell` | Pattern | The content frame of every page: width, gutters, vertical rhythm (§6) |
| `PageHeader` | Pattern | Breadcrumbs, the page's only `h1`, a summary line and the page actions (DS-15) |
| `Logo` | Pattern | The lighthouse mark and wordmark, rendered inline so the scheme switch recolours it |
| `Money` | Pattern | The only place BRL amounts are formatted (DS-29) |
| `DateText` | Pattern | The only place dates are formatted, in the Brasília zone, inside `<time>` (DS-29) |
| `StatusBadge` | Pattern | A journey, phase or reminder state as a soft pill with a leading dot and a label |
| `FigureDelta` | Pattern | A favourable or unfavourable change (ROI, discount vs appraisal), with sign or arrow |
| `StatTile` | Pattern | One headline `metric` figure with its label and a line of context |
| `DataTable` | Pattern | Compact, scannable lists of records; cards below `md` (DS-13) |
| `EmptyState` | Pattern | What a list shows when it has nothing, with the next action (DS-19) |
| `ErrorState` | Pattern | What a region shows when its data failed, with retry and the error code (DS-19) |
| `ConfirmDialog` | Pattern | The confirmation every destructive action goes through (DS-27) |
| `FilterDrawer` | Pattern | The full set of search filters: bottom sheet on phone, right drawer on desktop |
| `AuctionCard` | Feature (auctions) | One Caixa property in results, favourites and recommendations |
| `AuctionDetailHeader` | Feature (auctions) | The top of the auction detail page: identity, key prices and actions |
| `KeyFactsGrid` | Feature (auctions) | Label/value facts about one record in a responsive `<dl>` |
| `JourneyTimeline` | Feature (journeys) | The six fixed phases of an acquisition journey and where it stands |

## 8. Text

**DS-20 — No string literals in components.** Every user-facing string — labels, `aria-label`s, placeholders, errors, toasts, empty states, emails — comes from the next-intl pt-BR catalogue (`frontend/messages/pt-BR.json`). Enforced by `react/jsx-no-literals` (TESTING §9). pt-BR is the only locale; the catalogue exists so the vocabulary is consistent and checkable (BR-003-18), not because a second language is planned.

**DS-28 — One concept, one wording.** Auction terms are Caixa's (*modalidade*, *edital*, *matrícula*, *arremate*, *desocupação*); journey phases use the PRD's names. A second catalogue string for an existing concept is a review failure.

**DS-29 — Numbers and dates are formatted only through the shared formatters** (`Money`, `DateText`, `formatPercent`, `formatArea`): `R$ 1.234,56`, `dd/mm/aaaa HH:mm`, `12,5%`, `1.250 m²` (BR-003-19–BR-003-21).

Voice: address the user as "você"; sentence case; buttons are verbs of one to three words ("Criar lembrete", never "OK"); errors say what happened and what to do, with no apology; confirmations are past tense without "com sucesso" ("Busca salva"); AI output is labelled and hedged; no emoji and no exclamation marks in system copy. The full content fundamentals are in the artifact's brand book.

## 9. Accessibility

**DS-21 — Accessible before pretty.** WCAG 2.1 AA (BR-003-14): every flow works by keyboard alone and with a screen reader (BR-003-16); focus is always visible (never `outline: none` without a replacement — the focus ring is a 2 px solid `focus` outline with a 2 px offset); every form control has a visible label; errors are announced and tied to their field (`aria-describedby`); dialogs trap and return focus; motion respects `prefers-reduced-motion`.

**DS-22 — Accessibility is tested where it can be:** axe in every component test (TS-19) and on every E2E page (TS-23); contrast by the token test (DS-08). The manual keyboard and screen-reader pass at the end of each milestone (BR-003-17) is recorded on the milestone's issue.

## 10. Page frames

**DS-30 — Every issue that adds a page, or changes a page's layout, gets a frame before implementation.** A frame is an HTML artifact mockup built *only* from the design system's tokens and components, with real pt-BR copy and realistic Caixa data.

- **Content.** Phone (360 px) and desktop (1280 px) in light, with dark checked. The loading, empty and error states are noted (DS-19).
- **Approval.** The frame is linked on the issue and **approved by the product owner on the issue** before implementation starts.
- **Pull request.** The PR links the frame and matches it. A deviation found while building updates the frame first, then the code.
- **Missing parts.** A component the frame needs that the system lacks is added to the design system first (DS-17), never invented inside the page.

The artifact's `SearchPageFrame` card is the example to follow.

## 11. What is not used

**DS-23 — Tailwind is not used.** It is removed from the frontend (packages, config and directives). Two styling systems means two sets of tokens that drift. Likewise no CSS modules, no global CSS beyond the MUI baseline, and no second component library.

## 12. Known gaps

The theme, tokens, shared patterns, formatters and logo from issue #38 are in place. What is still open, and who owns it:

| Rule | Today | Owner |
|---|---|---|
| DS-20 | Page strings are literals; only the `patterns` namespace is in the pt-BR catalogue | #39 |
| DS-26 | Date pickers (`ReminderButton`, `RemindersPage`) still use `dayjs` | #34 |
| DS-29 | Inline currency and date formatters (`Intl`, `toLocaleString`, `toFixed`) remain in about 8 files — `AuctionCard`, `AuctionDetailClient`, `auction/[code]/page`, `plans/page`, `admin/coupons/page`, `RemindersPage`, `ReminderButton`, `SearchFilters`, `AuctionList` — and are not yet replaced by `Money` / `DateText` | #39 / #34 |
| DS-01, DS-11, DS-14, DS-15 | Numeric `fontSize` / `fontWeight` literals in 25 files; pages do not yet use `PageShell` / `PageHeader` | #43 |
| DS-27 | Destructive confirmations are hand-rolled `Dialog`s (`RemindersPage` delete reminder, `plans` cancel subscription) instead of `ConfirmDialog`; some destructive actions have no confirmation at all (admin coupons "Invalidar", `ReminderButton` delete, `SearchFilters` delete saved filter) | no issue yet |
| §6 | Busca com IA, Jornadas, Relatórios, Investidores and Equipe are not in the navigation yet; Escritório is reserved and empty | each destination's spec issue |
| TESTING §9 | Lint enforces hex/px in `sx` (DS-01) and JSX string literals (DS-20), but today's violations are bulk-suppressed in `frontend/eslint-suppressions.json` | #39 (literals), #43 (`px`) |
| TS-24 | No frontend coverage gate | #32 |
| Logo | First version: the SVGs in `frontend/public/brand/` are replaceable (see Brand) | — |
