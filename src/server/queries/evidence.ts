/**
 * Read models for the Evidence screens. Everything here is computed on the
 * server, filtered by the workspace replay clock, and redacted before it is
 * returned, so no page component ever sees an unmasked SSN, account number,
 * PIN, EFIN or PTIN.
 */
import { and, eq, inArray, isNull, like, or } from "drizzle-orm";
import * as t from "@/db/schema";
import { AREAS, areaForDocument, areaLabel } from "@/domain/areas";
import type { LineStatus } from "@/domain/effective";
import { makeRedactor, type Redactor } from "@/domain/redaction";
import { availableAt, isAvailable } from "@/packet/availability";
import { indexPacket } from "@/packet/load";
import { parseRef, resolvePointer, resolveRef } from "@/packet/refs";
import type { ExtractedValue, Packet, PacketDocument } from "@/packet/types";
import type { SessionContext } from "../context";
import { loadWorkspaceState, type WorkspaceState } from "../state";
import { compactJson, displayExtractedValue, usesOf, workpaperUsesOf, type LineUse, type WorkpaperUse } from "./trace";

/* ------------------------------------------------------------------------ */
/* Shared helpers                                                            */
/* ------------------------------------------------------------------------ */

export type Disposition = "used" | "not_used" | "superseded" | "not_yet_available" | "not_extracted";

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  used: "Used by the return",
  not_used: "Not used by the engine",
  superseded: "Superseded",
  not_yet_available: "Not yet available",
  not_extracted: "Not extracted",
};

function clockIso(ctx: SessionContext): string {
  return new Date(ctx.workspace.asOf).toISOString();
}

function belongsToLabel(packet: Packet, belongsTo: string): string {
  const m = belongsTo.match(/^dependent:(.+)$/);
  if (m) {
    const p = indexPacket(packet).people.get(m[1]);
    return p ? `dependent: ${p.name}` : belongsTo;
  }
  if (belongsTo === "taxpayer" || belongsTo === "spouse") {
    const p = packet.household.people.find((x) => x.role === belongsTo);
    return p ? `${belongsTo}: ${p.name}` : belongsTo;
  }
  return belongsTo;
}

export function typeLabel(documentType: string): string {
  if (/^\d/.test(documentType) || /^[A-Z]-?\d/.test(documentType) || /^K-1/.test(documentType)) return `Form ${documentType}`;
  return documentType.replace(/_/g, " ");
}

interface Supersession {
  supersededBy: string[];
  supersedes: string[];
}

/** Supersession edges in the active version, keyed by document id. */
async function supersessionMap(ctx: SessionContext): Promise<Map<string, Supersession>> {
  const rows = await ctx.db
    .select({ fromRef: t.referenceEdges.fromRef, toRef: t.referenceEdges.toRef })
    .from(t.referenceEdges)
    .where(
      and(
        eq(t.referenceEdges.packetId, ctx.workspace.packetId),
        eq(t.referenceEdges.relation, "supersedes"),
        eq(t.referenceEdges.version, ctx.workspace.activeVersion),
        or(isNull(t.referenceEdges.workspaceId), eq(t.referenceEdges.workspaceId, ctx.workspace.id)),
      ),
    );
  const map = new Map<string, Supersession>();
  const get = (id: string) => {
    const hit = map.get(id);
    if (hit) return hit;
    const fresh = { supersededBy: [], supersedes: [] };
    map.set(id, fresh);
    return fresh;
  };
  for (const r of rows) {
    get(r.fromRef).supersedes.push(r.toRef);
    get(r.toRef).supersededBy.push(r.fromRef);
  }
  return map;
}

/** Document ids a reference points into (a value, a page or the document itself). */
function documentOfRef(packet: Packet, ref: string): string | null {
  const parsed = parseRef(ref);
  if (parsed.kind === "document") return parsed.id;
  if (parsed.kind === "document_page") return parsed.documentId;
  if (parsed.kind === "extracted_value") return indexPacket(packet).extractedValues.get(parsed.id)?.document_id ?? null;
  return null;
}

function workpaperDocumentCounts(packet: Packet, state: WorkspaceState): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (refs: string[]) => {
    const docs = new Set<string>();
    for (const r of refs) {
      const d = documentOfRef(packet, r);
      if (d) docs.add(d);
    }
    for (const d of docs) counts.set(d, (counts.get(d) ?? 0) + 1);
  };
  for (const a of state.adjustments) bump(a.evidenceRefs);
  for (const v of state.verifications) bump([...v.evidenceRefs, v.subjectRef]);
  for (const an of state.anchors) bump([an.documentId]);
  for (const f of state.findings) bump(f.refs);
  return counts;
}

/* ------------------------------------------------------------------------ */
/* Document index                                                            */
/* ------------------------------------------------------------------------ */

export interface DocumentIndexRow {
  id: string;
  title: string;
  documentType: string;
  typeLabel: string;
  issuer: string;
  belongsTo: string;
  belongsToLabel: string;
  receivedAt: string;
  uploadedBy: string;
  pageCount: number;
  markedCorrected: boolean;
  extractionStatus: PacketDocument["extraction"]["status"];
  extractionValues: number;
  extractionReason: string | null;
  area: string;
  areaLabel: string;
  available: boolean;
  supersededBy: string | null;
  supersedes: string | null;
  /** Active-version return lines that cite at least one of the document's extracted values. */
  directUses: number;
  /** Distinct extracted values of the document cited by those lines. */
  usedValues: number;
  /** Workpaper records (adjustments, verifications, anchors, findings) that point into the document. */
  workpaperUses: number;
  disposition: Disposition;
  dispositionLabel: string;
}

export interface DocumentIndex {
  asOf: string;
  version: string;
  rows: DocumentIndexRow[];
  counts: Record<Disposition, number>;
  areas: { id: string; label: string; count: number }[];
}

export async function loadDocumentIndex(ctx: SessionContext): Promise<DocumentIndex> {
  const packet = ctx.packet.packet;
  const idx = indexPacket(packet);
  const redact = makeRedactor(packet);
  const asOf = clockIso(ctx);
  const [state, supersession, valueEdges] = await Promise.all([
    loadWorkspaceState(ctx.db, ctx),
    supersessionMap(ctx),
    ctx.db
      .select({ fromRef: t.referenceEdges.fromRef, toRef: t.referenceEdges.toRef })
      .from(t.referenceEdges)
      .where(
        and(
          eq(t.referenceEdges.packetId, ctx.workspace.packetId),
          eq(t.referenceEdges.origin, "engine"),
          eq(t.referenceEdges.version, ctx.workspace.activeVersion),
          eq(t.referenceEdges.relation, "supports"),
          like(t.referenceEdges.fromRef, "ev-%"),
        ),
      ),
  ]);
  const linesByDoc = new Map<string, Set<string>>();
  const valuesByDoc = new Map<string, Set<string>>();
  const activeLines = idx.linesByVersion.get(ctx.workspace.activeVersion)!;
  for (const e of valueEdges) {
    if (!activeLines.has(e.toRef)) continue;
    const ev = idx.extractedValues.get(e.fromRef);
    if (!ev) continue;
    (linesByDoc.get(ev.document_id) ?? linesByDoc.set(ev.document_id, new Set()).get(ev.document_id)!).add(e.toRef);
    (valuesByDoc.get(ev.document_id) ?? valuesByDoc.set(ev.document_id, new Set()).get(ev.document_id)!).add(ev.id);
  }
  const workpaperCounts = workpaperDocumentCounts(packet, state);

  const rows: DocumentIndexRow[] = packet.documents.map((d) => {
    const available = isAvailable(packet, d.id, asOf);
    const sup = supersession.get(d.id);
    const supersededBy = sup?.supersededBy[0] ?? null;
    const directUses = linesByDoc.get(d.id)?.size ?? 0;
    const disposition: Disposition = !available
      ? "not_yet_available"
      : supersededBy
        ? "superseded"
        : d.extraction.status === "not_extracted"
          ? "not_extracted"
          : directUses > 0
            ? "used"
            : "not_used";
    const area = areaForDocument(d.document_type, d.issuer);
    return {
      id: d.id,
      title: d.title,
      documentType: d.document_type,
      typeLabel: typeLabel(d.document_type),
      issuer: d.issuer,
      belongsTo: d.belongs_to,
      belongsToLabel: belongsToLabel(packet, d.belongs_to),
      receivedAt: d.received_at,
      uploadedBy: d.uploaded_by,
      pageCount: d.page_count,
      markedCorrected: d.marked_corrected === true,
      extractionStatus: d.extraction.status,
      extractionValues: d.extraction.values,
      extractionReason: d.extraction.reason,
      area,
      areaLabel: areaLabel(area),
      available,
      supersededBy,
      supersedes: sup?.supersedes[0] ?? null,
      directUses,
      usedValues: valuesByDoc.get(d.id)?.size ?? 0,
      workpaperUses: workpaperCounts.get(d.id) ?? 0,
      disposition,
      dispositionLabel: DISPOSITION_LABELS[disposition],
    };
  });
  const counts: Record<Disposition, number> = { used: 0, not_used: 0, superseded: 0, not_yet_available: 0, not_extracted: 0 };
  for (const r of rows) counts[r.disposition] += 1;
  const areas = AREAS.map((a) => ({ id: a.id, label: a.label, count: rows.filter((r) => r.area === a.id).length })).filter((a) => a.count > 0);
  return redact.deep({ asOf, version: ctx.workspace.activeVersion, rows, counts, areas });
}

/* ------------------------------------------------------------------------ */
/* Source page                                                               */
/* ------------------------------------------------------------------------ */

export type AnchorState = "found" | "not_found" | "ambiguous" | "empty";

export const ANCHOR_STATE_LABELS: Record<AnchorState, string> = {
  found: "found exactly once on the page",
  not_found: "not found on page",
  ambiguous: "ambiguous: printed more than once",
  empty: "nothing was read (empty text)",
};

export interface PageValue {
  id: string;
  field: string;
  label: string;
  display: string;
  valueType: ExtractedValue["value_type"];
  confidence: number;
  textAsRead: string;
  anchorState: AnchorState;
  occurrences: number;
  /** Synthetic pipeline box, shown as secondary metadata only. */
  position: ExtractedValue["position"];
  /** Active-version lines citing this value directly. */
  usedBy: string[];
  /** Printed text found near a label when the extracted text is not on the page (for example the Tax ID after "Tax ID "). */
  printedCandidate: { label: string; printed: string; differs: boolean } | null;
}

export interface PageSegment {
  text: string;
  values: string[];
  anchors: string[];
  printed: string[];
}

export interface PageAnchor {
  id: string;
  subjectRef: string;
  subjectLabel: string;
  textSpan: string;
  note: string | null;
  createdBy: string;
  createdRevision: number;
  located: boolean;
}

export interface PageView {
  document: {
    id: string;
    title: string;
    documentType: string;
    typeLabel: string;
    issuer: string;
    belongsTo: string;
    belongsToLabel: string;
    receivedAt: string;
    uploadedBy: string;
    fileName: string;
    pageCount: number;
    markedCorrected: boolean;
    extractionStatus: PacketDocument["extraction"]["status"];
    extractionValues: number;
    extractionReason: string | null;
    area: string;
    areaLabel: string;
    supersededBy: { id: string; title: string } | null;
    supersedes: { id: string; title: string } | null;
  };
  asOf: string;
  version: string;
  available: boolean;
  availableOn: string;
  page: number;
  pageExists: boolean;
  pageRef: string;
  /** Redacted printed content; null when the page is not yet available. */
  printed: string | null;
  segments: PageSegment[];
  values: PageValue[];
  selectedValue: string | null;
  anchors: PageAnchor[];
  landed: {
    direct: LineUse[];
    transitive: LineUse[];
    /** Line keys in other versions citing anything on this page. */
    byVersion: Record<string, string[]>;
    otherEngineUses: { ref: string; label: string; version: string | null; relation: string }[];
    /** Engine line notes that mention this document by id. */
    engineNotes: { key: string; label: string; note: string }[];
    /** Values on this page that no active-version line cites. */
    unusedValues: string[];
    nothingLanded: boolean;
  };
  workpaper: WorkpaperUse[];
  verificationTypes: string[];
  areas: { id: string; label: string }[];
  subjectSuggestions: { ref: string; label: string }[];
}

interface Range {
  start: number;
  end: number;
  kind: "value" | "anchor" | "printed";
  id: string;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function nthIndex(haystack: string, needle: string, n: number): number {
  let from = 0;
  let at = -1;
  for (let i = 0; i <= n; i++) {
    at = haystack.indexOf(needle, from);
    if (at < 0) return -1;
    from = at + 1;
  }
  return at;
}

export function segmentText(text: string, ranges: Range[]): PageSegment[] {
  const bounds = new Set<number>([0, text.length]);
  for (const r of ranges) {
    bounds.add(r.start);
    bounds.add(r.end);
  }
  const points = [...bounds].sort((a, b) => a - b);
  const out: PageSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i];
    const e = points[i + 1];
    if (e <= s) continue;
    const seg: PageSegment = { text: text.slice(s, e), values: [], anchors: [], printed: [] };
    for (const r of ranges) {
      if (r.start <= s && r.end >= e) {
        if (r.kind === "value") seg.values.push(r.id);
        else if (r.kind === "anchor") seg.anchors.push(r.id);
        else seg.printed.push(r.id);
      }
    }
    out.push(seg);
  }
  return out;
}

/** Label heuristics for value types whose extracted text may differ from what is printed. */
const LABEL_HEURISTICS: Partial<Record<ExtractedValue["value_type"], { label: string; pattern: RegExp }[]>> = {
  ein: [
    { label: "Tax ID", pattern: /Tax ID\s*:?\s*#?\s*(\d{2}-\d{7})/g },
    { label: "EIN", pattern: /\bEIN\s*:?\s*#?\s*(\d{2}-\d{7})/g },
  ],
};

function findPrintedCandidate(printed: string, ev: ExtractedValue): { label: string; printed: string; start: number; end: number } | null {
  const rules = LABEL_HEURISTICS[ev.value_type];
  if (!rules) return null;
  for (const rule of rules) {
    const hits = [...printed.matchAll(rule.pattern)];
    if (hits.length !== 1) continue;
    const m = hits[0];
    const full = m[0];
    const captured = m[1];
    const offset = (m.index ?? 0) + full.lastIndexOf(captured);
    return { label: rule.label, printed: captured, start: offset, end: offset + captured.length };
  }
  return null;
}

export function locateExtractedValue(ctx: SessionContext, evId: string): { documentId: string; page: number; label: string } | null {
  const ev = indexPacket(ctx.packet.packet).extractedValues.get(evId);
  if (!ev) return null;
  return { documentId: ev.document_id, page: ev.page, label: ev.label };
}

export async function loadDocumentPage(
  ctx: SessionContext,
  documentId: string,
  page: number,
  options: { selectedValue?: string | null } = {},
): Promise<PageView | null> {
  const packet = ctx.packet.packet;
  const idx = indexPacket(packet);
  const redact = makeRedactor(packet);
  const doc = idx.documents.get(documentId);
  if (!doc) return null;
  const asOf = clockIso(ctx);
  const available = isAvailable(packet, doc.id, asOf);
  const pageRow = doc.pages.find((p) => p.page === page);
  const pageRef = `doc:${doc.id}#page${page}`;
  const [state, supersession] = await Promise.all([loadWorkspaceState(ctx.db, ctx), supersessionMap(ctx)]);
  const sup = supersession.get(doc.id);
  const supersededById = sup?.supersededBy[0] ?? null;
  const supersedesId = sup?.supersedes[0] ?? null;
  const area = areaForDocument(doc.document_type, doc.issuer);
  const activeLines = idx.linesByVersion.get(ctx.workspace.activeVersion)!;
  const docMention = new RegExp(`\\b${doc.id}\\b`);
  const engineNotes = [...activeLines.values()]
    .filter((l) => l.note && docMention.test(l.note))
    .map((l) => ({ key: l.key, label: `${l.form} line ${l.line}: ${l.label}`, note: l.note! }));

  const document: PageView["document"] = {
    id: doc.id,
    title: doc.title,
    documentType: doc.document_type,
    typeLabel: typeLabel(doc.document_type),
    issuer: doc.issuer,
    belongsTo: doc.belongs_to,
    belongsToLabel: belongsToLabel(packet, doc.belongs_to),
    receivedAt: doc.received_at,
    uploadedBy: doc.uploaded_by,
    fileName: doc.file_name,
    pageCount: doc.page_count,
    markedCorrected: doc.marked_corrected === true,
    extractionStatus: doc.extraction.status,
    extractionValues: doc.extraction.values,
    extractionReason: doc.extraction.reason,
    area,
    areaLabel: areaLabel(area),
    supersededBy: supersededById ? { id: supersededById, title: idx.documents.get(supersededById)?.title ?? supersededById } : null,
    supersedes: supersedesId ? { id: supersedesId, title: idx.documents.get(supersedesId)?.title ?? supersedesId } : null,
  };
  const base = {
    document,
    asOf,
    version: ctx.workspace.activeVersion,
    available,
    availableOn: doc.received_at,
    page,
    pageExists: Boolean(pageRow),
    pageRef,
    selectedValue: options.selectedValue ?? null,
    verificationTypes: packet.firm.starter_standards.verification_types,
    areas: AREAS.map((a) => ({ id: a.id, label: a.label })),
  };

  if (!available || !pageRow) {
    // Never return the content of a page that has not arrived yet (or does not exist).
    return redact.deep({
      ...base,
      printed: null,
      segments: [],
      values: [],
      anchors: [],
      landed: { direct: [], transitive: [], byVersion: {}, otherEngineUses: [], engineNotes, unusedValues: [], nothingLanded: true },
      workpaper: available ? workpaperUsesOf(packet, state, new Set([doc.id])) : [],
      subjectSuggestions: [],
    });
  }

  // Everything below works on redacted strings so a mask can never shift an offset.
  const printed = redact.text(pageRow.printed_content);
  const pageValues = idx.valuesByPage.get(`${doc.id}#${page}`) ?? [];
  const uses = await usesOf(ctx, pageRef, state);
  const usedBy = new Map<string, string[]>();
  for (const d of uses.direct) for (const via of d.via) (usedBy.get(via) ?? usedBy.set(via, []).get(via)!).push(d.key);

  const ranges: Range[] = [];
  const values: PageValue[] = pageValues.map((ev) => {
    const textAsRead = redact.text(ev.text_as_read ?? "");
    const occurrences = countOccurrences(printed, textAsRead);
    const anchorState: AnchorState = !textAsRead ? "empty" : occurrences === 0 ? "not_found" : occurrences === 1 ? "found" : "ambiguous";
    if (anchorState === "found") {
      const start = printed.indexOf(textAsRead);
      ranges.push({ start, end: start + textAsRead.length, kind: "value", id: ev.id });
    }
    let printedCandidate: PageValue["printedCandidate"] = null;
    if (anchorState === "not_found") {
      const c = findPrintedCandidate(printed, ev);
      if (c) {
        printedCandidate = { label: c.label, printed: c.printed, differs: c.printed !== textAsRead };
        ranges.push({ start: c.start, end: c.end, kind: "printed", id: ev.id });
      }
    }
    return {
      id: ev.id,
      field: ev.field,
      label: ev.label,
      display: displayExtractedValue(ev),
      valueType: ev.value_type,
      confidence: ev.confidence,
      textAsRead,
      anchorState,
      occurrences,
      position: ev.position,
      usedBy: (usedBy.get(ev.id) ?? []).sort(),
      printedCandidate,
    };
  });

  const anchors: PageAnchor[] = state.anchors
    .filter((a) => a.documentId === doc.id && a.page === page)
    .map((a) => {
      const raw = pageRow.printed_content;
      const occurrence = countOccurrences(raw.slice(0, a.startOffset), a.textSpan);
      const span = redact.text(a.textSpan);
      const at = nthIndex(printed, span, occurrence);
      if (at >= 0) ranges.push({ start: at, end: at + span.length, kind: "anchor", id: a.id });
      return {
        id: a.id,
        subjectRef: a.subjectRef,
        subjectLabel: resolveRef(packet, a.subjectRef, { version: ctx.workspace.activeVersion }).label,
        textSpan: span,
        note: a.note,
        createdBy: a.createdBy,
        createdRevision: a.createdRevision,
        located: at >= 0,
      };
    });

  const unusedValues = values.filter((v) => v.usedBy.length === 0).map((v) => v.id);
  const subjectSuggestions: { ref: string; label: string }[] = [
    ...uses.direct.map((d) => ({ ref: d.key, label: `${d.form} line ${d.line}: ${d.label}` })),
    ...values.map((v) => ({ ref: v.id, label: v.label })),
  ];

  const view: PageView = {
    ...base,
    printed,
    segments: segmentText(printed, ranges),
    values,
    anchors,
    landed: {
      direct: uses.direct,
      transitive: uses.transitive,
      byVersion: uses.byVersion,
      otherEngineUses: uses.otherEngineUses,
      engineNotes,
      unusedValues,
      nothingLanded: uses.direct.length === 0,
    },
    workpaper: workpaperUsesOf(packet, state, new Set([...uses.expanded, doc.id])),
    subjectSuggestions,
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* Client items                                                              */
/* ------------------------------------------------------------------------ */

export interface ClientLineUse {
  key: string;
  form: string;
  line: string;
  label: string;
  value: number | string | boolean | null;
  status: LineStatus;
}

export interface ClientItem {
  id: string;
  kind: "questionnaire" | "message" | "call_note";
  at: string;
  available: boolean;
  who: string;
  title: string;
  body: string | null;
  notes: string[];
  lines: ClientLineUse[];
  byVersion: Record<string, string[]>;
  workpaper: WorkpaperUse[];
}

export interface ClientItems {
  asOf: string;
  version: string;
  questionnaire: ClientItem[];
  messages: ClientItem[];
  callNotes: ClientItem[];
}

export async function loadClientItems(ctx: SessionContext): Promise<ClientItems> {
  const packet = ctx.packet.packet;
  const idx = indexPacket(packet);
  const redact = makeRedactor(packet);
  const asOf = clockIso(ctx);
  const ids = [
    ...packet.client.questionnaire.map((q) => q.id),
    ...packet.client.messages.map((m) => m.id),
    ...packet.client.call_notes.map((c) => c.id),
  ];
  const [state, edges] = await Promise.all([
    loadWorkspaceState(ctx.db, ctx),
    ctx.db
      .select({ fromRef: t.referenceEdges.fromRef, toRef: t.referenceEdges.toRef, version: t.referenceEdges.version, origin: t.referenceEdges.origin })
      .from(t.referenceEdges)
      .where(
        and(
          eq(t.referenceEdges.packetId, ctx.workspace.packetId),
          or(isNull(t.referenceEdges.workspaceId), eq(t.referenceEdges.workspaceId, ctx.workspace.id)),
          inArray(t.referenceEdges.fromRef, ids),
        ),
      ),
  ]);
  const activeLines = idx.linesByVersion.get(ctx.workspace.activeVersion)!;
  const byItem = new Map<string, Record<string, Set<string>>>();
  for (const e of edges) {
    if (e.origin !== "engine" || !e.version || parseRef(e.toRef).kind !== "line") continue;
    const rec = byItem.get(e.fromRef) ?? byItem.set(e.fromRef, {}).get(e.fromRef)!;
    (rec[e.version] ??= new Set()).add(e.toRef);
  }
  const build = (id: string, kind: ClientItem["kind"], at: string, who: string, title: string, body: string | null, notes: string[]): ClientItem => {
    const available = isAvailable(packet, id, asOf);
    const versions = byItem.get(id) ?? {};
    const activeKeys = [...(versions[ctx.workspace.activeVersion] ?? [])].sort();
    const lines = activeKeys
      .map((k) => activeLines.get(k))
      .filter((l): l is NonNullable<typeof l> => Boolean(l))
      .map((l) => ({ key: l.key, form: l.form, line: l.line, label: l.label, value: l.value, status: state.effective.lines.get(l.key)?.status ?? "baseline" }));
    return {
      id,
      kind,
      at,
      available,
      who,
      title,
      body: available ? body : null,
      notes: available ? notes : [],
      lines,
      byVersion: Object.fromEntries(Object.entries(versions).map(([v, s]) => [v, [...s].sort()])),
      workpaper: workpaperUsesOf(packet, state, new Set([id])),
    };
  };
  const questionnaire = packet.client.questionnaire.map((q) => build(q.id, "questionnaire", q.answered_at, q.answered_by, q.question, q.answer, []));
  const messages = packet.client.messages.map((m) => build(m.id, "message", m.sent_at, m.from, `Message from ${m.from} to ${m.to}`, m.text, []));
  const callNotes = packet.client.call_notes.map((c) => build(c.id, "call_note", c.date, c.participants.join(", "), `Call with ${c.participants.join(", ")}`, null, c.notes));
  return redact.deep({ asOf, version: ctx.workspace.activeVersion, questionnaire, messages, callNotes });
}

/* ------------------------------------------------------------------------ */
/* Records: prior years, agency, household, engine reference                 */
/* ------------------------------------------------------------------------ */

export interface PriorLine {
  key: string;
  ref: string;
  label: string;
  value: unknown;
  display: string;
  sourceRef: string | null;
  sourceLabel: string | null;
  sourceFound: boolean;
  note: string | null;
}

export interface AssetRecord {
  ref: string;
  pointer: string;
  assetId: string;
  description: string;
  activity: string;
  cost: number | null;
  landValue: number | null;
  placedInService: string;
  method: string;
  lifeYears: number | null;
  disposed: string | null;
  federal: { year: string; amount: number }[];
  california: { year: string; amount: number }[];
  amtDifference: string;
  sources: string[];
}

export interface BasisGroup {
  ref: string;
  key: string;
  label: string;
  rows: { ref: string; fields: { key: string; label: string; display: string; unknown: boolean }[] }[];
}

export interface AgencySnapshot {
  ref: string;
  asOf: string;
  available: boolean;
  transactions: { date: string; code: string; description: string; amount: number }[] | null;
}

export interface AgencyNotice {
  ref: string;
  id: string;
  agency: string;
  type: string;
  taxYear: number;
  dated: string;
  available: boolean;
  summary: string | null;
  status: string | null;
  responseDue: string | null;
  items: string[];
  document: string | null;
}

export interface EfileRow {
  ref: string;
  date: string;
  available: boolean;
  jurisdiction: string | null;
  submissionId: string | null;
  status: string | null;
  errors: { code: string; message: string }[];
}

export interface RecordsView {
  asOf: string;
  version: string;
  priorReturn: {
    ref: string;
    preparedBy: string;
    filed: string;
    residency: string;
    sourceDocument: string;
    dependents: { name: string; ssn: string }[];
    lines: PriorLine[];
    notes: { key: string; note: string }[];
    k1_1120S: { ref: string; fields: { key: string; display: string }[] };
    k1_1065: { ref: string; fields: { key: string; display: string }[] };
  };
  priorWorkpaper: {
    ref: string;
    sourceDocument: string;
    summaryMemo: string;
    notes: string[];
    openItems: string[];
    depreciationSchedule: string;
  };
  assets: AssetRecord[];
  basis: BasisGroup[];
  carryovers: {
    ref: string;
    federal: { key: string; ref: string; label: string; display: string }[];
    california: { key: string; ref: string; label: string; display: string }[];
    californiaNote: string | null;
    sources: string | null;
  };
  agency: {
    irs: AgencySnapshot[];
    ftb: { ref: string; asOf: string; available: boolean; payments2025: { date: string; amount: number }[] | null; payments2024AfterFiling: { date: string; amount: number; note?: string }[] | null };
    notices: AgencyNotice[];
    efile: EfileRow[];
  };
  household: {
    filingStatus: string;
    taxYear: number;
    enteredBy: string;
    priorYearAgiForEsignature: number;
    people: {
      id: string;
      ref: string;
      role: string;
      name: string;
      ssn: string;
      dob: string;
      occupation: string | null;
      relationship: string | null;
      monthsLivedWithYou: number | null;
      fullTimeStudent: boolean | null;
      note: string | null;
      ownIncome: string | null;
      ipPin: string | null;
      phone: string | null;
      email: string | null;
    }[];
    addresses: { from: string; to: string | null; address: string; type: string }[];
    residency: { state: string; from: string; to: string; status: string }[];
    bank: { routing: string; account: string; type: string; bank: string };
    relatedReturns: { who: string; return: string; preparedBy: string; inThisPacket: string }[];
  };
  engine: {
    parameters: { name: string; ref: string; display: string }[];
    rules: { code: string; text: string }[];
  };
  /** Records named by ?pointer= that are rendered on this page, or resolved inline when they are not. */
  pointers: { ref: string; found: boolean; label: string; display: string | null }[];
}

function humanKey(key: string): string {
  return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function displayUnknown(v: unknown): { display: string; unknown: boolean } {
  if (v === null || v === undefined) return { display: "unknown", unknown: true };
  if (typeof v === "number") return { display: compactJson(v), unknown: false };
  return { display: compactJson(v), unknown: false };
}

function yearMap(v: unknown): { year: string; amount: number }[] {
  if (!v || typeof v !== "object") return [];
  return Object.entries(v as Record<string, unknown>)
    .filter(([, amount]) => typeof amount === "number")
    .map(([year, amount]) => ({ year, amount: amount as number }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

export async function loadRecords(ctx: SessionContext, pointers: string[] = []): Promise<RecordsView> {
  const packet = ctx.packet.packet;
  const redact: Redactor = makeRedactor(packet);
  const asOf = clockIso(ctx);
  const version = ctx.workspace.activeVersion;
  const py = packet.prior_years as Record<string, unknown>;

  const ret = (py.return_2024 ?? {}) as {
    prepared_by?: string;
    filed?: string;
    residency?: string;
    dependents?: { name: string; ssn: string }[];
    lines?: Record<string, unknown>;
    line_labels?: Record<string, string>;
    line_sources?: Record<string, string>;
    notes?: Record<string, string>;
    K1_1120S?: Record<string, unknown>;
    K1_1065?: Record<string, unknown>;
  };
  const lines: PriorLine[] = Object.entries(ret.lines ?? {}).map(([key, value]) => {
    const sourceRef = ret.line_sources?.[key] ?? null;
    const resolved = sourceRef ? resolveRef(packet, sourceRef, { version }) : null;
    return {
      key,
      ref: `py:/return_2024/lines/${key}`,
      label: ret.line_labels?.[key] ?? key,
      value,
      display: typeof value === "number" ? compactJson(value) : compactJson(value),
      sourceRef,
      sourceLabel: resolved?.label ?? null,
      sourceFound: resolved?.found ?? false,
      note: ret.notes?.[key] ?? null,
    };
  });
  const fields = (o: Record<string, unknown> | undefined) => Object.entries(o ?? {}).map(([key, v]) => ({ key, display: compactJson(v) }));

  const wp = (py.prior_preparer_workpaper ?? {}) as {
    source_document?: string;
    summary_memo?: string;
    notes?: string[];
    open_items_left_by_prior_preparer?: string[];
    depreciation_schedule?: string;
  };

  const assets: AssetRecord[] = ((py.asset_records ?? []) as Record<string, unknown>[]).map((a, i) => ({
    ref: `asset:${String(a.asset_id ?? "")}`,
    pointer: `py:/asset_records/${i}`,
    assetId: String(a.asset_id ?? ""),
    description: String(a.description ?? ""),
    activity: String(a.activity ?? ""),
    cost: typeof a.cost === "number" ? a.cost : null,
    landValue: typeof a.land_value === "number" ? a.land_value : null,
    placedInService: String(a.placed_in_service ?? ""),
    method: String(a.method ?? ""),
    lifeYears: typeof a.life_years === "number" ? a.life_years : null,
    disposed: typeof a.disposed === "string" ? a.disposed : null,
    federal: yearMap(a.federal),
    california: yearMap(a.california),
    amtDifference: a.amt_difference && Object.keys(a.amt_difference as object).length ? compactJson(a.amt_difference) : "none recorded",
    sources: Array.isArray(a.sources) ? (a.sources as string[]) : [],
  }));

  const basisLabels: Record<string, string> = {
    scorp_lindqvist_family_woodworks: "S corporation stock basis: Lindqvist Family Woodworks, Inc.",
    partnership_ridgeline: "Partnership capital and outside basis: Ridgeline Real Estate Fund III LP",
    ira_nondeductible_basis_ngozi: "IRA nondeductible basis: Ngozi Okafor",
    home_7709_barton_ridge: "Home cost: 7709 Barton Ridge Dr",
  };
  const basis: BasisGroup[] = Object.entries((py.basis_records ?? {}) as Record<string, Record<string, unknown>[]>).map(([key, rows]) => ({
    ref: `py:/basis_records/${key}`,
    key,
    label: basisLabels[key] ?? humanKey(key),
    rows: (rows ?? []).map((row, i) => ({
      ref: `py:/basis_records/${key}/${i}`,
      fields: Object.entries(row).map(([k, v]) => {
        const d = displayUnknown(v);
        return { key: k, label: humanKey(k), display: d.display, unknown: d.unknown };
      }),
    })),
  }));

  const co = (py.carryovers_into_2025 ?? {}) as Record<string, unknown>;
  const coCa = (co.california ?? {}) as Record<string, unknown>;
  const carryRows = (o: Record<string, unknown>, prefix: string) =>
    Object.entries(o)
      .filter(([k, v]) => k !== "california" && k !== "sources" && k !== "note" && (typeof v === "number" || v === null))
      .map(([k, v]) => ({ key: k, ref: `${prefix}/${k}`, label: humanKey(k), display: displayUnknown(v).display }));

  const agencyRaw = packet.tax_agency_records as {
    irs_account_transcript_2025?: { as_of: string; transactions: AgencySnapshot["transactions"] }[];
    ftb_account?: { as_of: string; tax_year_2025_payments?: { date: string; amount: number }[]; tax_year_2024_payments_after_filing?: { date: string; amount: number; note?: string }[] };
    notices?: Record<string, unknown>[];
    efile?: Record<string, unknown>[];
  };
  const irs: AgencySnapshot[] = (agencyRaw.irs_account_transcript_2025 ?? []).map((s, i) => {
    const ref = `agency:/irs_account_transcript_2025/${i}`;
    const available = isAvailable(packet, ref, asOf);
    return { ref, asOf: s.as_of, available, transactions: available ? (s.transactions ?? []) : null };
  });
  const ftbAvailable = isAvailable(packet, "agency:/ftb_account", asOf);
  const ftb = {
    ref: "agency:/ftb_account",
    asOf: agencyRaw.ftb_account?.as_of ?? "",
    available: ftbAvailable,
    payments2025: ftbAvailable ? (agencyRaw.ftb_account?.tax_year_2025_payments ?? []) : null,
    payments2024AfterFiling: ftbAvailable ? (agencyRaw.ftb_account?.tax_year_2024_payments_after_filing ?? []) : null,
  };
  const notices: AgencyNotice[] = (agencyRaw.notices ?? []).map((n, i) => {
    const ref = `agency:/notices/${i}`;
    const available = isAvailable(packet, ref, asOf);
    return {
      ref,
      id: String(n.id ?? ""),
      agency: String(n.agency ?? ""),
      type: String(n.type ?? ""),
      taxYear: Number(n.tax_year ?? 0),
      dated: String(n.dated ?? ""),
      available,
      summary: available && typeof n.summary === "string" ? n.summary : null,
      status: available && typeof n.status === "string" ? n.status : null,
      responseDue: available && typeof n.response_due === "string" ? n.response_due : null,
      items: available && Array.isArray(n.items_under_examination) ? (n.items_under_examination as string[]) : [],
      document: typeof n.document === "string" ? n.document : null,
    };
  });
  const efile: EfileRow[] = (agencyRaw.efile ?? []).map((e, i) => {
    const ref = `agency:/efile/${i}`;
    const available = isAvailable(packet, ref, asOf);
    return {
      ref,
      date: String(e.date ?? ""),
      available,
      jurisdiction: available ? String(e.jurisdiction ?? "") : null,
      submissionId: available ? String(e.submission_id ?? "") : null,
      status: available ? String(e.status ?? "") : null,
      errors: available && Array.isArray(e.errors) ? (e.errors as { code: string; message: string }[]) : [],
    };
  });

  const h = packet.household;
  const household: RecordsView["household"] = {
    filingStatus: h.filing_status,
    taxYear: h.tax_year,
    enteredBy: h.entered_by,
    priorYearAgiForEsignature: h.prior_year_agi_for_esignature,
    people: h.people.map((p) => ({
      id: p.id,
      ref: `household:${p.id}`,
      role: p.role,
      name: p.name,
      ssn: p.ssn,
      dob: p.dob,
      occupation: p.occupation ?? null,
      relationship: p.relationship ?? null,
      monthsLivedWithYou: p.months_lived_with_you ?? null,
      fullTimeStudent: p.full_time_student ?? null,
      note: p.note ?? null,
      ownIncome: p.own_income ?? null,
      ipPin: p.ip_pin,
      phone: p.phone ?? null,
      email: p.email ?? null,
    })),
    addresses: h.addresses,
    residency: h.residency,
    bank: h.bank_account_for_refund_or_payment,
    relatedReturns: h.related_returns.map((r) => ({ who: r.who, return: r.return, preparedBy: r.prepared_by, inThisPacket: typeof r.in_this_packet === "string" ? r.in_this_packet : r.in_this_packet ? "yes" : "no" })),
  };

  const engine = {
    parameters: Object.entries(packet.engine_reference.parameters).map(([name, v]) => ({ name, ref: `ref:param.${name}`, display: compactJson(v, 400) })),
    rules: Object.entries(packet.engine_reference.rules).map(([code, text]) => ({ code, text })),
  };

  const pointerEntries = pointers.map((ref) => {
    const parsed = parseRef(ref);
    if (parsed.kind === "prior_year") {
      const r = resolvePointer(packet.prior_years, parsed.pointer);
      return { ref, found: r.found, label: resolveRef(packet, ref, { version }).label, display: r.found ? compactJson(r.value, 400) : null };
    }
    if (parsed.kind === "agency") {
      const r = resolvePointer(packet.tax_agency_records, parsed.pointer);
      const available = isAvailable(packet, ref, asOf);
      return {
        ref,
        found: r.found,
        label: resolveRef(packet, ref, { version }).label,
        display: !r.found ? null : available ? compactJson(r.value, 400) : `Future record (available ${availableAt(packet, ref)?.slice(0, 10)}); replay preview only, no payload shown.`,
      };
    }
    const r = resolveRef(packet, ref, { version });
    return { ref, found: r.found, label: r.label, display: r.found ? compactJson(r.value, 400) : null };
  });

  const view: RecordsView = {
    asOf,
    version,
    priorReturn: {
      ref: "py:/return_2024",
      preparedBy: ret.prepared_by ?? "",
      filed: ret.filed ?? "",
      residency: ret.residency ?? "",
      sourceDocument: "D06",
      dependents: ret.dependents ?? [],
      lines,
      notes: Object.entries(ret.notes ?? {}).map(([key, note]) => ({ key, note })),
      k1_1120S: { ref: "py:/return_2024/K1_1120S", fields: fields(ret.K1_1120S) },
      k1_1065: { ref: "py:/return_2024/K1_1065", fields: fields(ret.K1_1065) },
    },
    priorWorkpaper: {
      ref: "py:/prior_preparer_workpaper",
      sourceDocument: wp.source_document ?? "D07",
      summaryMemo: wp.summary_memo ?? "",
      notes: wp.notes ?? [],
      openItems: wp.open_items_left_by_prior_preparer ?? [],
      depreciationSchedule: wp.depreciation_schedule ?? "",
    },
    assets,
    basis,
    carryovers: {
      ref: "py:/carryovers_into_2025",
      federal: carryRows(co, "py:/carryovers_into_2025"),
      california: carryRows(coCa, "py:/carryovers_into_2025/california"),
      californiaNote: typeof coCa.note === "string" ? coCa.note : null,
      sources: typeof co.sources === "string" ? co.sources : null,
    },
    agency: { irs, ftb, notices, efile },
    household,
    engine,
    pointers: pointerEntries,
  };
  return redact.deep(view);
}
