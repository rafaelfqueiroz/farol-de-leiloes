# Leilões Caixa - AI Assistant Frontend

AI-powered interface to search and query auctions from Caixa Econômica Federal using natural language.

## Features

- Natural language interface in Portuguese (PT-BR)
- LangChain-powered AI agent for extracting filters from user queries
- MCP (Model Context Protocol) server for structured API communication
- Chat interface built with Next.js and MUI, styled through the design-system theme tokens
- Automatic mapping of states, cities, modalities, and price ranges

## Architecture

- **Next.js 16**: React framework with App Router
- **LangChain**: Agent framework for AI-powered query extraction
- **OpenAI GPT-4**: Language model for understanding user intent
- **MCP SDK**: Model Context Protocol for structured tool calling
- **MUI 7**: Component library; all styling comes from the theme tokens in `app/theme/` (see [DESIGN.md](../docs/guidelines/DESIGN.md))

## Prerequisites

- Node.js 24.22.2 (pinned in `.node-version`; DV-05)
- Auctions API running on port 3000

## Installation

1. Install dependencies (and, once at the repository root, run `npm install` to install the git hooks: husky + lint-staged):

```bash
npm install
```

2. Create `.env.local`:

```bash
cp .env.example .env.local
```

3. Review the variables in `.env.local` (every variable is documented in `.env.example`; the
   defaults work against a backend on `localhost:3000`). They are read only through
   `lib/env.ts` (AR-42):

```
NEXT_PUBLIC_AUCTIONS_API_URL=http://localhost:3000   # backend, as seen by the browser
NEXT_PUBLIC_SITE_URL=https://faroldosleiloes.com.br  # canonical site origin
BACKEND_API_URL=http://localhost:3000                # backend, as seen by the Next.js server
```

## Running the Application

Development mode:

```bash
npm run dev
```

The frontend will be available at http://localhost:3001

Production build:

```bash
npm run build
npm start
```

The build uses `output: 'standalone'` (`next.config.ts`), which the deploy image runs: `Dockerfile` copies `.next/standalone` and serves `node server.js` on port 3001 as a non-root user. `NEXT_PUBLIC_*` values are build arguments there, passed by `deploy.yml` from repository variables (DEVELOPMENT §12). Vercel ignores the setting.

## Scripts

| Script                 | What it does                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | `tsc --noEmit`                                                                                             |
| `npm test`             | Vitest (unit, component and structural tests)                                                              |
| `npm run test:cov`     | `npm test` with the V8 coverage gate (TESTING §7); lcov report in `coverage/`                              |
| `npm run lint`         | ESLint (legacy violations are suppressed in `eslint-suppressions.json` until #30)                          |
| `npm run lint:fix`     | ESLint with `--fix`                                                                                        |
| `npm run lint:prune`   | Drops suppressions that no longer occur, after fixing a legacy violation                                   |
| `npm run format`       | Prettier, write                                                                                            |
| `npm run format:check` | Prettier, check only                                                                                       |
| `npm run check`        | `typecheck` + `lint` + `format:check` + `test`; the pre-push hook runs it when `frontend/` changes (DV-37) |
| `npm run build`        | Next.js production build                                                                                   |

## Usage Examples

Ask questions in natural Portuguese:

- "Mostre leilões no estado de Rio Grande do Norte, cidade de Natal"
- "Estou interessado em leilões da Caixa em Licitação Aberta no estado do RN e cidade do Natal, cujo valor seja de pelo menos R$200.000,00"
- "Quais são os imóveis em São Paulo com preço entre R$100.000,00 e R$300.000,00?"

The AI agent will:

1. Extract filters (state, city, neighborhood, modality, price range)
2. Map state names to abbreviations (e.g., "Rio Grande do Norte" → "RN")
3. Map auction modalities to enum values (e.g., "Licitação Aberta" → "OPEN_BIDDING")
4. Convert currency values (e.g., "R$ 200.000,00" → 200000)
5. Query the auctions API with the correct filters
6. Present results in a clear, organized format

## Project Structure

```
frontend/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts       # Chat API endpoint
│   ├── components/patterns/   # Shared design-system patterns (Logo, PageShell, Money…)
│   ├── components/DateField.tsx # Date / date-time input in Brasília time (DS-26)
│   ├── theme/                 # MUI theme: tokens, light/dark schemes (DESIGN.md)
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # Main chat interface
├── lib/
│   ├── env.ts                 # The only reader of process.env (AR-42)
│   ├── backend.ts             # BFF helper: backendFetch / proxyToBackend (server-only)
│   ├── money.ts, dates.ts     # Money (decimal.js) and date (date-fns) helpers
│   ├── auction.ts             # Shared auction types (money as strings)
│   └── mcp-server.ts          # MCP server (optional standalone)
├── messages/pt-BR.json        # next-intl catalogue (pt-BR)
├── test/                      # Vitest setup and structural tests
├── .env.example               # Environment variables template
├── next.config.ts             # Next.js configuration
├── tsconfig.json              # TypeScript configuration
└── package.json               # Dependencies and scripts
```

## How It Works

1. **User Input**: User types a natural language query in Portuguese
2. **API Route**: `/api/chat` receives the message
3. **LangChain Agent**:
   - GPT-4 analyzes the user's intent
   - Extracts relevant filters (state, city, modality, price)
   - Maps human-readable values to API parameters
4. **Query Tool**: Makes HTTP request to auctions API with filters
5. **Response**: AI formats and presents the results to the user

## MCP Server (Optional)

The project includes an MCP server (`lib/mcp-server.ts`) that can be run standalone:

```bash
npx tsx lib/mcp-server.ts
```

This allows the auctions API to be used as an MCP tool by other AI applications.

## Environment Variables

Read only in `lib/env.ts` (AR-42) and listed, with comments, in `.env.example` (AR-44). None is a secret.

| Variable                       | Where  | Default                          | Purpose                                                                    |
| ------------------------------ | ------ | -------------------------------- | -------------------------------------------------------------------------- |
| `NEXT_PUBLIC_AUCTIONS_API_URL` | public | `http://localhost:3000`          | Backend origin as the browser reaches it (no trailing slash, no `/api`)    |
| `NEXT_PUBLIC_SITE_URL`         | public | `https://faroldosleiloes.com.br` | Canonical site origin (metadata, sitemap, robots)                          |
| `BACKEND_API_URL`              | server | `NEXT_PUBLIC_AUCTIONS_API_URL`   | Backend origin as the Next.js server reaches it (API routes, SSR, sitemap) |

`BACKEND_API_URL` replaces the former `AUCTIONS_API_URL` (and the two spellings the API routes used).
`OPENAI_API_KEY` is no longer read by the frontend.

## Calling the backend (BFF)

API routes under `app/api` are thin proxies built on `lib/backend.ts`: `proxyToBackend` forwards the
method, the raw body and the `Authorization` header, and returns the backend's status and JSON body
verbatim, so the `{ code, context }` error body (AR-37/AR-38) reaches the browser untouched. The BFF
itself answers only `UNAUTHENTICATED` (401, no token) and `BACKEND_UNAVAILABLE` (502).

## Dates and reminder pickers

Dates use `date-fns` and `@date-fns/tz`, with the shared `TIME_ZONE` (`America/Sao_Paulo`)
from `i18n/config.ts` (AR-22/AR-23). Render dates through `DateText` and the formatters in
`lib/dates.ts` (DS-29).

Reminder forms use the shared `DateField` primitive (DS-26), which accepts and returns API
strings and handles the `ptBR` pickers centrally. Strict instant inputs use `tryParseInstant`;
Date values are serialized through `toUtcInstant` from `lib/dates.ts` (AR-22). Invalid stored
dates render the catalogue fallback through `DateText` and stay editable in `DateField`.

`DateField` uses `BrasiliaDateAdapter`, a focused date-fns adapter extension whose construction
and parsing entry points return Brasília `TZDate` values. Date-fns preserves that zone during
picker edits, so a browser daylight-saving gap cannot normalize a valid Brasília time (#86).
Calendar dates are constructed from their own year/month/day and leave as `YYYY-MM-DD`.
Date-time fields and their minimum have **minute precision**: hidden seconds/milliseconds are
ignored in the picker, and edits emit UTC with `:00.000` seconds. Merely displaying an external
value does not rewrite its parent string; an untouched form can retain its original precision.
`instantToWallClock` itself preserves the instant's seconds/milliseconds; the field applies
minute precision at its input boundary and `wallClockToInstant` at serialization.

The general Vitest worker zone is pinned to `Asia/Tokyo`. Date helpers, the adapter and the real
picker tests run in separate forked workers in `America/Los_Angeles`, `America/Sao_Paulo` and
`Asia/Tokyo`, asserting the actual native zone. Run only that matrix with
`npm test -- --project 'dates:*'` (TS-11).

## Technologies

- [Next.js 16](https://nextjs.org/)
- [LangChain](https://js.langchain.com/)
- [OpenAI](https://platform.openai.com/)
- [MCP SDK](https://modelcontextprotocol.io/)
- [MUI](https://mui.com/)
- [TypeScript](https://www.typescriptlang.org/)
