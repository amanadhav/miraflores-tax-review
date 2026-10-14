# Trace: an evidence-centered tax workpaper

A web-native workpaper for one household's 2025 return, built for the MiraFlores
"Redesign the Tax Workpaper" case study. The core object is a reviewable claim: a
return amount or decision connected to its exact source evidence, its calculation,
every change made to it, and who approved it.

The app loads the supplied pipeline packet exactly as delivered (byte-identical,
SHA-256 verified), keeps the engine's three computed versions as an immutable
baseline, and layers reviewer work on top: verifications, adjustments with
estimated tax effects, findings that can block filing, sign-offs that reopen when
what they covered changes, and a full audit trail.

## Stack

- Next.js 16 (App Router) with TypeScript and Tailwind CSS 4
- PostgreSQL through Drizzle ORM. Any PostgreSQL works via `DATABASE_URL`; with no
  URL set the app runs an embedded PGlite database (Postgres compiled to WASM) so a
  fresh checkout starts with zero setup
- Vitest for domain and integration tests against a real in-memory Postgres

## Run it

```bash
npm install
npm run db:migrate
npm run dev
```

Open http://localhost:3000. Copy `.env.example` to `.env.local` to point at a real
PostgreSQL server; otherwise data is stored under `.data/pglite`.

## Test it

```bash
npm test
npm run typecheck
npm run lint
```

## Layout

- `data/packet.json`: the packet as supplied, never modified
- `src/packet`: packet types, loader, reference resolver, importer
- `src/db`: schema, migrations runner, database client
- `src/domain`: workpaper rules (areas, policies, effects, fingerprints, redaction)
- `src/server`: sessions and the single command dispatcher every mutation goes through
- `src/app`: screens and route handlers
- `tests`: executable acceptance scenarios

## Status

Work in progress. This README tracks what is actually implemented; a screen is
listed only when its workflow persists and enforces its rules.
