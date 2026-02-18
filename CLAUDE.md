# CLAUDE.md - Project Memory for Farol dos Leilões

## Project Overview

**Farol dos Leilões** is a full-stack web application for searching and bidding on real estate auctions from Caixa Econômica Federal (Brazilian federal bank). It features AI-powered search, user authentication, favorites, reminders, and subscription-based premium features.

## Tech Stack

### Backend (NestJS)
- **Framework:** NestJS 10 with TypeScript
- **Database:** MongoDB 7.6 with Mongoose ODM
- **Authentication:** JWT (7-day expiry) + Google OAuth 2.0 via Passport.js
- **Payments:** Stripe SDK
- **Email:** Nodemailer (SMTP)
- **Testing:** Jest with ts-jest

### Frontend (Next.js)
- **Framework:** Next.js 16 with React 19
- **UI:** Material-UI v7 + Tailwind CSS 4
- **State:** React Context API
- **Validation:** Zod

## Project Structure

```
auctions/
├── backend/                 # NestJS API (port 3000)
│   └── src/
│       ├── auctions/        # Auction import, search, scraping
│       ├── auth/            # JWT + Google OAuth
│       ├── users/           # User management
│       ├── favorites/       # User bookmarks
│       ├── reminders/       # Email/SMS reminders
│       ├── payments/        # Stripe integration
│       ├── coupons/         # Discount codes
│       ├── saved-filters/   # Saved search filters
│       ├── email/           # Email templates
│       ├── ai/              # NLP query parsing
│       └── common/          # Shared utilities
├── frontend/                # Next.js app (port 3001)
│   └── app/
│       ├── components/      # React components
│       ├── contexts/        # Auth, Favorites, Reminders contexts
│       ├── search/          # Main search page
│       ├── auction/         # Auction detail page
│       ├── admin/           # Admin panel (coupons)
│       └── api/             # Next.js API routes
└── AUTHENTICATION_IMPLEMENTATION.md
```

## Key Commands

```bash
# Backend
cd backend
npm run start:dev    # Development with hot reload
npm run build        # Build for production
npm start            # Run production build
npm test             # Run Jest tests

# Frontend
cd frontend
npm run dev          # Development server
npm run build        # Production build
npm start            # Start production server
npm run lint         # Run ESLint
```

## Database Collections

| Collection | Purpose |
|------------|---------|
| `auctions` | Property listings with phases, prices, addresses |
| `users` | User accounts with auth and subscription data |
| `favorites` | User-auction bookmarks (unique: userId+auctionCode) |
| `reminders` | Scheduled notifications (EMAIL/SMS/WHATSAPP) |
| `saved-filters` | Persisted search filter combinations |
| `coupons` | Discount codes with Stripe integration |

## Key Enums

- **PhaseModality:** `SFI_AUCTION`, `OPEN_BIDDING`, `DIRECT_ONLINE_SALES`, `ONLINE_SALES`
- **PaymentMethod:** `OWN_RESOURCES`, `FGTS`, `FINANCING`
- **ReminderChannel:** `EMAIL`, `SMS`, `WHATSAPP`
- **UserRole:** `admin`, `free`, `standard`, `premium`

## API Routes (Backend)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/auctions` | Search auctions with filters |
| GET | `/api/auctions/neighborhoods` | Get neighborhoods by state/city |
| POST | `/api/auth/register` | User registration |
| POST | `/api/auth/login` | Email/password login |
| GET | `/api/auth/google` | Google OAuth initiate |
| GET | `/api/auth/me` | Current user (protected) |
| PATCH | `/api/auth/profile` | Update profile (protected) |
| CRUD | `/api/favorites` | User bookmarks |
| CRUD | `/api/reminders` | Reminder management |
| CRUD | `/api/saved-filters` | Saved filter management |
| POST | `/api/payments/checkout` | Create Stripe checkout |
| POST | `/api/payments/webhook` | Stripe webhook handler |

## Environment Variables

### Backend (.env)
```
MONGODB_URI=mongodb://localhost:27017/auctions
PORT=3000
JWT_SECRET=your_jwt_secret
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SMTP_HOST=
SMTP_USER=
SMTP_PASS=
```

### Frontend (.env.local)
```
NEXT_PUBLIC_AUCTIONS_API_URL=http://localhost:3000
OPENAI_API_KEY=
```

## Code Conventions

- **Indentation:** 2 spaces, semicolons, single quotes
- **Naming:** PascalCase for classes, camelCase for functions
- **NestJS patterns:** `*.module.ts`, `*.service.ts`, `*.controller.ts`, `*.schema.ts`
- **Directories:** Lowercase with hyphens

## Important Files

| File | Purpose |
|------|---------|
| `backend/src/app.module.ts` | Root module with all imports |
| `backend/src/auctions/auctions.service.ts` | Core search logic |
| `backend/src/auth/auth.service.ts` | Authentication logic |
| `frontend/app/contexts/AuthContext.tsx` | Client auth state |
| `frontend/app/search/page.tsx` | Main search interface |
| `AUTHENTICATION_IMPLEMENTATION.md` | Complete auth documentation |

## Scheduled Jobs

- **Auction Import:** Daily at 3:00 AM - imports CSV data from Caixa for all states

## Security Features

- Password hashing with bcrypt (10 salt rounds)
- JWT tokens with 7-day expiration
- Email verification for local accounts
- Password reset tokens (1-hour expiry)
- Global validation pipes (whitelist, forbid unknown)
- CORS configuration

## Testing

Tests are in `backend/test/` as `*.spec.ts` files:
- `details-scraper.spec.ts` - Scraper unit tests
- `downloader.spec.ts` - Download service tests
- `parser.spec.ts` - CSV parser tests

## Recent Development Focus

- AI module for natural language search
- Reminder system with multi-channel support
- Auction phase management (currentPhase field)
- Multi-provider authentication (local + Google)

## Common Tasks

### Adding a new backend module
1. Create folder in `backend/src/`
2. Add `*.module.ts`, `*.service.ts`, `*.controller.ts`
3. Create schema in `schemas/` subfolder if needed
4. Import module in `app.module.ts`

### Adding a new frontend page
1. Create folder in `frontend/app/`
2. Add `page.tsx` for the route
3. Wrap with `RequireVerification` if protected

### Running the full stack
```bash
# Terminal 1 - Backend
cd backend && npm run start:dev

# Terminal 2 - Frontend
cd frontend && npm run dev
```
