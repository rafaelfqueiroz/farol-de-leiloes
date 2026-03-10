# Frontend App Reference

## Pages

| Route | File | Type | Description |
|-------|------|------|-------------|
| `/` | `app/page.tsx` | Client | Landing page with hero, features, pricing, CTA |
| `/login` | `app/login/page.tsx` | Client | Email/password + Google OAuth login |
| `/register` | `app/register/page.tsx` | Client | Registration form with validation |
| `/search` | `app/search/page.tsx` | Client | Main search with filters drawer and auction grid |
| `/auction/[code]` | `app/auction/[code]/page.tsx` | Server (ISR) | Auction detail with metadata + JSON-LD |
| `/plans` | `app/plans/page.tsx` | Client | Subscription plans (Free/Standard/Premium) + Stripe checkout |
| `/plans/success` | `app/plans/success/page.tsx` | Server | Stripe checkout success callback |
| `/plans/cancel` | `app/plans/cancel/page.tsx` | Server | Stripe checkout cancellation |
| `/profile` | `app/profile/page.tsx` | Client | User profile management |
| `/reminders` | `app/reminders/page.tsx` | Client | Reminder management dashboard |
| `/verify-email` | `app/verify-email/page.tsx` | Client | Email verification with resend |
| `/verify-email/[token]` | `app/verify-email/[token]/page.tsx` | Server | Token verification handler |
| `/reset-password` | `app/reset-password/page.tsx` | Server | Password reset request |
| `/reset-password/[token]` | `app/reset-password/[token]/page.tsx` | Server | Password reset with token |
| `/auth/callback` | `app/auth/callback/page.tsx` | Client | Google OAuth callback (stores token, redirects) |
| `/admin/coupons` | `app/admin/coupons/page.tsx` | Client | Admin coupon management |

## Components

| Component | File | Props | Description |
|-----------|------|-------|-------------|
| TopBar | `app/components/TopBar.tsx` | - | Fixed nav bar with logo, plan badge, user menu |
| Sidebar | `app/components/Sidebar.tsx` | `activeView?`, `onViewChange?` | Fixed left sidebar (icon-only, 72px) |
| SearchFilters | `app/components/SearchFilters.tsx` | `onSearch`, `onAISearchResults?`, `isLoading?`, `initialFilters?` | Right drawer: location/modality/price filters, AI search, saved filters |
| AuctionList | `app/components/AuctionList.tsx` | `auctions`, `total`, `isLoading?`, `page?`, `pageSize?`, callbacks | Grid/list view toggle, pagination, page size selector |
| AuctionCard | `app/components/AuctionCard.tsx` | `auction`, `isFavorite`, `onToggleFavorite`, `detailUrl`, `showDate?` | Property card with image, prices, modality chip, favorite/reminder buttons |
| ReminderButton | `app/components/ReminderButton.tsx` | `auctionCode`, `auctionTitle`, `auctionDate?` | Icon button with reminder create/edit/delete dialog |
| FavoritesView | `app/components/FavoritesView.tsx` | - | Grid of favorited auctions |
| RemindersPage | `app/components/RemindersPage.tsx` | - | List of pending reminders with edit/delete |
| LandingPage | `app/components/LandingPage.tsx` | - | Marketing page: hero, features, how-it-works, pricing |
| RequireVerification | `app/components/RequireVerification.tsx` | `children`, `fallback?` | HOC: redirects unauthenticated users to `/login` |

## Contexts

### AuthContext (`app/contexts/AuthContext.tsx`)
- **State**: `user: User | null`, `loading: boolean`
- **Methods**: `login()`, `register()`, `logout()`, `loadUser()`, `refreshUser()`, `resendVerificationEmail()`, `checkVerificationStatus()`
- **Token**: Stored in `localStorage` under `token` key, sent as `Authorization: Bearer {token}`
- **Manages**: Authentication state, user roles, subscription status, email verification

### FavoritesContext (`app/contexts/FavoritesContext.tsx`)
- **State**: `favorites: Auction[]`, `loading: boolean`
- **Methods**: `toggleFavorite()`, `removeFavorite()`, `isFavorite()`
- **Manages**: Favorited auctions, syncs with backend API

### RemindersContext (`app/contexts/RemindersContext.tsx`)
- **State**: `reminders: Reminder[]`, `loading: boolean`
- **Methods**: `createReminder()`, `updateReminder()`, `deleteReminder()`, `hasReminderForAuction()`, `getReminderForAuction()`, `refreshReminders()`
- **Manages**: Reminders for auctions (EMAIL/SMS/WHATSAPP), scheduled times

### SavedFiltersContext (`app/contexts/SavedFiltersContext.tsx`)
- **State**: `savedFilters: SavedFilter[]`, `loading: boolean`, `isAuthenticated: boolean`
- **Methods**: `saveFilter()`, `deleteFilter()`, `refreshFilters()`
- **Manages**: Saved search filter combinations (max 10 per user)

## API Routes (Next.js Proxy)

All frontend API routes proxy to the backend. Key routes:

| Frontend Route | Backend Target | Purpose |
|---------------|---------------|---------|
| `/api/search` | `/api/auctions` | Auction search with filters |
| `/api/chat` | `/api/ai/extract-params` + `/api/auctions` | AI search (NLP + query) |
| `/api/auth/*` | `/api/auth/*` | All auth operations |
| `/api/favorites/*` | `/api/favorites/*` | Favorites CRUD |
| `/api/reminders/*` | `/api/reminders/*` | Reminders CRUD |
| `/api/saved-filters/*` | `/api/saved-filters/*` | Saved filters CRUD |
| `/api/payments/*` | `/api/payments/*` | Stripe operations |
| `/api/coupons/*` | `/api/coupons/*` | Coupon operations |
| `/api/auctions/[code]` | `/api/auctions/[code]` | Auction detail (server-side) |

## Layout Structure

```
RootLayout (app/layout.tsx)
├── Inter font, Portuguese metadata
├── AuthProvider
├── FavoritesProvider
├── RemindersProvider
└── {children}
    ├── Search page
    │   └── SavedFiltersProvider + ThemeProvider
    ├── Authenticated pages (profile, plans, reminders)
    │   └── ThemeProvider + Sidebar + TopBar
    └── Public pages (login, register, landing)
```

## Auth Flow

1. **Registration**: Form submit -> `/api/auth/register` -> token to localStorage -> redirect `/verify-email`
2. **Local login**: Email+password -> `/api/auth/login` -> token to localStorage -> redirect `/search`
3. **Google OAuth**: Click -> `{BACKEND_URL}/api/auth/google` -> Google consent -> callback to `/auth/callback?token={jwt}` -> token stored -> redirect
4. **Protected routes**: `RequireVerification` HOC checks `isAuthenticated`, redirects to `/login`
5. **Email verification gate**: Home page checks if local user is unverified, redirects to `/verify-email`

## Search System

### Filters (Right Drawer)
- **Location**: State dropdown -> City autocomplete (dynamic) -> Neighborhood autocomplete (requires city)
- **Modality**: Checkboxes (SFI_AUCTION, OPEN_BIDDING, DIRECT_ONLINE_SALES, ONLINE_SALES)
- **Price range**: Dual slider (R$ 0 - R$ 2M, 50k steps)
- **Saved filters**: Dropdown to load, save current, delete (max 10)

### AI Search
- Text input at top of filter drawer
- Calls `/api/chat` (NLP extraction + auction query)
- Gated behind `standard`/`premium`/`admin` roles (free users see lock icon)

### Results Display
- Grid/list view toggle
- Page size selector (10/20/50/100)
- Numbered pagination
- Cards show: image, title, modality chip, prices, address, favorite/reminder buttons

### URL State
Filters persisted in query string: `state=`, `city=`, `neighborhood=`, `modality=`, `minMargin=`, `maxMargin=`, `page=`

## Styling

### Color Palette
| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#5A6C7D` | Steel Blue, buttons and accents |
| Dark | `#2D3436` | Dark Charcoal, text and headers |
| Secondary | `#E8DCC8` | Warm Beige, backgrounds |
| Off-white | `#FAFAF9` | Page backgrounds |
| Border | `#B8BEBD` | Medium Gray, dividers |

### Stack
- **MUI Theme** (`app/theme.ts`): Custom palette, button/card/chip overrides
- **Tailwind CSS** (`tailwind.config.ts`): Extended with custom color variables, bounce-delay animation
- **Global CSS** (`app/globals.css`): Tailwind directives, CSS variables, custom keyframes

## Key Dependencies

- Next.js 16, React 19
- Material-UI v7 (`@mui/material`, `@mui/icons-material`)
- Tailwind CSS 4
- Zod (validation)
- date-fns (date formatting)
