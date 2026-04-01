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
│       ├── support/         # Support requests
│       └── common/          # Shared utilities
├── frontend/                # Next.js app (port 3001)
│   └── app/
│       ├── components/      # React components
│       ├── contexts/        # Auth, Favorites, Reminders contexts
│       ├── search/          # Main search page
│       ├── auction/         # Auction detail page
│       ├── support/         # Support page (FAQ + form)
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
| POST | `/api/support` | Submit support request |
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

**IMPORTANT: Agents must NEVER run tests or start apps on the host machine.**
Use Docker Compose instead. See `docs/development/guide.md` for details.

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

## Context Engineering (Main Agent Discipline)

The main agent is an **orchestrator**, not a worker.

**Main agent role:** Coordinate files, spawn sub-agents, process
summaries, communicate with the user, elaborate plans.

**Main agent NEVER:** Explores the codebase broadly, implements code
changes, runs builds/tests, processes large command output.
All of these get delegated to sub-agents.

### Sub-agent Communication Protocol

- Every prompt ends with: "Return a structured summary with these exact fields:"
- Never ask a sub-agent to "return everything"
- Target 10-20 lines of actionable info per result
- Chain sub-agents: pass only relevant fields between them

#### Required Response Fields by Task Type

**Code exploration / research agents:**
- `files_changed`: List of file paths read or relevant to findings
- `summary`: 1-3 sentence description of what was found
- `key_findings`: Bulleted list of actionable facts (max 10)
- `blockers`: Any issues, missing dependencies, or ambiguities found
- `suggested_approach`: Recommended next step based on findings

**Implementation agents (write code):**
- `files_changed`: List of file paths created or modified
- `changes_summary`: 1-line description per file changed
- `tests_needed`: Whether new/updated tests are required and for what
- `dependencies_added`: Any new packages installed (name + version)
- `migration_needed`: Whether DB schema changes require migration steps
- `breaking_changes`: Any API or interface changes that affect other modules

**Test / validation agents:**
- `pass_fail`: PASS or FAIL
- `total_tests`: Number of tests run
- `failures`: List of failing test names with 1-line error description
- `coverage_delta`: Whether coverage increased/decreased (if available)
- `suggested_fixes`: For failures, recommended fix per failing test

**Build / lint agents:**
- `pass_fail`: PASS or FAIL
- `errors`: List of errors with file:line and 1-line description
- `warnings`: Count of warnings (list only if < 10)
- `suggested_fixes`: Recommended fix per error

### Model Routing Table

Assign sub-agents to the optimal model based on task complexity:

| Task | Model | Rationale |
|------|-------|-----------|
| Architectural decisions and system design | Opus | Requires deep reasoning about trade-offs and dependencies |
| Complex multi-file refactoring | Opus | Needs holistic understanding of codebase relationships |
| Debugging hard-to-reproduce issues | Opus | Requires hypothesis generation and multi-step reasoning |
| Security audits and vulnerability analysis | Opus | Needs thorough analysis of attack vectors |
| New feature planning and design | Opus | Requires weighing multiple design approaches |
| Standard feature implementation | Sonnet | Well-defined scope, clear patterns to follow |
| Test writing and test coverage | Sonnet | Follows established patterns, moderate complexity |
| API endpoint implementation | Sonnet | Follows NestJS conventions, well-scoped |
| Frontend page/component creation | Sonnet | Follows React/Next.js patterns, moderate reasoning |
| Code review and PR analysis | Sonnet | Needs context understanding but follows checklists |
| Bug fixes with clear reproduction | Sonnet | Scoped problem, moderate reasoning needed |
| Database schema changes | Sonnet | Needs understanding of relationships but follows patterns |
| Documentation updates | Haiku | Straightforward writing from existing code |
| Simple fixes (lint, format, typos, CSS) | Haiku | Mechanical changes, minimal reasoning |
| Dependency updates and version bumps | Haiku | Follow changelogs, update configs |
| Code search and exploration | Haiku | Fast file/pattern matching, low reasoning |
| Environment and config changes | Haiku | Small, well-defined edits |
| Renaming and find-replace operations | Haiku | Mechanical, pattern-based changes |
| Commit message and changelog generation | Haiku | Summarization from diff, low complexity |

## Documentation

Detailed docs live in `docs/`. Agent reads them on demand.

| Topic | Location |
|---|---|
| Architecture | `docs/architecture/overview.md` |
| Frontend App | `docs/apps/frontend/app-reference.md` |
| Backend API | `docs/apps/backend/api-reference.md` |
| Development Guide | `docs/development/guide.md` |

**After every code change, review and update the affected docs.** If a change
touches API routes, schemas, components, env vars, or project structure,
the corresponding doc file must be updated in the same task.