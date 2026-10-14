# Trace: an evidence-centered tax workpaper

A web-native workpaper for one household's 2025 return, built for the MiraFlores
"Redesign the Tax Workpaper" case study. The core object is a reviewable claim: a
return amount or decision connected to its exact printed source, its calculation,
every change made to it, and who approved it.

Hosted demo: https://miraflores-tax-review.vercel.app (start a workspace from the
landing page; each visitor gets their own copy of the engagement). The core idea
and data model are in [docs/one-page.md](docs/one-page.md), and the packet errors
and how the app surfaces them in [docs/errors-found.md](docs/errors-found.md).

## What it does

- **Loads the packet as delivered.** Byte-identical import keyed by SHA-256; 74
  documents, 199 pages, 3,012 extracted values, three computed versions, and a
  reference graph of 8,225 edges. A second import changes nothing.
- **Evidence.** Simulated source pages rendered from the printed text, with the
  pipeline's extracted values shown beside them and highlighted only where the
  text matches exactly. Anchors must quote the page verbatim. Any number traces to
  its sources; any document traces to every line it reached, or why it did not.
- **Calculation.** Formulas are claimed only when they reproduce the engine's
  baseline (signed sums, carries, mileage, meals); everything else is shown as the
  engine's rule and goes stale when an input changes. Books to tax, prior-year
  variance, California split, payments reconciliation and carryovers each have a
  record view, as do sales, rentals, pass-throughs, retirement and foreign items,
  deductions and credits, and depreciation by asset.
- **Change.** Proposals keep the original value, reason, evidence, author, decider
  and an estimated tax effect at the version's supplied rates with its
  limitations. Accept, reject, undo with a compensating entry, supersede, batch
  verify or disposition with undo, compare engine versions, try the supplied
  what-ifs in isolation, and see what changed since you last looked.
- **Judgment.** Judgment calls, elections, due diligence and penalty decisions
  record the authority relied on. Completeness is explicit: every document and
  area has a disposition, outside filings are tracked as tasks.
- **People.** Questions to the client or a colleague are answered in-app and the
  reply or attachment becomes citable evidence. Review notes can block filing.
  Sign-offs are fingerprinted over values, evidence, open findings, the firm
  standard and upstream lines, and reopen with a reason when any of them changes.
  Roles are enforced on the server from the session, never from the request; no
  one can review what they prepared; a material change needs the partner. Two
  sessions editing the same revision cannot overwrite each other.
- **Filing and after.** The firm's required steps are evaluated from records and
  gate presentation. Both spouses approve a hashed presentation; a change reopens
  it. Submission is simulated, freezes the payload per attempt, holds California
  until federal acceptance and locks the workpaper. A rejection reopens it,
  acceptance freezes it for good, amendments branch from the accepted snapshot,
  the client copy and the notice bundle export as self-contained files, and next
  year starts from carryovers and open items without inventing a 2026 return.
- **Firm.** Versioned standards, sensitive values masked everywhere with logged
  one-at-a-time reveals, time against budget, permission-filtered search, and a
  replay clock that filters evidence, agency snapshots and staff availability.

## Stack

- Next.js 16 (App Router) with TypeScript and Tailwind CSS 4
- PostgreSQL through Drizzle ORM. Any PostgreSQL works via `DATABASE_URL`; with no
  URL set the app runs an embedded PGlite database so a fresh checkout starts with
  zero setup. Production runs on Neon through Vercel.
- Vitest: 129 tests across import, the command workflow, concurrency on a real
  server, the filing lifecycle, exports, redaction, search and every screen's
  query layer

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
npm run build
```

## Layout

- `data/packet.json`: the packet as supplied, never modified
- `src/packet`: packet types, loader, reference resolver, availability, importer
- `src/db`: schema, migrations runner, database client
- `src/domain`: workpaper rules (areas, policy, effects, formulas, effective
  state, bridge, variance, redaction)
- `src/server`: sessions, the single command dispatcher, handlers, fingerprint
  invalidation, filing readiness, presentations, exports, queries per screen
- `src/app`: screens and route handlers
- `tests`: executable acceptance scenarios

## Known limitations

- Effects are estimates at the supplied per-dollar rates; the engine cannot be
  rerun, so interactions (SE tax, SEP, QBI, caps, thresholds) are flagged, not
  recomputed.
- E-file transmission, e-signature and agency responses are simulated and say so.
- Switching the baseline version flags adjustments that need rebasing but does not
  re-seed the engine's diagnostics for that version.
- Sensitive reveals check clearance but not the replay-time availability of the
  person revealing.
