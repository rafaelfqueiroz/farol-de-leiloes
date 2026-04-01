# Backend API Reference

## Modules

| Module | Directory | Purpose |
|--------|-----------|---------|
| auth | `src/auth/` | JWT + Google OAuth authentication, email verification, password reset |
| auctions | `src/auctions/` | Auction import (CSV), scraping, search/filtering, caching |
| users | `src/users/` | User accounts, profile management, bcrypt hashing, roles |
| favorites | `src/favorites/` | User bookmarks with compound uniqueness constraint |
| reminders | `src/reminders/` | Scheduled reminders (EMAIL/SMS/WHATSAPP), cron processor |
| saved-filters | `src/saved-filters/` | Saved search filter combinations (max 10 per user) |
| payments | `src/payments/` | Stripe subscriptions, checkout sessions, webhooks |
| coupons | `src/coupons/` | Discount codes with Stripe sync, admin-only creation |
| email | `src/email/` | Nodemailer SMTP, email templates |
| notifications | `src/notifications/` | SMS and WhatsApp services (SMS placeholder) |
| ai | `src/ai/` | NLP service for natural language query parsing |
| support | `src/support/` | Support requests with email notifications |
| storage | `src/storage/` | Cloudflare R2 (S3-compatible) file storage |
| common | `src/common/` | JobExecution schema/service for tracking scheduled jobs |

## REST Endpoints

### Authentication (`/api/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | Public | Register user + send verification email |
| POST | `/login` | Public | Email/password login, returns JWT |
| GET | `/google` | GoogleGuard | Initiate Google OAuth flow |
| GET | `/google/callback` | GoogleGuard | OAuth callback, redirects to frontend with token |
| POST | `/reset-password-request` | Public | Send password reset email |
| POST | `/reset-password` | Public | Reset password with token |
| GET | `/me` | JWT | Get current user profile |
| POST | `/logout` | JWT | Client-side token removal |
| PATCH | `/profile` | JWT | Update name/email |
| PATCH | `/profile/complete` | JWT | Complete OAuth user profile (phone, CPF, DOB, address) |
| POST | `/change-password` | JWT | Change password (requires current) |
| POST | `/set-password` | JWT | Set password for OAuth-only users |
| POST | `/verify-email` | Public | Verify email with token |
| POST | `/resend-verification` | JWT | Resend verification email |
| GET | `/verification-status` | JWT | Check email verification state |

### Auctions (`/api/auctions`)

| Method | Path | Auth | Query Params | Description |
|--------|------|------|-------------|-------------|
| GET | `/` | Public | state, city, neighborhood, modality, minMargin, maxMargin, limit, offset | Search auctions with filters and pagination |
| GET | `/neighborhoods` | Public | state, city | Get distinct neighborhoods (cached 1hr) |
| GET | `/sitemap/codes` | Public | - | All active auction codes for sitemap |
| GET | `/:code` | Public | - | Get single auction by code |

### Favorites (`/api/favorites`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | JWT | List user's favorites |
| POST | `/` | JWT | Add auction to favorites (body: `{code}`) |
| DELETE | `/:code` | JWT | Remove favorite |

### Reminders (`/api/reminders`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | JWT | List user's reminders |
| GET | `/:id` | JWT | Get single reminder |
| POST | `/` | JWT | Create reminder (channel, scheduledAt, description) |
| PATCH | `/:id` | JWT | Update reminder |
| DELETE | `/:id` | JWT | Delete reminder |

### Saved Filters (`/api/saved-filters`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | JWT | List saved filters |
| POST | `/` | JWT | Save filter combination (max 10) |
| DELETE | `/:id` | JWT | Delete saved filter |

### Payments (`/api/payments`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/create-checkout-session` | JWT | Create Stripe checkout (optional coupon) |
| POST | `/webhook` | Public (Stripe sig) | Handle Stripe events (checkout, subscription updates, invoice failures) |
| GET | `/subscription-status` | JWT | Get user's subscription status |
| POST | `/cancel-subscription` | JWT | Cancel active Stripe subscription |

### Coupons (`/api/coupons`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | JWT + Admin | Create coupon (syncs to Stripe) |
| GET | `/` | JWT + Admin | List all coupons |
| PATCH | `/:id/invalidate` | JWT + Admin | Deactivate coupon |
| POST | `/validate` | JWT | Validate coupon code |

### Support (`/api/support`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | JWT | Submit support request (body: `{title, description}`) |

### AI (`/api/ai`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/extract-params` | Public | Parse natural language into auction filter params |

## Schemas

### AuctionEntity (`auctions`)

| Field | Type | Notes |
|-------|------|-------|
| code | string | Unique, indexed |
| title | string | - |
| address | nested | street, city, state, neighborhood, zipcode |
| appraisalPrice | number | Appraised property value |
| phases | Phase[] | Array of auction phases with modality, dates, prices |
| currentPhase | Phase | Active phase snapshot |
| detailsUrl | string | Source URL on Caixa website |
| image | AuctionFile | Image with R2 key and URL |
| matricula | AuctionFile | Property registration document |
| edital | AuctionFile | Auction notice document |
| description | string | Scraped property description |
| fulfilled | boolean | Whether auction was completed (default: false) |
| available | boolean | Whether listing is active (default: true) |

**Indexes**: code, state+city, state+city+neighborhood, currentPhase.modality, currentPhase.minimumPrice, fulfilled, available, updatedAt

### UserEntity (`users`)

| Field | Type | Notes |
|-------|------|-------|
| email | string | Unique, lowercase |
| password | string | Optional (OAuth users may not have) |
| name | string | - |
| googleId | string | Sparse unique index |
| providers | string[] | `['local']`, `['google']`, or both |
| emailVerified | boolean | - |
| role | enum | admin, free, standard, premium |
| stripeCustomerId | string | - |
| stripeSubscriptionId | string | - |
| subscriptionStatus | string | - |
| phone, cpf, dateOfBirth | string/Date | Personal data |
| address | nested | Full address |

### FavoriteEntity (`favorites`)

| Field | Type | Notes |
|-------|------|-------|
| userId | ObjectId | Ref: UserEntity |
| auctionCode | string | - |
| auction | ObjectId | Ref: AuctionEntity |

**Unique compound index**: userId + auctionCode

### ReminderEntity (`reminders`)

| Field | Type | Notes |
|-------|------|-------|
| userId | ObjectId | Ref: UserEntity |
| auction | ObjectId | Ref: AuctionEntity |
| channel | enum | EMAIL, SMS, WHATSAPP |
| scheduledAt | Date | Indexed |
| description | string | - |
| status | enum | PENDING, SENT (default: PENDING) |

### Other Schemas

- **NotificationLog** (`notificationlogs`): Tracks sent reminders with success/error status
- **SavedFilter** (`savedfilters`): userId + name (unique), filters object with state/city/neighborhood/modality/margins
- **Coupon** (`coupons`): code (unique), discountValue (cents), validTo, active, Stripe IDs
- **JobExecution** (`jobexecutions`): jobName, runMode (MANUAL/AUTO), finishedAt

## Services

### AuthService (`src/auth/auth.service.ts`)
- `register(dto)` - Create user + send verification email
- `login(dto)` - Validate credentials, return JWT
- `googleLogin(user)` - Sync OAuth user, return JWT
- `requestPasswordReset(email)` - Generate token, send email
- `resetPassword(token, password)` - Reset with valid token
- `verifyEmail(token)` - Mark email as verified

### AuctionsService (`src/auctions/auctions.service.ts`)
- `upsertMany(items)` - Bulk insert/update with phase change detection
- `query(filters)` - Search with filters + pagination
- `findByCode(code)` - Single auction lookup
- `getNeighborhoods(state, cities)` - Distinct neighborhoods (cached 1hr)
- `getAllCodes()` - All codes for sitemap
- `toAuction(doc)` - Transform document to API response with computed URLs

### PaymentsService (`src/payments/payments.service.ts`)
- `createCheckoutSession(userId, email, planId, coupon?)` - Stripe checkout
- `handleWebhook(body, signature)` - Process Stripe events
- `getSubscriptionStatus(userId)` - User subscription info
- `cancelSubscription(userId)` - Cancel Stripe subscription

### RemindersService (`src/reminders/reminders.service.ts`)
- `create(userId, dto)` - Create with channel/contact validation
- `getDueReminders(limit)` - Fetch pending reminders due now
- `validateChannelPermission(user, channel)` - Check role allows channel
- `validateUserContactInfo(user, channel)` - Ensure contact info exists

## Guards and Middleware

| Guard | File | Purpose |
|-------|------|---------|
| JwtAuthGuard | `src/auth/guards/jwt-auth.guard.ts` | Validates JWT token on protected routes |
| GoogleAuthGuard | `src/auth/guards/google-auth.guard.ts` | Initiates Google OAuth flow |
| RolesGuard | `src/auth/guards/roles.guard.ts` | Restricts access by user role |
| @Roles() | `src/auth/decorators/roles.decorator.ts` | Decorator to specify required roles |

## Scheduled Jobs

| Job | Schedule | Env Toggle | Description |
|-----|----------|-----------|-------------|
| Auction Import | Daily 3:00 AM UTC | `IMPORT_ENABLED`, `IMPORT_ON_START_UP` | Downloads CSV from Caixa for all states, parses, upserts. Batch with concurrency control |
| Details Scraper | Daily 9:00 AM UTC (6 AM BRT) | `SCRAPER_ENABLED`, `SCRAPER_ON_START_UP` | Scrapes unfulfilled auction detail pages. Batch size 15, concurrency 3. Uploads images/docs to R2 |
| Reminder Processor | Every 15 minutes | `REMINDERS_ENABLED` | Fetches up to 50 pending reminders with scheduledAt <= now, sends via EMAIL/SMS/WHATSAPP, logs results |

All jobs:
- Check `JobExecutionService.hasRunRecently()` to prevent duplicate runs within 23 hours
- Support `ON_START_UP` env var to run on app boot (5s delay)
- Record execution via `JobExecutionService`

## Environment Variables

| Variable | Default | Used By |
|----------|---------|---------|
| `MONGODB_URI` | `mongodb://localhost:27017/auctions` | AppModule |
| `PORT` | `3000` | main.ts |
| `JWT_SECRET` | `your-secret-key` | AuthModule (7-day expiry) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | - | GoogleStrategy |
| `GOOGLE_CALLBACK_URL` | `localhost:3000/api/auth/google/callback` | GoogleStrategy |
| `FRONTEND_URL` | `http://localhost:3001` | CORS, email links, OAuth redirect |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | - | PaymentsService |
| `STRIPE_STANDARD_PRICE_ID` | - | PaymentsService |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | - (port: 587) | EmailService |
| `SMTP_SECURE` / `EMAIL_FROM` | `false` / `noreply@faroldosleiloes.com` | EmailService |
| `IMPORT_ENABLED` / `IMPORT_ON_START_UP` | `true` / `false` | Import scheduler |
| `SCRAPER_ENABLED` / `SCRAPER_ON_START_UP` | `true` / `false` | Scraper scheduler |
| `REMINDERS_ENABLED` | `true` | Reminders scheduler |
| `NEIGHBORHOODS_CACHE_TTL` | `3600000` (1hr) | AuctionsService |
| `CLOUDFLARE_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | - | StorageService |
| `R2_BUCKET` / `R2_PUBLIC_URL` | `farol-leiloes` | StorageService |
| `OPENAI_API_KEY` | - | NlpService |

## Error Handling

**Global ValidationPipe** (main.ts): `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`

| Exception | Status | Used For |
|-----------|--------|----------|
| UnauthorizedException | 401 | Invalid credentials, expired JWT, user not found |
| ForbiddenException | 403 | User lacks required role |
| BadRequestException | 400 | Invalid coupon, filter limit reached, password mismatch, missing contact info |
| NotFoundException | 404 | Auction/user/reminder not found |
| ConflictException | 409 | Duplicate email, duplicate saved filter name |

**Database**: MongoDB connection retries 3 times. Bulk operations use `ordered: false` to continue on individual failures.
