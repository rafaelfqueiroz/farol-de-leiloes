Auctions API (NestJS + MongoDB)

Overview
- Ingests daily CSVs from Caixa auctions (per state, option "Todos").
- Parses and normalizes fields, stores in MongoDB.
- Exposes REST endpoint to query by state, city, and modality.

Requirements
- Node.js 24.22.2 (pinned in `.node-version`; DV-05)
- MongoDB running locally or a connection string

Setup
1. Copy `.env.example` to `.env` and set `MONGODB_URI` if needed.
2. Install deps: `npm install`
3. Dev run: `npm run start:dev`
4. Build: `npm run build`, then `npm start`

API
- GET `/api/auctions?state=SP&city=Sao Paulo&modality=Compra Direta`
  - Query params: `state` (UF), `city` (prefix match), `modality` (case/accents-insensitive)
  - Pagination: `limit` (default 50, max 200), `offset`

Scheduling
- A daily job runs at 03:00 (server time) to import all states.
- Also triggers one initial import ~5s after startup.

Notes
- CSV layout from Caixa can vary; the parser is resilient to common Portuguese headers and keeps the full `raw` row for reference.
- The download step tries GET with `?UF=<state>&Cidade=Todos`, then falls back to POST form if needed.

