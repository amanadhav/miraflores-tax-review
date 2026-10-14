# Trace: the core idea and the data model

## The idea

A workpaper exists to prove a return is right. Trace makes the unit of proof a
**reviewable claim**: a return amount or decision, connected to the exact
printed source it came from, the calculation that produced it, every change
made to it, and the people who checked it. Everything else in the app is a
view over claims.

Five decisions follow from that:

1. **Three layers, never blended.** The engine's computed return is an
   immutable baseline. Accepted adjustments form the effective workpaper
   facts. Tax effects are estimates at the version's supplied rates, labelled
   with their limitations. The app never shows an invented "corrected final
   tax"; dependent lines whose formula cannot be verified are marked stale
   instead of silently kept.
2. **Printed text is independent of extraction.** A simulated source page is
   rendered from what the document printed; the pipeline's extracted value is
   shown beside it. Anchors must quote the page verbatim or the server refuses
   them. That is how a 97 percent confidence EIN is caught against a page that
   prints different digits.
3. **One path for every change.** Each mutation is a command carrying the
   revision the user saw and an idempotency key. The server derives the actor
   from the session, locks the engagement row, checks availability on the
   replay clock, permissions, the partner threshold and no-self-review (by
   contribution history, not just the last editor), applies the change,
   re-fingerprints every sign-off and client approval, writes the audit record
   and bumps the revision, all in one transaction. Two people editing the same
   revision cannot overwrite each other; the loser sees what changed.
4. **Approvals bind to content, not to time.** A sign-off is fingerprinted over
   the values, evidence links, open findings, standard in force and upstream
   lines it covered. Change any of them and only that sign-off reopens, with
   the reason. Client approvals bind to a hashed presentation; a change to the
   presented return reopens them and the filing state falls back.
5. **Time is replayable and evidence is dated.** A business clock filters
   documents, messages, agency snapshots and staff availability. Moving the
   clock never satisfies a review step by itself.

## The data model

**Immutable packet** (imported once, keyed by the SHA-256 of the original
bytes): `packets`, `documents`, `document_pages`, `extracted_values`,
`return_lines` (per engine version), and `reference_edges`, a directed graph
of "used by" relations (line inputs, evidence sources, supersession) indexed
in both directions for tracing. Small sections (household, firm, prior years,
agency records, timeline, engine reference, what-ifs) stay in the stored JSON
and are reached through a typed resolver that understands every reference
format in the README.

**Workspace**: one evaluator's copy of the engagement, with its revision
counter, replay clock, active engine version, workflow state and filing lock.
Sessions are httpOnly cookies naming a workspace and a persona; the role
switcher changes the persona on the server and is audited.

**Commands and audit**: `commands` (idempotency and stored results) and
`audit_events` (append-only, with business time and server time, before and
after metadata). Per-person `seen_cursors` drive "since I last looked".

**Workpaper records**: `adjustments` (prior value, proposed value, reason,
evidence, category, measure delta, estimated effects, limitations, status,
supersedes and reverts links), `findings` (engine diagnostics keep their
origin; reviewer notes can block filing), `verifications` (method, evidence,
conclusion, distinct from extraction confidence), `anchors` (exact text spans
on a page), `judgments` (authority, applicability, conclusion, consequences,
checklists), `dispositions` (completeness), `signoffs` with fingerprint parts,
and `scope_contributions` (who prepared what, for no-self-review).

**People**: `requests` and `request_replies` (a reply is evidence with
provenance and received time), `attachments` (hashed content), `tasks`
(owners, deadlines, completion evidence), `notifications`, `time_entries`
against the firm's budget areas, and versioned `standards_versions`.

**Lifecycle**: `client_approvals` bound to a presentation hash,
`filing_snapshots` (client-ready, submission, accepted, carryforward; never
updated after insert), `submissions` (one immutable row per attempt and
jurisdiction, simulated), amendment workspaces that branch from the accepted
snapshot, and `view_events` for every reveal of a sensitive value.

Real PostgreSQL in production; the same schema runs on embedded PGlite for a
zero-setup checkout and for the test suite.
