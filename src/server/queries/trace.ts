/**
 * Two directions of tracing that every screen shares.
 *
 * usesOf(ctx, ref): forward. Given any reference (an extracted value, a
 * document page, a whole document, a client answer, a prior-year pointer, a
 * line key, ...), what uses it: the return lines in the active version that
 * cite it directly, everything downstream of those lines, the same citation in
 * the other engine versions, and every workpaper record that points at it.
 *
 * sourcesOf(ctx, lineKey): reverse. A line's inputs and sources resolved with
 * labels, availability at the replay clock and a resolution state. A reference
 * that does not resolve is reported with found = false, never thrown.
 *
 * Both read reference_edges (engine rows with a null workspace and workpaper
 * rows for this workspace) and the workpaper tables, and both return redacted
 * data only.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import * as t from "@/db/schema";
import { areaForLine, areaLabel } from "@/domain/areas";
import { downstreamClosure, type LineStatus } from "@/domain/effective";
import { makeRedactor } from "@/domain/redaction";
import { availableAt } from "@/packet/availability";
import { indexPacket } from "@/packet/load";
import { parseRef, resolveRef, type ParsedRef } from "@/packet/refs";
import type { ExtractedValue, Packet, ReturnLine } from "@/packet/types";
import { money } from "@/lib/format";
import type { SessionContext } from "../context";
import { loadWorkspaceState, type WorkspaceState } from "../state";

export type EdgeRow = typeof t.referenceEdges.$inferSelect;

export interface LineUse {
  key: string;
  form: string;
  line: string;
  label: string;
  area: string;
  areaLabel: string;
  baseline: number | string | boolean | null;
  effective: number | string | boolean | null;
  status: LineStatus;
  rule: string;
  ruleText: string | null;
  note: string | null;
  /** Which of the traced references this line cites directly (empty for transitive uses). */
  via: string[];
  relation: "direct" | "transitive";
}

export interface WorkpaperUse {
  table: "adjustment" | "verification" | "anchor" | "finding";
  id: string;
  ref: string;
  status: string;
  /** What the record is about (target line, subject, title). */
  subject: string;
  subjectLabel: string;
  actorId: string;
  detail: string;
  /** The traced references this record cites. */
  via: string[];
  createdRevision: number;
}

export interface UsesOf {
  ref: string;
  kind: ParsedRef["kind"];
  found: boolean;
  label: string;
  version: string;
  /** Every reference that counts as "this ref" for tracing (a page expands to its values). */
  expanded: string[];
  direct: LineUse[];
  transitive: LineUse[];
  /** Line keys citing the ref directly in each engine version, from the engine edges. */
  byVersion: Record<string, string[]>;
  /** Engine uses that are not return lines (assets, prior-year lines). */
  otherEngineUses: { ref: string; label: string; version: string | null; relation: string }[];
  supersedes: { documentId: string; label: string; versions: string[] }[];
  supersededBy: { documentId: string; label: string; versions: string[] }[];
  workpaper: WorkpaperUse[];
  /** Raw edges touching the ref for this packet and workspace, for the audit-minded reviewer. */
  edges: { fromRef: string; toRef: string; relation: string; origin: string; version: string | null; workspace: boolean }[];
}

export type SourceState = "resolved" | "missing" | "not_yet_available" | "workpaper";

export interface SourceEntry {
  ref: string;
  kind: ParsedRef["kind"];
  found: boolean;
  state: SourceState;
  label: string;
  /** Short, redacted rendering of what the reference holds. */
  display: string | null;
  availableAt: string | null;
  available: boolean;
  location?: { documentId?: string; page?: number; version?: string; lineKey?: string };
  /** For extracted values: whether the engine's input matches what the page prints. */
  confidence?: number;
}

export interface InputEntry {
  key: string;
  found: boolean;
  label: string;
  baseline: number | string | boolean | null;
  effective: number | string | boolean | null;
  status: LineStatus | "missing";
}

export interface SourcesOf {
  lineKey: string;
  found: boolean;
  version: string;
  line: {
    key: string;
    form: string;
    line: string;
    label: string;
    jurisdiction: string;
    area: string;
    areaLabel: string;
    baseline: number | string | boolean | null;
    effective: number | string | boolean | null;
    status: LineStatus;
    rule: string;
    ruleText: string | null;
    note: string | null;
  } | null;
  inputs: InputEntry[];
  sources: SourceEntry[];
  /** References that did not resolve or are not yet available; reported, never thrown. */
  problems: { ref: string; state: SourceState; message: string }[];
  workpaper: WorkpaperUse[];
  edges: { fromRef: string; relation: string; origin: string; version: string | null; workspace: boolean }[];
}

/* ------------------------------------------------------------------------ */

/** The set of refs that mean "this ref" for tracing purposes. */
export function expandRef(packet: Packet, ref: string): string[] {
  const idx = indexPacket(packet);
  const parsed = parseRef(ref);
  switch (parsed.kind) {
    case "document_page": {
      const values = idx.valuesByPage.get(`${parsed.documentId}#${parsed.page}`) ?? [];
      return [ref, ...values.map((v) => v.id)];
    }
    case "document": {
      const doc = idx.documents.get(parsed.id);
      if (!doc) return [ref];
      const pages = doc.pages.map((p) => `doc:${doc.id}#page${p.page}`);
      const values = packet.extracted_values.filter((v) => v.document_id === doc.id).map((v) => v.id);
      return [ref, ...pages, ...values];
    }
    default:
      return [ref];
  }
}

function docLabel(packet: Packet, id: string): string {
  return indexPacket(packet).documents.get(id)?.title ?? id;
}

function ruleText(packet: Packet, rule: string): string | null {
  const rules = packet.engine_reference.rules;
  return Object.prototype.hasOwnProperty.call(rules, rule) ? rules[rule] : null;
}

function lineUse(packet: Packet, state: WorkspaceState, line: ReturnLine, via: string[], relation: "direct" | "transitive"): LineUse {
  const eff = state.effective.lines.get(line.key);
  const area = areaForLine(line.key, line.form);
  return {
    key: line.key,
    form: line.form,
    line: line.line,
    label: line.label,
    area,
    areaLabel: areaLabel(area),
    baseline: line.value,
    effective: eff?.effective ?? line.value,
    status: eff?.status ?? "baseline",
    rule: line.rule,
    ruleText: ruleText(packet, line.rule),
    note: line.note ?? null,
    via,
    relation,
  };
}

function lineOrder(a: ReturnLine, b: ReturnLine, order: Map<string, number>): number {
  return (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0);
}

/** Workpaper records that cite any of the given refs (as evidence, subject, target or anchored page). */
export function workpaperUsesOf(packet: Packet, state: WorkspaceState, refs: Set<string>): WorkpaperUse[] {
  const out: WorkpaperUse[] = [];
  const hit = (list: string[]) => list.filter((r) => refs.has(r));
  const labelFor = (ref: string) => resolveRef(packet, ref, { version: state.version.version }).label;
  for (const a of state.adjustments) {
    const via = [...hit(a.evidenceRefs), ...(refs.has(a.targetRef) ? [a.targetRef] : [])];
    if (via.length === 0) continue;
    out.push({
      table: "adjustment",
      id: a.id,
      ref: `adjustment:${a.id}`,
      status: a.status,
      subject: a.targetRef,
      subjectLabel: labelFor(a.targetRef),
      actorId: a.authorId,
      detail: `${a.kind} change: ${a.reason}`,
      via: [...new Set(via)],
      createdRevision: a.createdRevision,
    });
  }
  for (const v of state.verifications) {
    const via = [...hit(v.evidenceRefs), ...(refs.has(v.subjectRef) ? [v.subjectRef] : [])];
    if (via.length === 0) continue;
    out.push({
      table: "verification",
      id: v.id,
      ref: `verification:${v.id}`,
      status: v.conclusion,
      subject: v.subjectRef,
      subjectLabel: labelFor(v.subjectRef),
      actorId: v.actorId,
      detail: `${v.method.replace(/_/g, " ")}${v.note ? `: ${v.note}` : ""}`,
      via: [...new Set(via)],
      createdRevision: v.createdRevision,
    });
  }
  for (const an of state.anchors) {
    const pageRef = `doc:${an.documentId}#page${an.page}`;
    const via = [...(refs.has(pageRef) ? [pageRef] : []), ...(refs.has(an.subjectRef) ? [an.subjectRef] : []), ...(refs.has(an.documentId) ? [an.documentId] : [])];
    if (via.length === 0) continue;
    out.push({
      table: "anchor",
      id: an.id,
      ref: `anchor:${an.id}`,
      status: an.origin,
      subject: an.subjectRef,
      subjectLabel: labelFor(an.subjectRef),
      actorId: an.createdBy,
      detail: `"${an.textSpan}" on ${docLabel(packet, an.documentId)}, page ${an.page}${an.note ? `: ${an.note}` : ""}`,
      via: [...new Set(via)],
      createdRevision: an.createdRevision,
    });
  }
  for (const f of state.findings) {
    const via = hit(f.refs);
    if (via.length === 0) continue;
    out.push({
      table: "finding",
      id: f.id,
      ref: `finding:${f.id}`,
      status: f.status,
      subject: f.title,
      subjectLabel: f.title,
      actorId: f.createdBy,
      detail: `${f.severity}${f.blocksFiling ? ", blocks filing" : ""}: ${f.detail}`,
      via,
      createdRevision: f.createdRevision,
    });
  }
  return out;
}

/* ------------------------------------------------------------------------ */

export async function usesOf(ctx: SessionContext, ref: string, preloaded?: WorkspaceState): Promise<UsesOf> {
  const packet = ctx.packet.packet;
  const idx = indexPacket(packet);
  const redact = makeRedactor(packet);
  const state = preloaded ?? (await loadWorkspaceState(ctx.db, ctx));
  const version = state.version;
  const parsed = parseRef(ref);
  const resolved = resolveRef(packet, ref, { version: version.version });
  const expanded = expandRef(packet, ref);
  const refSet = new Set(expanded);

  const edges: EdgeRow[] = await ctx.db
    .select()
    .from(t.referenceEdges)
    .where(
      and(
        eq(t.referenceEdges.packetId, ctx.workspace.packetId),
        or(isNull(t.referenceEdges.workspaceId), eq(t.referenceEdges.workspaceId, ctx.workspace.id)),
        or(inArray(t.referenceEdges.fromRef, expanded), and(inArray(t.referenceEdges.toRef, expanded), eq(t.referenceEdges.relation, "supersedes"))),
      ),
    );

  const linesByKey = idx.linesByVersion.get(version.version)!;
  const order = new Map(version.lines.map((l, i) => [l.key, i]));
  const directVia = new Map<string, Set<string>>();
  const byVersion: Record<string, Set<string>> = {};
  const otherEngineUses: UsesOf["otherEngineUses"] = [];
  const supersedes = new Map<string, Set<string>>();
  const supersededBy = new Map<string, Set<string>>();

  for (const e of edges) {
    if (e.relation === "supersedes") {
      if (refSet.has(e.fromRef)) {
        const s = supersedes.get(e.toRef) ?? new Set<string>();
        if (e.version) s.add(e.version);
        supersedes.set(e.toRef, s);
      }
      if (refSet.has(e.toRef)) {
        const s = supersededBy.get(e.fromRef) ?? new Set<string>();
        if (e.version) s.add(e.version);
        supersededBy.set(e.fromRef, s);
      }
      continue;
    }
    if (e.origin !== "engine") continue;
    const target = parseRef(e.toRef);
    if (target.kind === "line") {
      if (e.version) {
        byVersion[e.version] ??= new Set<string>();
        byVersion[e.version].add(e.toRef);
      }
      if (e.version === version.version && linesByKey.has(e.toRef)) {
        const via = directVia.get(e.toRef) ?? new Set<string>();
        via.add(e.fromRef);
        directVia.set(e.toRef, via);
      }
    } else if (e.version === null || e.version === version.version) {
      otherEngineUses.push({
        ref: e.toRef,
        label: resolveRef(packet, e.toRef, { version: version.version }).label,
        version: e.version,
        relation: e.relation,
      });
    }
  }

  const directLines = [...directVia.keys()]
    .map((k) => linesByKey.get(k)!)
    .sort((a, b) => lineOrder(a, b, order));
  const direct = directLines.map((l) => lineUse(packet, state, l, [...directVia.get(l.key)!].sort(), "direct"));
  const directKeys = new Set(direct.map((d) => d.key));
  const transitive = [...downstreamClosure(version, directKeys)]
    .filter((k) => !directKeys.has(k))
    .map((k) => linesByKey.get(k))
    .filter((l): l is ReturnLine => Boolean(l))
    .sort((a, b) => lineOrder(a, b, order))
    .map((l) => lineUse(packet, state, l, [], "transitive"));

  const workpaper = workpaperUsesOf(packet, state, refSet);

  const toDocList = (m: Map<string, Set<string>>) =>
    [...m.entries()].map(([documentId, versions]) => ({ documentId, label: docLabel(packet, documentId), versions: [...versions].sort() }));

  const out: UsesOf = {
    ref,
    kind: parsed.kind,
    found: resolved.found,
    label: resolved.label,
    version: version.version,
    expanded,
    direct,
    transitive,
    byVersion: Object.fromEntries(
      Object.entries(byVersion)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([v, keys]) => [v, [...keys].sort()]),
    ),
    otherEngineUses,
    supersedes: toDocList(supersedes),
    supersededBy: toDocList(supersededBy),
    workpaper,
    edges: edges.map((e) => ({ fromRef: e.fromRef, toRef: e.toRef, relation: e.relation, origin: e.origin, version: e.version, workspace: e.workspaceId !== null })),
  };
  return redact.deep(out);
}

/* ------------------------------------------------------------------------ */

/** Short rendering of a resolved reference's content. Unredacted here; callers redact. */
export function summarizeRef(packet: Packet, ref: string, version: string): string | null {
  const r = resolveRef(packet, ref, { version });
  if (!r.found) return null;
  switch (r.parsed.kind) {
    case "extracted_value": {
      const ev = r.value as ExtractedValue;
      return displayExtractedValue(ev);
    }
    case "document":
    case "document_page":
      return null;
    case "questionnaire":
      return (r.value as { answer: string }).answer;
    case "message":
      return (r.value as { text: string }).text;
    case "call_note":
      return (r.value as { notes: string[] }).notes.join(" ");
    case "household": {
      const p = r.value as { name: string; relationship?: string; dob: string };
      return `${p.name}${p.relationship ? `, ${p.relationship}` : ""}, born ${p.dob}`;
    }
    case "asset": {
      const a = r.value as { description?: string; cost?: number; placed_in_service?: string };
      return `${a.description ?? ""}${a.cost !== undefined ? `, cost ${money(a.cost)}` : ""}${a.placed_in_service ? `, placed in service ${a.placed_in_service}` : ""}`;
    }
    case "line": {
      const l = r.value as ReturnLine;
      return typeof l.value === "number" ? money(l.value) : String(l.value);
    }
    case "version":
      return (r.value as { trigger: string }).trigger;
    case "timeline":
      return (r.value as { detail: string | null }).detail;
    default:
      return compactJson(r.value);
  }
}

export function displayExtractedValue(ev: ExtractedValue): string {
  const v = ev.value;
  if (v === null || v === undefined) return "blank";
  switch (ev.value_type) {
    case "money":
      return typeof v === "number" ? money(v, { cents: true }) : String(v);
    case "boolean":
      return v === true ? "yes" : v === false ? "no" : String(v);
    case "percent":
      return typeof v === "number" ? `${v}%` : String(v);
    default:
      return typeof v === "object" ? compactJson(v) : String(v);
  }
}

export function compactJson(value: unknown, max = 160): string {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  const text = JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

export async function sourcesOf(ctx: SessionContext, lineKey: string, preloaded?: WorkspaceState): Promise<SourcesOf> {
  const packet = ctx.packet.packet;
  const idx = indexPacket(packet);
  const redact = makeRedactor(packet);
  const state = preloaded ?? (await loadWorkspaceState(ctx.db, ctx));
  const version = state.version;
  const asOf = new Date(ctx.workspace.asOf).toISOString();
  const line = idx.linesByVersion.get(version.version)?.get(lineKey);

  const edges: EdgeRow[] = await ctx.db
    .select()
    .from(t.referenceEdges)
    .where(
      and(
        eq(t.referenceEdges.packetId, ctx.workspace.packetId),
        or(isNull(t.referenceEdges.workspaceId), eq(t.referenceEdges.workspaceId, ctx.workspace.id)),
        eq(t.referenceEdges.toRef, lineKey),
      ),
    );
  const edgeList = edges
    .filter((e) => e.version === null || e.version === version.version)
    .map((e) => ({ fromRef: e.fromRef, relation: e.relation, origin: e.origin, version: e.version, workspace: e.workspaceId !== null }));

  if (!line) {
    return redact.deep({
      lineKey,
      found: false,
      version: version.version,
      line: null,
      inputs: [],
      sources: [],
      problems: [{ ref: lineKey, state: "missing", message: `${lineKey} is not a line in ${version.version}.` }],
      workpaper: workpaperUsesOf(packet, state, new Set([lineKey])),
      edges: edgeList,
    });
  }

  const area = areaForLine(line.key, line.form);
  const eff = state.effective.lines.get(line.key);
  const problems: SourcesOf["problems"] = [];

  const inputs: InputEntry[] = line.inputs.map((key) => {
    const l = idx.linesByVersion.get(version.version)?.get(key);
    const e = state.effective.lines.get(key);
    if (!l) {
      problems.push({ ref: key, state: "missing", message: `Input line ${key} is not in ${version.version}.` });
      return { key, found: false, label: `Return line ${key} (not in ${version.version})`, baseline: null, effective: null, status: "missing" };
    }
    return { key, found: true, label: `${l.form} line ${l.line}: ${l.label}`, baseline: l.value, effective: e?.effective ?? l.value, status: e?.status ?? "baseline" };
  });

  // Sources named by the engine, plus any engine edge the packet import added that the line itself does not list.
  const engineSourceRefs = [...line.sources];
  for (const e of edges) {
    if (e.origin === "engine" && e.version === version.version && e.relation === "supports" && !engineSourceRefs.includes(e.fromRef)) engineSourceRefs.push(e.fromRef);
  }
  const sources: SourceEntry[] = engineSourceRefs.map((ref) => {
    const r = resolveRef(packet, ref, { version: version.version });
    const at = availableAt(packet, ref);
    const available = at ? new Date(at).getTime() <= new Date(asOf).getTime() : true;
    const state: SourceState = r.parsed.kind === "workpaper" ? "workpaper" : !r.found ? "missing" : !available ? "not_yet_available" : "resolved";
    if (state === "missing") problems.push({ ref, state, message: `${ref} does not resolve in the packet.` });
    if (state === "not_yet_available") problems.push({ ref, state, message: `${ref} arrives ${at?.slice(0, 10)}, after the replay clock ${asOf.slice(0, 10)}.` });
    const ev = r.parsed.kind === "extracted_value" && r.found ? (r.value as ExtractedValue) : null;
    return {
      ref,
      kind: r.parsed.kind,
      found: r.found,
      state,
      label: r.label,
      display: r.found ? summarizeRef(packet, ref, version.version) : null,
      availableAt: at,
      available,
      location: r.location,
      confidence: ev?.confidence,
    };
  });

  const out: SourcesOf = {
    lineKey,
    found: true,
    version: version.version,
    line: {
      key: line.key,
      form: line.form,
      line: line.line,
      label: line.label,
      jurisdiction: line.jurisdiction,
      area,
      areaLabel: areaLabel(area),
      baseline: line.value,
      effective: eff?.effective ?? line.value,
      status: eff?.status ?? "baseline",
      rule: line.rule,
      ruleText: ruleText(packet, line.rule),
      note: line.note ?? null,
    },
    inputs,
    sources,
    problems,
    workpaper: workpaperUsesOf(packet, state, new Set([lineKey])),
    edges: edgeList,
  };
  return redact.deep(out);
}
