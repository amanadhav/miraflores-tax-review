/**
 * Workpaper search. Every piece of text is redacted before it is matched, so
 * a query can only ever match what a viewer is allowed to see: searching for
 * a full identifier finds nothing, and probing for one digit at a time finds
 * nothing either. Results are filtered by permission and by the replay clock.
 */
import { asc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { can } from "@/domain/policy";
import { looksSensitive, makeRedactor, sensitiveLiterals, type Redactor } from "@/domain/redaction";
import { isAvailable } from "@/packet/availability";
import { indexPacket } from "@/packet/load";
import type { Packet, PacketDocument } from "@/packet/types";
import type { SessionContext } from "../context";
import { recordSensitiveAttempt } from "../reveal";

export type SearchHitType = "document" | "page" | "value" | "line" | "finding" | "adjustment" | "client";

interface HitBase {
  type: SearchHitType;
  /** Reference the hit opens with (RefLink knows where each one lives). */
  ref: string;
  title: string;
  /** Redacted text around the match. */
  snippet: string;
}

export type SearchHit =
  | (HitBase & { type: "document"; documentId: string; issuer: string; fileName: string; receivedAt: string })
  | (HitBase & { type: "page"; documentId: string; page: number })
  | (HitBase & { type: "value"; valueId: string; documentId: string; page: number; label: string; field: string; value: string })
  | (HitBase & { type: "line"; key: string; form: string; line: string; label: string; value: string; via: string | null })
  | (HitBase & { type: "finding"; findingId: string; severity: string; status: string })
  | (HitBase & { type: "adjustment"; adjustmentId: string; target: string; status: string })
  | (HitBase & { type: "client"; itemId: string; kind: "message" | "questionnaire" | "call_note"; at: string });

export interface SearchOptions {
  /** Maximum hits returned per type (default 20). */
  limitPerType?: number;
}

export interface SearchResult {
  query: string;
  asOf: string;
  hits: SearchHit[];
  /** Hits beyond the per-type limit, by type. */
  more: Partial<Record<SearchHitType, number>>;
  /** False for client users: internal content is not searched at all. */
  internal: boolean;
  /** True when the query itself looked like a sensitive value and was refused. */
  refused: boolean;
  message: string | null;
}

export const SEARCH_LIMIT = 20;
export const REFUSED_MESSAGE =
  "That looks like a full identifier. Searches for SSNs, account numbers and PINs are refused and logged; search by name, label or document instead.";
const MIN_QUERY = 2;
const SNIPPET_RADIUS = 90;

/* ------------------------------------------------------------------------ */
/* A redacted, lower-cased index of the packet, built once per packet.       */
/* ------------------------------------------------------------------------ */

interface Entry<T> {
  item: T;
  /** Redacted text shown to people. */
  text: string;
  /** Lower-cased copy of `text` used for matching (same offsets). */
  lower: string;
}

interface LineEntry {
  key: string;
  form: string;
  line: string;
  label: string;
  value: string;
  own: Entry<null>;
  /** Titles and issuers of the documents the line's sources come from. */
  evidence: Entry<null> & { documents: string[] };
}

interface ClientEntry {
  kind: "message" | "questionnaire" | "call_note";
  id: string;
  at: string;
  title: string;
}

interface PacketSearchIndex {
  documents: Entry<PacketDocument>[];
  pages: Entry<{ documentId: string; page: number; title: string }>[];
  values: (Entry<Packet["extracted_values"][number]> & { value: string })[];
  linesByVersion: Map<string, LineEntry[]>;
  client: Entry<ClientEntry>[];
}

const indexCache = new WeakMap<Packet, PacketSearchIndex>();

function entry<T>(item: T, redact: Redactor, raw: string): Entry<T> {
  const text = redact.text(raw);
  return { item, text, lower: text.toLowerCase() };
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "blank";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString("en-US") : String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return JSON.stringify(value);
}

function buildIndex(packet: Packet): PacketSearchIndex {
  const hit = indexCache.get(packet);
  if (hit) return hit;
  const redact = makeRedactor(packet);
  const idx = indexPacket(packet);

  const documents = packet.documents.map((d) => entry(d, redact, `${d.id} ${d.title} ${d.issuer} ${d.file_name} ${d.document_type.replace(/_/g, " ")}`));
  const pages = packet.documents.flatMap((d) => d.pages.map((p) => entry({ documentId: d.id, page: p.page, title: d.title }, redact, p.printed_content)));
  const values = packet.extracted_values.map((ev) => {
    const shown = redact.text(ev.text_as_read || valueText(ev.value));
    const e = entry(ev, redact, `${ev.label} ${ev.field.replace(/_/g, " ")} ${valueText(ev.value)} ${ev.text_as_read}`);
    return { ...e, value: shown };
  });

  const linesByVersion = new Map<string, LineEntry[]>();
  for (const version of packet.return_versions) {
    const entries: LineEntry[] = version.lines.map((l) => {
      const docs = new Set<string>();
      for (const s of l.sources) {
        const ev = idx.extractedValues.get(s);
        if (ev) docs.add(ev.document_id);
      }
      const documents = [...docs];
      const evidenceRaw = documents
        .map((id) => idx.documents.get(id))
        .filter((d): d is PacketDocument => Boolean(d))
        .map((d) => `${d.id} ${d.title} ${d.issuer}`)
        .join(" | ");
      const value = valueText(l.value);
      return {
        key: l.key,
        form: l.form,
        line: l.line,
        label: l.label,
        value: redact.text(value),
        own: entry(null, redact, `${l.key} ${l.form} line ${l.line} ${l.label} ${value}${l.note ? ` ${l.note}` : ""}`),
        evidence: { ...entry(null, redact, evidenceRaw), documents },
      };
    });
    linesByVersion.set(version.version, entries);
  }

  const client: Entry<ClientEntry>[] = [
    ...packet.client.questionnaire.map((q) =>
      entry<ClientEntry>({ kind: "questionnaire", id: q.id, at: q.answered_at, title: `Client answer by ${q.answered_by}` }, redact, `${q.question} ${q.answer}`),
    ),
    ...packet.client.messages.map((m) => entry<ClientEntry>({ kind: "message", id: m.id, at: m.sent_at, title: `Message from ${m.from}` }, redact, m.text)),
    ...packet.client.call_notes.map((c) =>
      entry<ClientEntry>({ kind: "call_note", id: c.id, at: c.date, title: `Call with ${c.participants.join(", ")}` }, redact, c.notes.join(" ")),
    ),
  ];

  const built: PacketSearchIndex = { documents, pages, values, linesByVersion, client };
  indexCache.set(packet, built);
  return built;
}

/* ------------------------------------------------------------------------ */
/* Matching.                                                                 */
/* ------------------------------------------------------------------------ */

function tokensOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function matches(lower: string, tokens: string[]): boolean {
  return tokens.every((tok) => lower.includes(tok));
}

/** Redacted text around the first token's first occurrence. */
function snippet(text: string, lower: string, tokens: string[]): string {
  const at = lower.indexOf(tokens[0]);
  if (at < 0) return text.length > 2 * SNIPPET_RADIUS ? `${text.slice(0, 2 * SNIPPET_RADIUS)}...` : text;
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + tokens[0].length + SNIPPET_RADIUS);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

/**
 * Whether a query is itself a sensitive value: a full SSN pattern, any
 * literal the packet knows, or the digits of one with separators removed.
 */
export function sensitiveQueryKind(packet: Packet, query: string): string | null {
  if (looksSensitive(query, packet)) return /\b\d{3}-\d{2}-\d{4}\b/.test(query) ? "ssn" : "sensitive literal";
  const compact = query.replace(/[^0-9a-z]/gi, "").toLowerCase();
  if (compact.length < 5) return null;
  for (const literal of sensitiveLiterals(packet)) {
    const lit = literal.value.replace(/[^0-9a-z]/gi, "").toLowerCase();
    if (lit.length >= 5 && compact.includes(lit)) return literal.kind;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* The search itself.                                                        */
/* ------------------------------------------------------------------------ */

export async function search(ctx: SessionContext, q: string, options: SearchOptions = {}): Promise<SearchResult> {
  const limit = Math.max(1, Math.min(options.limitPerType ?? SEARCH_LIMIT, 100));
  const query = q.replace(/\s+/g, " ").trim();
  const asOf = new Date(ctx.workspace.asOf).toISOString();
  const empty = (overrides: Partial<SearchResult>): SearchResult => ({
    query,
    asOf,
    hits: [],
    more: {},
    internal: true,
    refused: false,
    message: null,
    ...overrides,
  });

  if (!can(ctx.actor, "view_workpaper")) {
    return empty({ internal: false, message: "Search covers the firm's internal workpaper and is not available to client users." });
  }
  if (query.length < MIN_QUERY) return empty({ message: `Type at least ${MIN_QUERY} characters.` });

  const packet = ctx.packet.packet;
  const kind = sensitiveQueryKind(packet, query);
  if (kind) {
    // The query is never stored: the log records only what kind of value it looked like.
    await recordSensitiveAttempt(ctx, {
      ref: "search",
      field: "query",
      outcome: "denied",
      reason: `search text looked like a full ${kind.replace(/_/g, " ")}; refused, nothing returned, query not stored`,
    });
    return empty({ query: "", refused: true, message: REFUSED_MESSAGE });
  }

  const tokens = tokensOf(query);
  const index = buildIndex(packet);
  const redact = makeRedactor(packet);
  const available = (ref: string) => isAvailable(packet, ref, asOf);
  const availableDocs = new Set(packet.documents.filter((d) => available(d.id)).map((d) => d.id));

  const hits: SearchHit[] = [];
  const more: Partial<Record<SearchHitType, number>> = {};
  const counts: Partial<Record<SearchHitType, number>> = {};
  const push = (hit: SearchHit) => {
    const n = (counts[hit.type] ?? 0) + 1;
    counts[hit.type] = n;
    if (n <= limit) hits.push({ ...hit, snippet: redact.text(hit.snippet), title: redact.text(hit.title) });
    else more[hit.type] = (more[hit.type] ?? 0) + 1;
  };

  for (const e of index.documents) {
    if (!availableDocs.has(e.item.id) || !matches(e.lower, tokens)) continue;
    const d = e.item;
    push({
      type: "document",
      ref: d.id,
      documentId: d.id,
      title: d.title,
      issuer: d.issuer,
      fileName: d.file_name,
      receivedAt: d.received_at,
      snippet: `${d.issuer}; ${d.file_name}; ${d.page_count} page(s); received ${d.received_at.slice(0, 10)}`,
    });
  }

  for (const e of index.pages) {
    if (!availableDocs.has(e.item.documentId) || !matches(e.lower, tokens)) continue;
    push({
      type: "page",
      ref: `doc:${e.item.documentId}#page${e.item.page}`,
      documentId: e.item.documentId,
      page: e.item.page,
      title: `${e.item.title}, page ${e.item.page}`,
      snippet: snippet(e.text, e.lower, tokens),
    });
  }

  for (const e of index.values) {
    if (!availableDocs.has(e.item.document_id) || !matches(e.lower, tokens)) continue;
    const ev = e.item;
    push({
      type: "value",
      ref: ev.id,
      valueId: ev.id,
      documentId: ev.document_id,
      page: ev.page,
      label: ev.label,
      field: ev.field,
      value: e.value,
      title: ev.label,
      snippet: `${e.value} (${ev.document_id} page ${ev.page}, read as "${redact.text(ev.text_as_read)}")`,
    });
  }

  for (const l of index.linesByVersion.get(ctx.workspace.activeVersion) ?? []) {
    const own = matches(l.own.lower, tokens);
    const viaEvidence = !own && matches(l.evidence.lower, tokens);
    if (!own && !viaEvidence) continue;
    push({
      type: "line",
      ref: l.key,
      key: l.key,
      form: l.form,
      line: l.line,
      label: l.label,
      value: l.value,
      via: viaEvidence ? `matched through source evidence ${l.evidence.documents.join(", ")}` : null,
      title: `${l.form} line ${l.line}: ${l.label}`,
      snippet: viaEvidence ? `${l.value}; ${snippet(l.evidence.text, l.evidence.lower, tokens)}` : snippet(l.own.text, l.own.lower, tokens),
    });
  }

  const [findings, adjustments] = await Promise.all([
    ctx.db.select().from(t.findings).where(eq(t.findings.workspaceId, ctx.workspace.id)).orderBy(asc(t.findings.createdRevision)),
    ctx.db.select().from(t.adjustments).where(eq(t.adjustments.workspaceId, ctx.workspace.id)).orderBy(asc(t.adjustments.createdRevision)),
  ]);
  for (const f of findings) {
    const text = redact.text(`${f.title} ${f.detail}${f.code ? ` ${f.code}` : ""}`);
    const lower = text.toLowerCase();
    if (!matches(lower, tokens)) continue;
    push({
      type: "finding",
      ref: `finding:${f.id}`,
      findingId: f.id,
      severity: f.severity,
      status: f.status,
      title: f.title,
      snippet: snippet(text, lower, tokens),
    });
  }
  for (const a of adjustments) {
    const text = redact.text(`${a.targetRef} ${a.reason}${a.proposedLabel ? ` ${a.proposedLabel}` : ""}`);
    const lower = text.toLowerCase();
    if (!matches(lower, tokens)) continue;
    push({
      type: "adjustment",
      ref: `adjustment:${a.id}`,
      adjustmentId: a.id,
      target: a.targetRef,
      status: a.status,
      title: `${a.kind} change to ${a.targetRef} (${a.status})`,
      snippet: snippet(text, lower, tokens),
    });
  }

  for (const e of index.client) {
    if (!available(e.item.id) || !matches(e.lower, tokens)) continue;
    push({
      type: "client",
      ref: e.item.id,
      itemId: e.item.id,
      kind: e.item.kind,
      at: e.item.at,
      title: `${e.item.title} (${e.item.at.slice(0, 10)})`,
      snippet: snippet(e.text, e.lower, tokens),
    });
  }

  return {
    query,
    asOf,
    hits,
    more,
    internal: true,
    refused: false,
    message: hits.length === 0 ? `Nothing matched "${query}" in evidence available at ${asOf.slice(0, 10)}.` : null,
  };
}
