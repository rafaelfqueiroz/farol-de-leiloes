# Development Guide

## Prerequisites

- Node.js >= 20
- MongoDB 7.6 running locally or accessible remotely
- npm (comes with Node.js)

Optional for full feature set:
- Stripe account (payments)
- Google Cloud project (OAuth)
- SMTP server (email delivery)
- OpenAI API key (AI search)
- Cloudflare R2 bucket (file storage)

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd auctions

# Backend
cd backend
cp .env.example .env
npm install

# Frontend
cd ../frontend
cp .env.example .env.local
npm install
```

### 2. Configure environment

**Backend `.env`**:
```
MONGODB_URI=mongodb://localhost:27017/auctions
PORT=3000
JWT_SECRET=<your-secret>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
STRIPE_SECRET_KEY=<stripe-secret-key>
STRIPE_WEBHOOK_SECRET=<stripe-webhook-secret>
SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_USER=<smtp-user>
SMTP_PASS=<smtp-password>
IMPORT_ENABLED=true
IMPORT_RUN_MODE=MANUAL
```

**Frontend `.env.local`**:
```
NEXT_PUBLIC_AUCTIONS_API_URL=http://localhost:3000
OPENAI_API_KEY=<openai-api-key>
```

### 3. Run the stack

```bash
# Terminal 1 - Backend
cd backend && npm run start:dev

# Terminal 2 - Frontend
cd frontend && npm run dev
```

Backend runs on port 3000, frontend on port 3001.

## Available Scripts

### Backend (`backend/package.json`)

| Script | Command | Description |
|--------|---------|-------------|
| `start:dev` | `nest start --watch` | Development with hot reload |
| `start:debug` | `nest start --debug --watch` | Debug mode (inspector on 9229) |
| `build` | `nest build` | Compile TypeScript to `dist/` |
| `start` | `node dist/main` | Run production build |
| `test` | `jest` | Run all test suites |

### Frontend (`frontend/package.json`)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `next dev --port 3001` | Development server |
| `build` | `next build` | Production build |
| `start` | `next start` | Production server |
| `lint` | `next lint` | Run ESLint |

## Testing

### Agents Must Run Tests in Docker

The developer runs backend and frontend locally during development. To avoid
port conflicts and side effects, **agents must never run tests or start the
applications on the host machine**. All test execution goes through Docker
Compose (`docker-compose.yml` at project root).

```bash
# Run all backend tests
docker compose run --rm backend-test

# Run a specific backend test
docker compose run --rm backend-test npx jest test/parser.spec.ts

# Run frontend tests (when test framework is configured)
docker compose run --rm frontend-test
```

First run will pull images and install dependencies inside the container.
Subsequent runs reuse cached `node_modules` via named volumes.

### Docker Compose Services

| Service | Image | Purpose |
|---------|-------|---------|
| `mongodb-test` | `mongo:7` | Ephemeral MongoDB on port 27018 (avoids conflict with local 27017). Uses tmpfs, data is discarded on stop |
| `backend-test` | `node:20-slim` | Runs backend tests. Connects to `mongodb-test` via internal Docker network. Disables all scheduled jobs |
| `frontend-test` | `node:20-slim` | Runs frontend tests (when configured) |

The `backend-test` service waits for `mongodb-test` to be healthy before
starting. Environment variables are pre-configured for isolation
(`MONGODB_URI=mongodb://mongodb-test:27017/auctions-test`, all schedulers
disabled).

### Backend Tests

Test files are in `backend/test/` as `*.spec.ts`:

Current test suites:
- `details-scraper.spec.ts` - Web scraper unit tests
- `downloader.spec.ts` - CSV download service tests
- `parser.spec.ts` - CSV parser tests

Test fixtures live in `backend/test/fixtures/`.

### Frontend Tests

No test framework currently configured for the frontend.

## Project Structure

```
auctions/
├── backend/
│   ├── src/
│   │   ├── main.ts                  # Entry point, bootstrap, CORS, global pipes
│   │   ├── app.module.ts            # Root module, all imports
│   │   ├── ai/                      # NLP query parsing
│   │   ├── auctions/                # Core domain: import, scrape, search
│   │   │   ├── schemas/             # Mongoose schemas (auction, phase)
│   │   │   ├── scraper/             # Details scraper + scheduler
│   │   │   ├── importer/            # CSV download + parse + import
│   │   │   ├── auctions.service.ts  # Search, upsert, query logic
│   │   │   └── auctions.controller.ts
│   │   ├── auth/                    # Authentication
│   │   │   ├── strategies/          # JWT + Google passport strategies
│   │   │   ├── guards/              # JwtAuth, GoogleAuth, Roles guards
│   │   │   └── decorators/          # @Roles() decorator
│   │   ├── users/                   # User CRUD, bcrypt, roles
│   │   ├── favorites/               # Bookmark CRUD
│   │   ├── reminders/               # Reminder CRUD + cron processor
│   │   ├── saved-filters/           # Saved filters CRUD
│   │   ├── payments/                # Stripe integration
│   │   ├── coupons/                 # Discount codes
│   │   ├── email/                   # SMTP + templates
│   │   ├── notifications/           # SMS/WhatsApp services
│   │   ├── storage/                 # Cloudflare R2
│   │   ├── config/                  # Configuration services
│   │   └── common/                  # JobExecution tracking
│   ├── test/                        # Jest tests + fixtures
│   ├── dist/                        # Compiled output
│   └── package.json
│
├── frontend/
│   ├── app/
│   │   ├── layout.tsx               # Root layout with providers
│   │   ├── page.tsx                 # Landing page
│   │   ├── theme.ts                 # MUI theme configuration
│   │   ├── globals.css              # Tailwind + CSS variables
│   │   ├── components/              # Shared React components
│   │   ├── contexts/                # Auth, Favorites, Reminders, SavedFilters
│   │   ├── api/                     # Next.js API routes (proxy to backend)
│   │   ├── search/                  # Search page
│   │   ├── auction/[code]/          # Auction detail (SSR + ISR)
│   │   ├── login/                   # Login page
│   │   ├── register/                # Registration page
│   │   ├── profile/                 # Profile page
│   │   ├── plans/                   # Subscription plans
│   │   ├── reminders/               # Reminders page
│   │   ├── admin/                   # Admin panel
│   │   ├── auth/callback/           # OAuth callback
│   │   ├── verify-email/            # Email verification
│   │   └── reset-password/          # Password reset
│   ├── lib/                         # Utility functions
│   └── package.json
│
├── docs/                            # Project documentation
├── CLAUDE.md                        # Project memory and conventions
└── AUTHENTICATION_IMPLEMENTATION.md # Auth system documentation
```

## TypeScript Configuration

### Backend
- `strict: true` with `noImplicitAny: false` (relaxed)
- Target: ES2021
- `emitDecoratorMetadata: true` (NestJS decorators)
- `experimentalDecorators: true`

### Frontend
- `strict: true`
- Target: ES2017
- `noEmit: true` (type-check only)
- Path alias: `@/*` for root imports

## Code Conventions

- **Indentation**: 2 spaces
- **Semicolons**: Required
- **Quotes**: Single quotes
- **Naming**: PascalCase (classes), camelCase (functions/variables), UPPER_SNAKE_CASE (constants)
- **NestJS files**: `*.module.ts`, `*.service.ts`, `*.controller.ts`, `*.schema.ts`
- **Directories**: Lowercase with hyphens

## Common Development Tasks

### Adding a new backend module

1. Create directory in `backend/src/<module-name>/`
2. Create `<module-name>.module.ts`, `.service.ts`, `.controller.ts`
3. If data persistence needed, create `schemas/<entity>.schema.ts`
4. Import the module in `backend/src/app.module.ts`
5. Add tests in `backend/test/`

### Adding a new frontend page

1. Create directory in `frontend/app/<route>/`
2. Add `page.tsx` for the route
3. Wrap with `RequireVerification` if authentication is required
4. Add API route in `frontend/app/api/` if proxying to a new backend endpoint

### Adding a new API endpoint

1. Add method to the relevant service
2. Add route handler to the controller
3. Create DTO if needed (with class-validator decorators)
4. Add corresponding Next.js API route for frontend proxy
5. Wire up the frontend call (context or direct fetch)

## Key Dependencies

### Backend
- NestJS 10, Mongoose, Passport (JWT + Google), Stripe SDK, Nodemailer, @nestjs/schedule, @nestjs/cache-manager, AWS SDK v3 (S3/R2)

### Frontend
- Next.js 16, React 19, Material-UI v7, Tailwind CSS 4, Zod, date-fns
