# Architecture Overview

## System Architecture

Farol dos Leiloes is a full-stack monorepo with two independent applications communicating via REST API.

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend                            │
│                  Next.js 16 + React 19                   │
│              (Port 3001 / Vercel-ready)                  │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │  Pages    │  │Contexts  │  │Components│  │API Routes│ │
│  │(app dir) │  │(Auth,Fav │  │(TopBar,  │  │(proxy to │ │
│  │          │  │ Remind,  │  │ Cards,   │  │ backend) │ │
│  │          │  │ Filters) │  │ Filters) │  │          │ │
│  └──────────┘  └──────────┘  └──────────┘  └────┬─────┘ │
└──────────────────────────────────────────────────┼───────┘
                                                   │ HTTP
┌──────────────────────────────────────────────────┼───────┐
│                      Backend                     │       │
│                 NestJS 10 + TypeScript            │       │
│                   (Port 3000)                    │       │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │Controllers│  │ Services │  │ Schemas  │  │ Guards  │ │
│  │(REST API)│  │(business │  │(Mongoose │  │(JWT,    │ │
│  │          │  │ logic)   │  │ ODM)     │  │ Roles)  │ │
│  └──────────┘  └──────────┘  └────┬─────┘  └─────────┘ │
└────────────────────────────────────┼────────────────────┘
                                     │
                        ┌────────────┴───────────┐
                        │     MongoDB 7.6        │
                        │   (6 collections)      │
                        └────────────────────────┘

External Services:
  - Stripe (payments/subscriptions)
  - Google OAuth 2.0 (authentication)
  - SMTP (email delivery)
  - Cloudflare R2 (file storage)
  - Caixa Economica Federal (auction data source)
```

## Data Flow

### Auction Import Pipeline

```
Caixa Website ──► CSV Download ──► Parser ──► Upsert to MongoDB
     │                                              │
     └──► Details Scraper ──► Scrape HTML ──────────┘
                   │                    (description, images,
                   │                     matricula, edital)
                   └──► Cloudflare R2
                        (file storage)
```

1. **Scheduled import** (daily 3:00 AM or manual): Downloads CSV files per state from Caixa
2. **CSV parsing**: Extracts auction data (code, address, prices, phases, payment methods)
3. **Upsert**: Bulk insert/update auctions, detecting phase modality changes
4. **Details scraping**: Scrapes auction detail pages for descriptions, images, documents
5. **File storage**: Uploads images and documents to Cloudflare R2

### Request Flow

```
Browser ──► Next.js API Route ──► NestJS Controller ──► Service ──► MongoDB
                (proxy)              (validation,        (business    (Mongoose)
                                      guards)             logic)
```

The frontend proxies all API calls through Next.js API routes to avoid CORS issues and keep the backend URL server-side.

## Module Dependency Graph

```
AppModule (root)
├── AuthModule
│   ├── UsersModule
│   ├── EmailModule
│   └── JwtModule
├── AuctionsModule
│   └── StorageModule (Cloudflare R2)
├── FavoritesModule
│   └── AuctionsModule
├── RemindersModule
│   ├── AuctionsModule
│   ├── UsersModule
│   ├── EmailModule
│   └── NotificationsModule
├── SavedFiltersModule
├── PaymentsModule
│   ├── UsersModule
│   └── CouponsModule
├── CouponsModule
├── SupportModule
│   └── EmailModule
├── AiModule
└── CommonModule (JobExecution tracking)
```

## Authentication Architecture

```
┌─────────────────────────────────────────────┐
│              Auth Strategies                  │
│                                              │
│  ┌─────────────┐     ┌──────────────────┐   │
│  │ JWT Strategy │     │ Google Strategy   │   │
│  │ (passport-  │     │ (passport-google- │   │
│  │  jwt)       │     │  oauth20)         │   │
│  └──────┬──────┘     └────────┬──────────┘   │
│         │                     │               │
│  ┌──────┴─────────────────────┴──────────┐   │
│  │           AuthService                  │   │
│  │  - register (local)                    │   │
│  │  - login (local)                       │   │
│  │  - googleLogin (OAuth)                 │   │
│  │  - verifyEmail / resetPassword         │   │
│  └────────────────────────────────────────┘   │
└─────────────────────────────────────────────┘

Guards:
  - JwtAuthGuard: Protects authenticated endpoints
  - RolesGuard + @Roles('admin'): Restricts to admin users
```

- **Local auth**: bcrypt (10 rounds) + JWT (7-day expiry)
- **Google OAuth**: Passport strategy, links to existing accounts by email
- **Multi-provider**: Users can have both `local` and `google` providers
- **Email verification**: Required for local accounts, token-based (1-hour expiry)

## Database Design

### Collections and Relationships

```
users ─────────┬──────────── favorites (userId + auctionCode unique)
               │                  │
               ├──────────── reminders (userId + auctionId)
               │                  │
               ├──────────── savedfilters (userId + name unique)
               │
               └──────────── notificationlogs (userId, reminderId)

auctions ──────┬──────────── favorites (auctionCode / auctionId)
               │
               └──────────── reminders (auctionId)

coupons (standalone - Stripe sync)
jobexecutions (standalone - import tracking)
```

### Key Indexes

- `auctions`: code (unique), state+city, state+city+neighborhood, currentPhase.modality, currentPhase.minimumPrice, fulfilled, available, updatedAt
- `users`: email (unique), googleId (sparse unique), stripeCustomerId, role
- `favorites`: userId+auctionCode (unique compound)
- `reminders`: scheduledAt+status (for cron queries)
- `savedfilters`: userId+name (unique compound)

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Password storage | bcrypt, 10 salt rounds |
| Session tokens | JWT, 7-day expiry, secret-based signing |
| Email verification | Crypto random tokens, 1-hour expiry |
| Password reset | Crypto random tokens, 1-hour expiry |
| Input validation | Global ValidationPipe (whitelist, forbidNonWhitelisted) |
| Authorization | JwtAuthGuard (route-level), RolesGuard + @Roles (admin) |
| CORS | Configured in main.ts bootstrap |
| API proxy | Frontend proxies requests, backend URL not exposed to client |
