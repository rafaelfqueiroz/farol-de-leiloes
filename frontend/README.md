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
- OpenAI API key
- Auctions API running on port 3000

## Installation

1. Install dependencies:

```bash
npm install
```

2. Create `.env` file:

```bash
cp .env.example .env
```

3. Add your OpenAI API key to `.env`:

```
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_AUCTIONS_API_URL=http://localhost:3000
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

## Scripts

| Script              | What it does                                                                            |
| ------------------- | --------------------------------------------------------------------------------------- |
| `npm run typecheck` | `tsc --noEmit`                                                                          |
| `npm test`          | Vitest (unit, component and structural tests)                                           |
| `npm run check`     | `typecheck` + `test` — provisional until lint and format land (#29); run before pushing |
| `npm run build`     | Next.js production build                                                                |
| `npm run lint`      | `next lint` — currently broken, to be replaced by ESLint in #29                         |

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
│   ├── theme/                 # MUI theme: tokens, light/dark schemes (DESIGN.md)
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # Main chat interface
├── lib/
│   ├── agent.ts               # LangChain agent logic
│   ├── money.ts, dates.ts     # Money (decimal.js) and date (date-fns) helpers
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

- `OPENAI_API_KEY`: Your OpenAI API key (required)
- `NEXT_PUBLIC_AUCTIONS_API_URL`: Auctions API URL (default: http://localhost:3000)

## Technologies

- [Next.js 16](https://nextjs.org/)
- [LangChain](https://js.langchain.com/)
- [OpenAI](https://platform.openai.com/)
- [MCP SDK](https://modelcontextprotocol.io/)
- [MUI](https://mui.com/)
- [TypeScript](https://www.typescriptlang.org/)
