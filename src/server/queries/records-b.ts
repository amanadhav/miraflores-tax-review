/**
 * View models for the second half of the CPA record views: sales (Form 8949
 * and Schedule D), rentals (Schedule E, Form 4797, Form 8582), pass-throughs
 * (K-1s, Form 7203, partnership capital), retirement and foreign items (Forms
 * 8606, 8889, SEP, Schedule B foreign interest, Form 8938) and deductions and
 * credits (Schedule A, Forms 8283, 8863, 2441, 8812, 8867).
 *
 * Every function returns a plain, redacted object. Lines come from the active
 * version through the effective state (baseline plus accepted adjustments), so
 * status words match the review screens. Evidence respects the replay clock:
 * a document, value or message dated after the clock is listed with its
 * arrival date and no content.
 */
import { areaLabel } from "@/domain/areas";
import type { EffectiveLine } from "@/domain/effective";
import { numeric } from "@/domain/formulas";
import { can, type Actor } from "@/domain/policy";
import { makeRedactor } from "@/domain/redaction";
import { availableAt } from "@/packet/availability";
import { indexPacket } from "@/packet/load";
import { parseRef, resolveRef } from "@/packet/refs";
import type { Diagnostic, ExtractedValue, Packet, PacketDocument, ReturnLine, ReturnVersion } from "@/packet/types";
import type { SessionContext } from "@/server/context";
import { loadWorkspaceState, type FindingRow, type JudgmentRow, type WorkspaceState } from "@/server/state";
import { typeLabel } from "./evidence";
import { holdingFor, type ActorView, type LineRowView, type LineValue, type RefView } from "./review";
import { displayExtractedValue } from "./trace";

/* ------------------------------------------------------------------------ */
/* Shared view model types.                                                   */
/* ------------------------------------------------------------------------ */

/** A return line of the active version with its engine note, rule and resolved sources. */
export interface RbLine extends LineRowView {
  note: string | null;
  rule: string;
  ruleText: string | null;
  sources: RefView[];
  inputs: string[];
  href: string;
}

export interface ValueView {
  id: string;
  documentId: string;
  page: number;
  field: string;
  label: string;
  /** Empty when the document arrives after the replay clock. */
  display: string;
  valueType: string;
  textAsRead: string;
  confidence: number;
  href: string;
  available: boolean;
  availableAt: string | null;
  /** Line keys of the active version that cite this value directly. */
  usedBy: string[];
}

export interface DocView {
  id: string;
  title: string;
  typeLabel: string;
  issuer: string;
  belongsTo: string;
  taxYear: number;
  receivedAt: string;
  available: boolean;
  pageCount: number;
  markedCorrected: boolean;
  extraction: { status: string; values: number; reason: string | null };
  href: string;
  /** Empty until the document is available at the replay clock. */
  values: ValueView[];
  /** Printed text per page, only when requested and available. */
  pages: { page: number; text: string; href: string }[];
}

export interface ClientItemView {
  id: string;
  kind: "questionnaire" | "message" | "call_note";
  label: string;
  /** Null when the item arrives after the replay clock. */
  text: string | null;
  by: string | null;
  at: string | null;
  available: boolean;
  href: string;
}

export interface ParamView {
  name: string;
  ref: string;
  label: string;
  display: string;
  value: unknown;
}

export interface FindingNote {
  id: string;
  code: string | null;
  origin: string;
  severity: string;
  title: string;
  detail: string;
  status: string;
  blocksFiling: boolean;
  refs: RefView[];
  href: string;
}

export interface JudgmentNote {
  id: string;
  kind: string;
  subjectRef: string;
  title: string;
  conclusion: string;
  status: string;
  decidedBy: ActorView | null;
  createdRevision: number;
}

export interface DiagnosticVersionRow {
  version: string;
  computedAt: string;
  present: boolean;
  message: string | null;
  refs: RefView[];
}

/** One diagnostic code followed across engine versions. */
export interface DiagnosticTrail {
  code: string;
  label: string;
  versions: DiagnosticVersionRow[];
  /** Present in the active version. */
  active: boolean;
  /** The finding seeded from this diagnostic in this workspace, when one exists. */
  finding: FindingNote | null;
}

export interface TimelineNote {
  id: string;
  at: string;
  event: string;
  detail: string | null;
  refs: RefView[];
  available: boolean;
}

export interface VersionChange {
  key: string;
  label: string;
  change: string;
  old: LineValue | null;
  new: LineValue | null;
}

export interface WhatIfNote {
  id: string;
  description: string;
  baseVersion: string;
  federalTaxChange: number;
  californiaTaxChange: number;
  changedLines: VersionChange[];
  href: string;
}

export interface RelatedReturnView {
  who: string;
  return: string;
  preparedBy: string;
  inPacket: string;
  docs: DocView[];
  contents: string;
}

export interface RbActor extends ActorView {
  canPropose: boolean;
  canRaise: boolean;
  canVerify: boolean;
  canAnchor: boolean;
}

export interface RbHeader {
  revision: number;
  asOf: string;
  version: string;
  computedAt: string;
  actor: RbActor;
  owners: ActorView[];
  area: { id: string; label: string };
}

/* ------------------------------------------------------------------------ */
/* Builder.                                                                   */
/* ------------------------------------------------------------------------ */

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

function lineHref(key: string): string {
  return `/review/line/${encodeURIComponent(key)}`;
}

export function moneyText(n: number | null | undefined, cents = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "unknown";
  const abs = Math.abs(n);
  const digits = cents || Math.round(abs) !== abs ? 2 : 0;
  const text = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return n < 0 ? `(${text})` : text;
}

function parseMoney(text: string): number | null {
  const m = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** A distinctive word of an issuer name for matching client text ("St. Brigid Parish" gives "Brigid"). */
function keywordOf(name: string): string {
  const words = name.split(/[\s,]+/).map((w) => w.replace(/[^A-Za-z0-9]/g, ""));
  return words.find((w) => w.length >= 4) ?? words[0] ?? name;
}

class Rb {
  readonly packet: Packet;
  readonly state: WorkspaceState;
  readonly asOf: string;
  readonly version: ReturnVersion;
  readonly packetLines: Map<string, ReturnLine>;
  readonly actor: Actor;
  readonly ctx: SessionContext;
  private readonly usesByRef: Map<string, string[]>;

  constructor(ctx: SessionContext, state: WorkspaceState) {
    this.ctx = ctx;
    this.packet = ctx.packet.packet;
    this.state = state;
    this.asOf = isoOrNull(ctx.workspace.asOf) ?? ctx.workspace.asOf;
    this.version = state.version;
    this.packetLines = indexPacket(this.packet).linesByVersion.get(this.version.version)!;
    this.actor = ctx.actor;
    this.usesByRef = new Map();
    for (const l of this.version.lines) {
      for (const s of l.sources) {
        const list = this.usesByRef.get(s);
        if (list) list.push(l.key);
        else this.usesByRef.set(s, [l.key]);
      }
    }
  }

  get idx() {
    return indexPacket(this.packet);
  }

  isAvailable(at: string | null): boolean {
    if (!at) return true;
    return new Date(at).getTime() <= new Date(this.asOf).getTime();
  }

  labelOf(key: string): string {
    return this.packetLines.get(key)?.label ?? key;
  }

  ref(ref: string): RefView {
    const r = resolveRef(this.packet, ref, { version: this.version.version });
    const at = isoOrNull(availableAt(this.packet, ref));
    return { ref, label: r.label, kind: r.parsed.kind, found: r.found, availableAt: at, available: this.isAvailable(at) };
  }

  refs(list: string[]): RefView[] {
    return list.map((r) => this.ref(r));
  }

  statusReason(eff: EffectiveLine): { reason: string; changed: { key: string; label: string }[] } {
    const named = (keys: string[]) => keys.map((k) => ({ key: k, label: this.labelOf(k) }));
    const list = (keys: string[]) => keys.map((k) => `${this.labelOf(k)} (${k})`).join(", ");
    switch (eff.status) {
      case "baseline":
        return { reason: "Engine value, unchanged by the workpaper.", changed: [] };
      case "adjusted":
        return { reason: `Set directly by accepted adjustment ${eff.adjustmentId ?? ""}.`.trim(), changed: [] };
      case "recomputed": {
        const keys = eff.recomputedFrom ?? [];
        return { reason: `Recomputed with the verified formula because these inputs changed: ${list(keys)}.`, changed: named(keys) };
      }
      case "stale": {
        const keys = eff.staleBecause ?? [];
        const why = eff.formula.kind === "opaque" ? `engine rule ${eff.formula.rule} cannot be reproduced here` : "an input is itself stale, so the formula could not be re-evaluated";
        return { reason: `Engine value no longer trustworthy: these inputs changed: ${list(keys)}; ${why}. The baseline number is shown but must be reviewed.`, changed: named(keys) };
      }
    }
  }

  /** A line of the active version, or null when the version has no such key. */
  line(key: string): RbLine | null {
    const line = this.packetLines.get(key);
    const eff = this.state.effective.lines.get(key);
    if (!line || !eff) return null;
    const { reason, changed } = this.statusReason(eff);
    return {
      key: line.key,
      form: line.form,
      line: line.line,
      label: line.label,
      jurisdiction: line.jurisdiction,
      baseline: eff.baseline,
      effective: eff.effective,
      status: eff.status,
      statusReason: reason,
      changedInputs: changed,
      adjustmentId: eff.adjustmentId ?? null,
      pendingProposals: this.state.adjustments.filter((a) => a.status === "proposed" && a.targetRef === line.key).length,
      openFindings: this.state.findings.filter((f) => f.status === "open" && f.refs.includes(line.key)).length,
      note: line.note ?? null,
      rule: line.rule,
      ruleText: this.packet.engine_reference.rules[line.rule] ?? null,
      sources: this.refs(line.sources),
      inputs: [...line.inputs],
      href: lineHref(line.key),
    };
  }

  lines(keys: string[]): RbLine[] {
    return keys.map((k) => this.line(k)).filter((l): l is RbLine => l !== null);
  }

  /** Lines of a form in packet order, optionally filtered by key. */
  form(form: string, filter?: (key: string) => boolean): RbLine[] {
    return this.version.lines
      .filter((l) => l.form === form && (!filter || filter(l.key)))
      .map((l) => this.line(l.key))
      .filter((l): l is RbLine => l !== null);
  }

  effectiveNumber(key: string): number | null {
    return numeric(this.state.effective.lines.get(key)?.effective);
  }

  value(id: string): ValueView | null {
    const ev = this.idx.extractedValues.get(id);
    if (!ev) return null;
    return this.valueOf(ev);
  }

  valueOf(ev: ExtractedValue): ValueView {
    const at = isoOrNull(this.idx.documents.get(ev.document_id)?.received_at);
    const available = this.isAvailable(at);
    return {
      id: ev.id,
      documentId: ev.document_id,
      page: ev.page,
      field: ev.field,
      label: ev.label,
      display: available ? displayExtractedValue(ev) : "",
      valueType: ev.value_type,
      textAsRead: available ? ev.text_as_read : "",
      confidence: ev.confidence,
      href: `/evidence/value/${ev.id}`,
      available,
      availableAt: at,
      usedBy: [...(this.usesByRef.get(ev.id) ?? [])],
    };
  }

  values(ids: string[]): ValueView[] {
    return ids.map((id) => this.value(id)).filter((v): v is ValueView => v !== null);
  }

  /** Values of a document, only when it is available at the replay clock. */
  docValues(documentId: string): ValueView[] {
    const doc = this.idx.documents.get(documentId);
    if (!doc || !this.isAvailable(isoOrNull(doc.received_at))) return [];
    return this.packet.extracted_values.filter((e) => e.document_id === documentId).map((e) => this.valueOf(e));
  }

  doc(id: string, opts: { pages?: boolean | number[] } = {}): DocView | null {
    const d = this.idx.documents.get(id);
    if (!d) return null;
    const receivedAt = isoOrNull(d.received_at) ?? d.received_at;
    const available = this.isAvailable(receivedAt);
    const wanted = opts.pages === true ? d.pages.map((p) => p.page) : Array.isArray(opts.pages) ? opts.pages : [];
    return {
      id: d.id,
      title: d.title,
      typeLabel: typeLabel(d.document_type),
      issuer: d.issuer,
      belongsTo: this.belongsTo(d),
      taxYear: d.tax_year,
      receivedAt,
      available,
      pageCount: d.page_count,
      markedCorrected: d.marked_corrected === true,
      extraction: { status: d.extraction.status, values: d.extraction.values, reason: d.extraction.reason },
      href: `/evidence/${d.id}`,
      values: available ? this.docValues(d.id) : [],
      pages: available
        ? d.pages.filter((p) => wanted.includes(p.page)).map((p) => ({ page: p.page, text: p.printed_content, href: `/evidence/${d.id}?page=${p.page}` }))
        : [],
    };
  }

  docs(ids: string[], opts: { pages?: boolean | number[] } = {}): DocView[] {
    return ids.map((id) => this.doc(id, opts)).filter((d): d is DocView => d !== null);
  }

  belongsTo(d: PacketDocument): string {
    const b = d.belongs_to;
    if (b.startsWith("dependent:")) {
      const p = this.idx.people.get(b.slice("dependent:".length));
      return p ? `${p.name} (dependent)` : b;
    }
    const p = this.packet.household.people.find((x) => x.role === b);
    return p ? `${p.name} (${b})` : b;
  }

  /** Documents cited (through extracted values or page refs) by any of the given refs, most cited first. */
  docsCitedBy(refs: Iterable<string>): string[] {
    const counts = new Map<string, number>();
    const hit = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const r of refs) {
      const p = parseRef(r);
      if (p.kind === "extracted_value") {
        const ev = this.idx.extractedValues.get(p.id);
        if (ev) hit(ev.document_id);
      } else if (p.kind === "document") hit(p.id);
      else if (p.kind === "document_page") hit(p.documentId);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  }

  docsByType(types: string[]): PacketDocument[] {
    return this.packet.documents.filter((d) => types.includes(d.document_type));
  }

  client(id: string): ClientItemView | null {
    const p = parseRef(id);
    const at = isoOrNull(availableAt(this.packet, id));
    const available = this.isAvailable(at);
    const href = `/evidence/client#${id}`;
    if (p.kind === "questionnaire") {
      const q = this.idx.questionnaire.get(p.id);
      if (!q) return null;
      return { id, kind: "questionnaire", label: q.question, text: available ? q.answer : null, by: q.answered_by, at, available, href };
    }
    if (p.kind === "message") {
      const m = this.idx.messages.get(p.id);
      if (!m) return null;
      return { id, kind: "message", label: `Message from ${m.from}`, text: available ? m.text : null, by: m.from, at, available, href };
    }
    if (p.kind === "call_note") {
      const c = this.idx.callNotes.get(p.id);
      if (!c) return null;
      return { id, kind: "call_note", label: `Call with ${c.participants.join(", ")}`, text: available ? c.notes.join(" ") : null, by: null, at, available, href };
    }
    return null;
  }

  clients(ids: string[]): ClientItemView[] {
    return ids.map((id) => this.client(id)).filter((c): c is ClientItemView => c !== null);
  }

  /** Client answers, messages and call notes whose text mentions a keyword (case-insensitive). */
  clientMentions(keyword: string): ClientItemView[] {
    const needle = keyword.toLowerCase();
    const out: ClientItemView[] = [];
    for (const q of this.packet.client.questionnaire) if (`${q.question} ${q.answer}`.toLowerCase().includes(needle)) out.push(this.client(q.id)!);
    for (const m of this.packet.client.messages) if (m.text.toLowerCase().includes(needle)) out.push(this.client(m.id)!);
    for (const c of this.packet.client.call_notes) if (c.notes.join(" ").toLowerCase().includes(needle)) out.push(this.client(c.id)!);
    return out;
  }

  param(name: string, label?: string): ParamView {
    const value = this.packet.engine_reference.parameters[name];
    const display =
      typeof value === "number"
        ? value < 1 && value > 0
          ? String(value)
          : moneyText(value)
        : Array.isArray(value)
          ? value.map((v) => (typeof v === "number" ? moneyText(v) : String(v))).join(" to ")
          : value === undefined
            ? "not supplied"
            : String(value);
    return { name, ref: `ref:param.${name}`, label: label ?? name.replace(/_/g, " "), display, value: value ?? null };
  }

  fxRate(rate: string): { ref: string; label: string; value: number | null } {
    const fx = (this.packet.engine_reference.parameters.fx as { SEK?: Record<string, number> } | undefined)?.SEK;
    const value = fx && rate in fx ? fx[rate] : null;
    return { ref: `ref:fx.SEK.${rate}`, label: `SEK per USD, ${rate.replace(/_/g, " ")}`, value };
  }

  finding(f: FindingRow): FindingNote {
    return {
      id: f.id,
      code: f.code,
      origin: f.origin,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      status: f.status,
      blocksFiling: f.blocksFiling,
      refs: this.refs(f.refs),
      href: `/review?finding=${encodeURIComponent(f.id)}`,
    };
  }

  findingsByCode(code: string): FindingNote[] {
    return this.state.findings.filter((f) => f.code === code).map((f) => this.finding(f));
  }

  findingsCiting(refs: string[]): FindingNote[] {
    return this.state.findings.filter((f) => f.refs.some((r) => refs.includes(r))).map((f) => this.finding(f));
  }

  judgment(j: JudgmentRow): JudgmentNote {
    const by = this.packet.firm.staff.find((s) => s.id === j.decidedBy);
    return {
      id: j.id,
      kind: j.kind,
      subjectRef: j.subjectRef,
      title: j.title,
      conclusion: j.conclusion,
      status: j.status,
      decidedBy: by ? { id: by.id, name: by.name, role: by.role.replace(/_/g, " ") } : null,
      createdRevision: j.createdRevision,
    };
  }

  judgmentsFor(subjectRefs: string[]): JudgmentNote[] {
    return this.state.judgments.filter((j) => subjectRefs.includes(j.subjectRef)).map((j) => this.judgment(j));
  }

  /** Follow one diagnostic code across every engine version. */
  trail(code: string): DiagnosticTrail {
    const versions = this.packet.return_versions.map((v) => {
      const d = v.diagnostics.find((x) => x.code === code);
      return {
        version: v.version,
        computedAt: isoOrNull(v.computed_at) ?? v.computed_at,
        present: d !== undefined,
        message: d?.message ?? null,
        refs: d ? this.refs(d.refs) : [],
      };
    });
    const finding = this.state.findings.find((f) => f.code === code);
    return {
      code,
      label: code.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()),
      versions,
      active: this.version.diagnostics.some((d) => d.code === code),
      finding: finding ? this.finding(finding) : null,
    };
  }

  /** Diagnostics of the active version whose refs intersect the given refs. */
  diagnosticsCiting(refs: string[]): Diagnostic[] {
    return this.version.diagnostics.filter((d) => d.refs.some((r) => refs.includes(r)));
  }

  timeline(ids: string[]): TimelineNote[] {
    return ids
      .map((id) => this.idx.timeline.get(id))
      .filter((t): t is Packet["timeline"][number] => t !== undefined)
      .map((t) => {
        const at = isoOrNull(t.at) ?? t.at;
        return { id: t.id, at, event: t.event.replace(/_/g, " "), detail: t.detail, refs: this.refs(t.refs), available: this.isAvailable(at) };
      });
  }

  /** Timeline events whose refs include any of the given refs. */
  timelineCiting(refs: string[]): TimelineNote[] {
    return this.timeline(this.packet.timeline.filter((t) => t.refs.some((r) => refs.includes(r))).map((t) => t.id));
  }

  change(c: { key: string; change: string; old?: unknown; new?: unknown }): VersionChange {
    return { key: c.key, label: this.labelOf(c.key), change: c.change, old: (c.old as LineValue) ?? null, new: (c.new as LineValue) ?? null };
  }

  whatIfTouching(keys: string[]): WhatIfNote[] {
    return this.packet.what_if.alternatives
      .filter((a) => a.changed_lines.some((c) => keys.includes(c.key)))
      .map((a) => ({
        id: a.id,
        description: a.description,
        baseVersion: a.base_version,
        federalTaxChange: a.federal.total_tax_change,
        californiaTaxChange: a.california.total_tax_change,
        changedLines: a.changed_lines.map((c) => this.change(c)),
        href: `/changes/whatif#${a.id}`,
      }));
  }

  header(areaId: string): RbHeader {
    return {
      revision: this.ctx.workspace.revision,
      asOf: this.asOf,
      version: this.version.version,
      computedAt: isoOrNull(this.version.computed_at) ?? this.version.computed_at,
      actor: {
        id: this.actor.id,
        name: this.actor.name,
        role: this.actor.role.replace(/_/g, " "),
        canPropose: can(this.actor, "propose_adjustment"),
        canRaise: can(this.actor, "raise_finding"),
        canVerify: can(this.actor, "add_verification"),
        canAnchor: can(this.actor, "add_anchor"),
      },
      owners: this.packet.firm.staff.map((s) => ({ id: s.id, name: s.name, role: s.role.replace(/_/g, " ") })),
      area: { id: areaId, label: areaLabel(areaId) },
    };
  }

  priorYearNumber(pointer: string): { amount: number | null; ref: RefView } {
    const r = resolveRef(this.packet, `py:${pointer}`, { version: this.version.version });
    return { amount: numeric(r.value), ref: this.ref(`py:${pointer}`) };
  }

  carryoverOut(name: string, jurisdiction: "federal" | "california" = "federal"): number | null {
    const bucket = this.version.carryovers_out[jurisdiction] as Record<string, unknown> | undefined;
    return numeric(bucket?.[name]);
  }
}

async function build(ctx: SessionContext): Promise<{ b: Rb; redact: ReturnType<typeof makeRedactor> }> {
  const state = await loadWorkspaceState(ctx.db, ctx);
  return { b: new Rb(ctx, state), redact: makeRedactor(ctx.packet.packet) };
}

/* ------------------------------------------------------------------------ */
/* Sales: Form 8949 and Schedule D.                                           */
/* ------------------------------------------------------------------------ */

export const LOT_PAGE_SIZE = 50;

export interface LotFlag {
  kind: "basis_unmatched" | "supplement_matched" | "engine_diagnostic";
  label: string;
  detail: string;
  evidence: ValueView[];
  refs: RefView[];
}

export interface LotView {
  key: string;
  lotId: string;
  box: string;
  holding: "short" | "long" | "unknown";
  holdingLabel: string;
  description: string;
  acquired: string | null;
  sold: string | null;
  proceeds: number | null;
  basis: number | null;
  adjustment: { code: string; amount: number } | null;
  gain: LineValue;
  baseline: LineValue;
  status: RbLine["status"];
  statusReason: string;
  adjustmentId: string | null;
  pendingProposals: number;
  openFindings: number;
  sources: RefView[];
  flags: LotFlag[];
  href: string;
}

export interface UnmatchedLot {
  lotId: string;
  documentId: string;
  page: number;
  printed: string;
  parsed: { description: string | null; acquired: string | null; sold: string | null; proceeds: number | null; basis: number | null };
  status: string;
  extractionReason: string | null;
  href: string;
  anchorHref: string;
  available: boolean;
  availableAt: string | null;
}

export interface SummaryCheck {
  summaryValue: ValueView | null;
  summaryAmount: number | null;
  lotProceeds: number;
  lotCount: number;
  difference: number | null;
  /** Unmatched printed lots whose proceeds equal the difference. */
  explains: string[];
  diagnostic: FindingNote | null;
  message: string | null;
}

export interface LotGroupView {
  id: string;
  label: string;
  broker: string;
  /** "account ending NNNN" as the statement prints it, or null. */
  accountLabel: string | null;
  documents: DocView[];
  lotCount: number;
  matched: number;
  page: number;
  pageCount: number;
  from: number;
  to: number;
  lots: LotView[];
  unmatched: UnmatchedLot[];
  washSale: { count: number; amount: number };
  summaryCheck: SummaryCheck | null;
  clientItems: ClientItemView[];
  passthroughHref: string | null;
}

export interface BoxSummaryView {
  box: string;
  holding: "short" | "long" | "unknown";
  holdingLabel: string;
  lotCount: number;
  proceeds: number | null;
  basis: number | null;
  adjustments: number | null;
  total: RbLine;
  carriesTo: RbLine | null;
}

export interface SalesQuery {
  group?: string;
  page?: number;
  q?: string;
}

export interface SalesView extends RbHeader {
  query: string;
  group: string | null;
  pageSize: number;
  boxes: BoxSummaryView[];
  groups: LotGroupView[];
  lotCount: number;
  matched: number;
  schD: RbLine[];
  carryovers: {
    into: { label: string; amount: number | null; ref: RefView }[];
    out: { label: string; amount: number | null }[];
  };
}

const LOT_KEY = /^F8949\.([A-Z]+)\.([A-Z]+)(\d*)$/;

export function parseLotLabel(label: string): { description: string; acquired: string | null; sold: string | null; proceeds: number | null; basis: number | null; adjustment: { code: string; amount: number } | null } {
  const m = label.match(/^(.*?)\s*\(acquired (\d{4}-\d{2}-\d{2}), sold (\d{4}-\d{2}-\d{2}); proceeds ([\d,.\-]+), basis ([\d,.\-]+)(?:, adjustment ([A-Z]+) ([\d,.\-]+))?\)\s*$/);
  if (!m) return { description: label, acquired: null, sold: null, proceeds: null, basis: null, adjustment: null };
  return {
    description: m[1],
    acquired: m[2],
    sold: m[3],
    proceeds: parseMoney(m[4]),
    basis: parseMoney(m[5]),
    adjustment: m[6] ? { code: m[6], amount: parseMoney(m[7]) ?? 0 } : null,
  };
}

function parseTotalLabel(label: string): { proceeds: number | null; basis: number | null; adjustments: number | null } {
  const m = label.match(/proceeds ([\d,.\-]+); basis ([\d,.\-]+); adjustments ([\d,.\-]+)/);
  return m ? { proceeds: parseMoney(m[1]), basis: parseMoney(m[2]), adjustments: parseMoney(m[3]) } : { proceeds: null, basis: null, adjustments: null };
}

function holdingLabelOf(h: "short" | "long" | "unknown"): string {
  return h === "short" ? "short-term" : h === "long" ? "long-term" : "holding period not known";
}

function lotMatches(lot: LotView, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return lot.lotId.toLowerCase() === needle || lot.key.toLowerCase().includes(needle) || lot.description.toLowerCase().includes(needle);
}

/** Supplemental statement values (stock plan supplements) keyed by acquisition date. */
function supplementIndex(b: Rb): Map<string, { basis: ExtractedValue; acquired: ExtractedValue }[]> {
  const out = new Map<string, { basis: ExtractedValue; acquired: ExtractedValue }[]>();
  for (const d of b.docsByType(["stock_plan_supplement"])) {
    const values = b.packet.extracted_values.filter((e) => e.document_id === d.id);
    for (const acquired of values.filter((e) => /_acquired$/.test(e.field) && typeof e.value === "string")) {
      const lot = acquired.field.replace(/_acquired$/, "");
      const basis = values.find((e) => e.field === `${lot}_adjusted_basis`);
      if (!basis) continue;
      const list = out.get(acquired.value as string) ?? [];
      list.push({ basis, acquired });
      out.set(acquired.value as string, list);
    }
  }
  return out;
}

function lotView(b: Rb, line: RbLine, supplements: Map<string, { basis: ExtractedValue; acquired: ExtractedValue }[]>): LotView {
  const m = line.key.match(LOT_KEY)!;
  const box = m[1];
  const lotId = `${m[2]}${m[3]}`;
  const parsed = parseLotLabel(line.label);
  const holding = holdingFor(line.key, line.label);
  const flags: LotFlag[] = [];
  const sourceIds = line.sources.map((s) => s.ref);

  if (parsed.acquired) {
    for (const s of supplements.get(parsed.acquired) ?? []) {
      const doc = b.idx.documents.get(s.basis.document_id);
      const available = doc ? b.isAvailable(isoOrNull(doc.received_at)) : true;
      const evidence = available ? b.values([s.basis.id, s.acquired.id]) : [];
      if (sourceIds.includes(s.basis.id)) {
        flags.push({
          kind: "supplement_matched",
          label: "already adjusted by the engine",
          detail: `The engine matched this lot to the supplemental statement (${s.basis.label}, ${displayExtractedValue(s.basis)}) and applied ${parsed.adjustment ? `adjustment code ${parsed.adjustment.code} ${moneyText(parsed.adjustment.amount, true)}` : "its basis"}. No further basis change is suggested from that statement.`,
          evidence,
          refs: b.refs([s.basis.id]),
        });
      } else if (parsed.basis === 0) {
        flags.push({
          kind: "basis_unmatched",
          label: "basis 0.00 on the return; supplemental statement not matched",
          detail: available
            ? `${doc?.title ?? s.basis.document_id} page ${s.basis.page} prints ${s.basis.label} ${displayExtractedValue(s.basis)} for a lot acquired ${parsed.acquired}. That value is not among this lot's sources, so the engine used the broker's 0.00. Review it in the inspector before proposing anything.`
            : `${doc?.title ?? s.basis.document_id} arrives ${isoOrNull(doc?.received_at)?.slice(0, 10) ?? "later"}; its supplemental basis is not readable at the current replay clock.`,
          evidence,
          refs: b.refs([s.basis.id]),
        });
      }
    }
  }

  for (const d of b.diagnosticsCiting(sourceIds)) {
    flags.push({
      kind: "engine_diagnostic",
      label: `engine diagnostic ${d.code}`,
      detail: d.message,
      evidence: b.values(d.refs.filter((r) => parseRef(r).kind === "extracted_value")),
      refs: b.refs(d.refs),
    });
  }

  return {
    key: line.key,
    lotId,
    box,
    holding,
    holdingLabel: holdingLabelOf(holding),
    description: parsed.description,
    acquired: parsed.acquired,
    sold: parsed.sold,
    proceeds: parsed.proceeds,
    basis: parsed.basis,
    adjustment: parsed.adjustment,
    gain: line.effective,
    baseline: line.baseline,
    status: line.status,
    statusReason: line.statusReason,
    adjustmentId: line.adjustmentId,
    pendingProposals: line.pendingProposals,
    openFindings: line.openFindings,
    sources: line.sources,
    flags,
    href: line.href,
  };
}

function accountOf(doc: PacketDocument | undefined): string | null {
  if (!doc) return null;
  for (const p of doc.pages) {
    const m = p.printed_content.match(/account ending (\d{4})/i);
    if (m) return `account ending ${m[1]}`;
  }
  return null;
}

/** Lot ids printed on a group's documents that the return does not carry and the pipeline did not extract. */
function unmatchedLots(b: Rb, prefix: string, docIds: string[], onReturn: Set<string>, extracted: Set<string>): UnmatchedLot[] {
  const out: UnmatchedLot[] = [];
  const seen = new Set<string>();
  const re = new RegExp(`\\b(${prefix}\\d+)\\b`, "g");
  for (const id of docIds) {
    const doc = b.idx.documents.get(id);
    if (!doc) continue;
    const at = isoOrNull(doc.received_at);
    const available = b.isAvailable(at);
    for (const page of doc.pages) {
      for (const match of page.printed_content.matchAll(re)) {
        const lotId = match[1];
        if (onReturn.has(lotId) || extracted.has(lotId) || seen.has(lotId)) continue;
        seen.add(lotId);
        const text = page.printed_content;
        const detail = text.match(new RegExp(`${lotId} (.*?) (?:[\\d.]+ sh )?acquired (\\d{4}-\\d{2}-\\d{2}) sold (\\d{4}-\\d{2}-\\d{2}) proceeds ([\\d,.]+) basis ([\\d,.]+)`));
        out.push({
          lotId,
          documentId: doc.id,
          page: page.page,
          printed: available ? text : "",
          parsed: detail
            ? { description: detail[1], acquired: detail[2], sold: detail[3], proceeds: available ? parseMoney(detail[4]) : null, basis: available ? parseMoney(detail[5]) : null }
            : { description: null, acquired: null, sold: null, proceeds: null, basis: null },
          status: `printed on ${doc.marked_corrected ? "the corrected statement" : "the statement"}, not extracted, not on the return`,
          extractionReason: doc.extraction.reason,
          href: `/evidence/${doc.id}?page=${page.page}`,
          anchorHref: `/evidence/${doc.id}?page=${page.page}#anchor-subject`,
          available,
          availableAt: at,
        });
      }
    }
  }
  return out;
}

function summaryCheck(b: Rb, docIds: string[], lots: LotView[], unmatched: UnmatchedLot[]): SummaryCheck | null {
  const summary = b.packet.extracted_values.find((e) => docIds.includes(e.document_id) && /summary_proceeds$/.test(e.field) && typeof e.value === "number");
  const diag = b.state.findings.find((f) => f.code === "BROKER_SUMMARY_DETAIL_MISMATCH" && f.refs.some((r) => docIds.includes(b.idx.extractedValues.get(r)?.document_id ?? "")));
  if (!summary && !diag) return null;
  const lotProceeds = Math.round(lots.reduce((n, l) => n + (l.proceeds ?? 0), 0) * 100) / 100;
  const summaryAmount = summary ? numeric(summary.value) : null;
  const difference = summaryAmount === null ? null : Math.round((summaryAmount - lotProceeds) * 100) / 100;
  const explains = difference === null ? [] : unmatched.filter((u) => u.parsed.proceeds !== null && Math.abs(u.parsed.proceeds - difference) < 0.005).map((u) => u.lotId);
  return {
    summaryValue: summary ? b.value(summary.id) : null,
    summaryAmount,
    lotProceeds,
    lotCount: lots.length,
    difference,
    explains,
    diagnostic: diag ? b.finding(diag) : null,
    message:
      difference === null
        ? null
        : difference === 0
          ? "The broker summary equals the lots on the return."
          : `The broker summary exceeds the lots on the return by ${moneyText(difference, true)}${explains.length ? `, which equals the proceeds printed for ${explains.join(", ")}` : ""}. Observation only; the inspector and the evidence page hold the forms to act on it.`,
  };
}

export async function salesView(ctx: SessionContext, opts: SalesQuery = {}): Promise<SalesView> {
  const { b, redact } = await build(ctx);
  const q = (opts.q ?? "").trim();
  const selectedGroup = (opts.group ?? "").trim().toUpperCase() || null;
  const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);

  const allLines = b.form("F8949");
  const totals = allLines.filter((l) => l.key.endsWith(".total"));
  const lotLines = allLines.filter((l) => LOT_KEY.test(l.key));
  const supplements = supplementIndex(b);
  const lots = lotLines.map((l) => lotView(b, l, supplements));

  const boxes: BoxSummaryView[] = totals.map((t) => {
    const box = t.key.match(/^F8949\.([A-Z]+)\.total$/)?.[1] ?? "?";
    const holding = holdingFor(`F8949.${box}.X0`, "");
    const carries = b.version.lines.find((l) => l.form === "SchD" && l.inputs.includes(t.key));
    return {
      box,
      holding,
      holdingLabel: holdingLabelOf(holding),
      lotCount: t.inputs.length,
      ...parseTotalLabel(t.label),
      total: t,
      carriesTo: carries ? b.line(carries.key) : null,
    };
  });

  // Groups in order of first appearance, keyed by the lot id prefix (N, M, X, C, SCORP).
  const order: string[] = [];
  const byPrefix = new Map<string, LotView[]>();
  for (const lot of lots) {
    const prefix = lot.lotId.replace(/\d+$/, "");
    if (!byPrefix.has(prefix)) {
      byPrefix.set(prefix, []);
      order.push(prefix);
    }
    byPrefix.get(prefix)!.push(lot);
  }
  const extractedLotIds = new Set<string>();
  for (const e of b.packet.extracted_values) {
    const m = e.field.match(/^([A-Z]+\d+)_/);
    if (m) extractedLotIds.add(m[1]);
  }

  const groups: LotGroupView[] = order.map((prefix) => {
    const all = byPrefix.get(prefix)!;
    const docIds = b.docsCitedBy(all.flatMap((l) => l.sources.map((s) => s.ref)));
    const primary = b.idx.documents.get(docIds[0] ?? "");
    const scorp = prefix === "SCORP";
    const onReturn = new Set(all.map((l) => l.lotId));
    const unmatchedAll = scorp ? [] : unmatchedLots(b, prefix, docIds, onReturn, extractedLotIds);
    const matchedLots = all.filter((l) => lotMatches(l, q));
    const unmatched = q ? unmatchedAll.filter((u) => u.lotId.toLowerCase() === q.toLowerCase() || u.printed.toLowerCase().includes(q.toLowerCase())) : unmatchedAll;
    const pageCount = Math.max(1, Math.ceil(matchedLots.length / LOT_PAGE_SIZE));
    const current = selectedGroup === prefix ? Math.min(page, pageCount) : 1;
    const start = (current - 1) * LOT_PAGE_SIZE;
    const slice = matchedLots.slice(start, start + LOT_PAGE_SIZE);
    const wash = all.filter((l) => l.adjustment?.code === "W");
    const broker = scorp ? "Lindqvist Family Woodworks, Inc. (Form 7203)" : (primary?.issuer ?? "unknown broker");
    const accountLabel = scorp ? null : accountOf(primary);
    return {
      id: prefix,
      label: scorp ? "S corporation distributions in excess of stock basis" : `${broker}${accountLabel ? `, ${accountLabel}` : ""} (${prefix} lots)`,
      broker,
      accountLabel,
      documents: b.docs(docIds),
      lotCount: all.length,
      matched: matchedLots.length,
      page: current,
      pageCount,
      from: matchedLots.length === 0 ? 0 : start + 1,
      to: Math.min(start + LOT_PAGE_SIZE, matchedLots.length),
      lots: slice,
      unmatched,
      washSale: { count: wash.length, amount: Math.round(wash.reduce((n, l) => n + (l.adjustment?.amount ?? 0), 0) * 100) / 100 },
      summaryCheck: scorp ? null : summaryCheck(b, docIds, all, unmatchedAll),
      clientItems: scorp ? [] : b.clientMentions(keywordOf(broker)),
      passthroughHref: scorp ? "/review/passthroughs" : null,
    };
  });

  const into = [
    { label: "Short-term capital loss carried into 2025", pointer: "/carryovers_into_2025/capital_loss_short" },
    { label: "Long-term capital loss carried into 2025", pointer: "/carryovers_into_2025/capital_loss_long" },
  ].map((c) => {
    const r = b.priorYearNumber(c.pointer);
    return { label: c.label, amount: r.amount, ref: r.ref };
  });

  const view: SalesView = {
    ...b.header("investments_and_digital_assets"),
    query: q,
    group: selectedGroup,
    pageSize: LOT_PAGE_SIZE,
    boxes,
    groups,
    lotCount: lots.length,
    matched: groups.reduce((n, g) => n + g.matched, 0),
    schD: b.form("SchD"),
    carryovers: {
      into,
      out: [
        { label: `Short-term capital loss carried out of 2025 (${b.version.version})`, amount: b.carryoverOut("capital_loss_short") },
        { label: `Long-term capital loss carried out of 2025 (${b.version.version})`, amount: b.carryoverOut("capital_loss_long") },
      ],
    },
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* Rentals: Schedule E, Form 4797, Form 8582.                                 */
/* ------------------------------------------------------------------------ */

export interface PropertyView {
  column: string;
  address: string;
  days: RbLine | null;
  income: RbLine[];
  expenses: RbLine[];
  totals: RbLine[];
  /** The owner statement or ledger that is the property's books. */
  book: DocView | null;
  supporting: DocView[];
}

export interface GridRow {
  lineNo: string;
  label: string;
  cells: (RbLine | null)[];
}

export interface RentalsView extends RbHeader {
  properties: PropertyView[];
  grid: GridRow[];
  hvac: {
    line: RbLine | null;
    note: string | null;
    evidence: ValueView[];
    invoice: DocView | null;
    whatIf: WhatIfNote | null;
    judgments: JudgmentNote[];
    judgmentHref: string;
    clientItems: ClientItemView[];
  };
  sale: {
    lines: RbLine[];
    recapture: RbLine[];
    notes: { key: string; label: string; note: string }[];
    docs: DocView[];
    assets: RefView[];
  };
  passive: {
    lines: RbLine[];
    prior: { label: string; amount: number | null; ref: RefView }[];
    allowed: RbLine[];
    out: { label: string; amount: number | null }[];
    note: string | null;
  };
  depreciation: { href: string; lines: RbLine[] };
  totals: RbLine[];
}

const SCHE_PROPERTY_KEY = /^SchE\.(\d+)([A-Z])$/;

export async function rentalsView(ctx: SessionContext): Promise<RentalsView> {
  const { b, redact } = await build(ctx);
  // Rows 28 and 32 are the K-1 part of Schedule E; they belong to pass-throughs, not to a property column.
  const schE = b.form("SchE", (k) => !/^SchE\.(28|32)/.test(k));
  const columns: string[] = [];
  for (const l of schE) {
    const m = l.key.match(SCHE_PROPERTY_KEY);
    if (m && !columns.includes(m[2])) columns.push(m[2]);
  }
  columns.sort();

  const lineNo = (key: string) => key.match(SCHE_PROPERTY_KEY)?.[1] ?? "";
  const incomeNos = new Set(["3", "4"]);
  const totalNos = new Set(["20", "21", "22"]);

  const properties: PropertyView[] = columns.map((col) => {
    const mine = schE.filter((l) => l.key.match(SCHE_PROPERTY_KEY)?.[2] === col);
    const addressLine = mine.find((l) => lineNo(l.key) === "1");
    const address = typeof addressLine?.effective === "string" ? addressLine.effective : `Property ${col}`;
    const cited = b.docsCitedBy(mine.flatMap((l) => l.sources.map((s) => s.ref)));
    const street = address.split(",")[0].replace(/\s+Unit\b.*$/i, "").trim();
    const byTitle = street ? b.packet.documents.filter((d) => d.title.includes(street)).map((d) => d.id) : [];
    const docIds = [...new Set([...cited, ...byTitle])].sort();
    const docs = b.docs(docIds);
    const book = docs.find((d) => /rental_owner_statement|rental_ledger/.test(b.idx.documents.get(d.id)?.document_type ?? "")) ?? null;
    return {
      column: col,
      address,
      days: mine.find((l) => lineNo(l.key) === "2") ?? null,
      income: mine.filter((l) => incomeNos.has(lineNo(l.key))),
      expenses: mine.filter((l) => {
        const n = lineNo(l.key);
        return n !== "" && !incomeNos.has(n) && !totalNos.has(n) && n !== "1" && n !== "2";
      }),
      totals: mine.filter((l) => totalNos.has(lineNo(l.key))),
      book,
      supporting: docs.filter((d) => d.id !== book?.id),
    };
  });

  const gridNos: string[] = [];
  for (const l of schE) {
    const n = lineNo(l.key);
    if (n && n !== "1" && !gridNos.includes(n)) gridNos.push(n);
  }
  gridNos.sort((x, y) => Number(x) - Number(y));
  const grid: GridRow[] = gridNos.map((n) => {
    const cells = columns.map((col) => schE.find((l) => l.key === `SchE.${n}${col}`) ?? null);
    const label = (cells.find((c) => c)?.label ?? `Line ${n}`).replace(/\s+-\s+property [A-Z]$/i, "");
    return { lineNo: n, label, cells };
  });

  const hvacLine = schE.find((l) => /HVAC/i.test(l.note ?? "")) ?? null;
  const hvacEvidence = b.packet.extracted_values.filter((e) => /hvac/i.test(e.label) || /hvac/i.test(e.field)).map((e) => e.id);
  const hvacInvoice = b.packet.documents.find((d) => d.document_type === "invoice" && /heating|air|hvac/i.test(`${d.issuer} ${d.title}`));
  const invoiceValues = hvacInvoice ? b.packet.extracted_values.filter((e) => e.document_id === hvacInvoice.id).map((e) => e.id) : [];
  const hvacKeys = hvacLine ? [hvacLine.key] : [];

  const f4797 = b.form("F4797");
  const recaptureKeys = f4797.filter((l) => /depreciation|section 1250/i.test(l.label)).map((l) => l.key);
  const schD19 = b.line("SchD.19");
  const saleRefs = f4797.flatMap((l) => l.sources.map((s) => s.ref));
  const saleDocs = b.docsCitedBy(saleRefs);
  const condo = properties.find((p) => /Barton Hills/i.test(p.address));
  const condoBook = condo?.supporting.filter((d) => /closing_statement_seller|1099-S|^1098$/.test(b.idx.documents.get(d.id)?.document_type ?? "")).map((d) => d.id) ?? [];

  const priorPassive = Object.keys((b.packet.prior_years.carryovers_into_2025 as Record<string, unknown>) ?? {})
    .filter((k) => k.startsWith("passive_"))
    .map((k) => {
      const r = b.priorYearNumber(`/carryovers_into_2025/${k}`);
      return { label: `Prior-year unallowed loss, ${k.replace(/^passive_/, "").replace(/_/g, " ")}`, amount: r.amount, ref: r.ref };
    });
  const outPassive = Object.keys((b.version.carryovers_out.federal as Record<string, unknown>) ?? {})
    .filter((k) => k.startsWith("passive_"))
    .map((k) => ({ label: `Unallowed loss carried out of 2025, ${k.replace(/^passive_/, "").replace(/_/g, " ")} (${b.version.version})`, amount: b.carryoverOut(k) }));
  const f8582 = b.form("F8582");

  const view: RentalsView = {
    ...b.header("rentals_and_sale"),
    properties,
    grid,
    hvac: {
      line: hvacLine,
      note: hvacLine?.note ?? null,
      evidence: b.values([...new Set([...hvacEvidence, ...invoiceValues])]),
      invoice: hvacInvoice ? b.doc(hvacInvoice.id) : null,
      whatIf: b.whatIfTouching(hvacKeys)[0] ?? null,
      judgments: b.judgmentsFor(hvacKeys),
      judgmentHref: hvacLine ? `/review/judgments?subject=${encodeURIComponent(hvacLine.key)}` : "/review/judgments",
      clientItems: b.clientMentions("HVAC"),
    },
    sale: {
      lines: f4797,
      recapture: [...b.lines(recaptureKeys), ...(schD19 ? [schD19] : [])],
      notes: [...f4797, ...(schD19 ? [schD19] : [])].filter((l) => l.note).map((l) => ({ key: l.key, label: l.label, note: l.note! })),
      docs: b.docs([...new Set([...saleDocs, ...condoBook])].sort()),
      assets: b.refs([...new Set(saleRefs.filter((r) => parseRef(r).kind === "asset"))]),
    },
    passive: {
      lines: f8582,
      prior: priorPassive,
      allowed: schE.filter((l) => lineNo(l.key) === "22"),
      out: outPassive,
      note: f8582.find((l) => l.note)?.note ?? null,
    },
    depreciation: { href: "/review/assets", lines: b.form("F4562-E") },
    totals: schE.filter((l) => !SCHE_PROPERTY_KEY.test(l.key)),
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* Pass-throughs: K-1s, Form 7203, partnership capital.                       */
/* ------------------------------------------------------------------------ */

export interface BasisYearRow {
  year: number;
  endingStockBasis: number | null;
  k1Income: number | null;
  distributions: number | null;
  source: string;
}

export interface RollforwardRow {
  year: number;
  beginning: number | null;
  income: number | null;
  interest: number | null;
  distributions: number | null;
  ending: number | null;
  source: string;
  refs: RefView[];
  /** Where the year's figures came from: a packet record, a K-1 document, or nothing (gap). */
  basis: "record" | "document" | "gap";
}

export interface EntityView {
  id: string;
  name: string;
  kind: string;
  lines: RbLine[];
  docs: DocView[];
  related: RelatedReturnView | null;
}

export interface PassthroughsView extends RbHeader {
  entities: EntityView[];
  scorpBasis: {
    records: BasisYearRow[];
    rollforward: RollforwardRow[];
    computedBeginning: number | null;
    engineBeginning: RbLine | null;
    matches: boolean | null;
    versions: { version: string; computedAt: string; value: LineValue | null; note: string | null }[];
    diagnostic: DiagnosticTrail;
    f7203: RbLine[];
    distributions: { basisBefore: RbLine | null; distributions: RbLine | null; excess: RbLine | null; gainLine: RbLine | null };
    priorNotes: string[];
    priorDoc: DocView | null;
  };
  partnership: {
    name: string;
    capitalAccount: { amount: number | null; refs: RefView[]; carryoverLabel: string };
    outsideBasis: { known: false; label: string; record: string | null };
    k1: DocView | null;
    stateSupplement: { doc: DocView | null; facts: ValueView[]; printed: string | null; note: string };
    record: BasisYearRow | null;
  };
  relatedReturns: RelatedReturnView[];
  lateK1: {
    events: TimelineNote[];
    clientItems: ClientItemView[];
    diagnostic: DiagnosticTrail;
    changes: VersionChange[];
  };
}

function relatedReturn(b: Rb, r: Packet["household"]["related_returns"][number]): RelatedReturnView {
  const ids = typeof r.in_this_packet === "string" ? [...r.in_this_packet.matchAll(/\bD\d{2}\b/g)].map((m) => m[0]) : [];
  const inPacket = r.in_this_packet === true ? "in this packet" : r.in_this_packet === false ? "not in this packet" : r.in_this_packet;
  return {
    who: r.who,
    return: r.return,
    preparedBy: r.prepared_by,
    inPacket,
    docs: b.docs(ids),
    contents: ids.length ? `contents unknown beyond ${ids.join(", ")}` : "contents unknown",
  };
}

export async function passthroughsView(ctx: SessionContext): Promise<PassthroughsView> {
  const { b, redact } = await build(ctx);
  const related = b.packet.household.related_returns.map((r) => relatedReturn(b, r));

  const k1Lines = b.form("SchE", (k) => /^SchE\.28/.test(k));
  const f7203 = b.form("F7203");
  const byEntity = (name: string) => b.version.lines.filter((l) => l.label.includes(name) && !/^F8949\./.test(l.key)).map((l) => l.key);
  const scorpDocs = b.docsByType(["K-1-1120S"]).sort((x, y) => y.tax_year - x.tax_year);
  const partnershipDocs = b.docsByType(["K-1-1065", "K-1-state-supplement"]);
  const scorpName = scorpDocs[0]?.issuer ?? "S corporation";
  const partnershipName = partnershipDocs[0]?.issuer ?? "partnership";
  const scorpKeys = [...new Set([...k1Lines.filter((l) => /S corporation/i.test(l.label)).map((l) => l.key), ...f7203.map((l) => l.key), ...byEntity(scorpName.split(",")[0]), "F8949.F.SCORP"])];
  const partnerKeys = [...new Set([...k1Lines.filter((l) => /LP|partnership/i.test(l.label)).map((l) => l.key), ...byEntity(partnershipName.split(",")[0]), "SchD.12", "Sch3.1"])];

  const entities: EntityView[] = [
    {
      id: "scorp",
      name: scorpName,
      kind: "S corporation",
      lines: b.lines(scorpKeys.filter((k) => b.packetLines.has(k))),
      docs: b.docs(scorpDocs.map((d) => d.id)),
      related: related.find((r) => r.who === scorpName) ?? null,
    },
    {
      id: "partnership",
      name: partnershipName,
      kind: "partnership",
      lines: b.lines(partnerKeys.filter((k) => b.packetLines.has(k))),
      docs: b.docs(partnershipDocs.map((d) => d.id)),
      related: related.find((r) => r.who === partnershipName) ?? null,
    },
  ];

  // S corporation stock basis: records by year, then a roll-forward reproduced here.
  const basisRecords = (b.packet.prior_years.basis_records as Record<string, unknown>) ?? {};
  const scorpKey = Object.keys(basisRecords).find((k) => k.startsWith("scorp_")) ?? "";
  const scorpRows = ((basisRecords[scorpKey] as Record<string, unknown>[] | undefined) ?? []).map((r) => ({
    year: Number(r.year),
    endingStockBasis: numeric(r.ending_stock_basis),
    k1Income: numeric(r.k1_income),
    distributions: numeric(r.distributions),
    source: String(r.source ?? ""),
  }));
  const rollforward: RollforwardRow[] = [];
  let running: number | null = null;
  const firstKnown = scorpRows.find((r) => r.endingStockBasis !== null);
  if (firstKnown) {
    running = firstKnown.endingStockBasis;
    rollforward.push({ year: firstKnown.year, beginning: null, income: null, interest: null, distributions: null, ending: running, source: firstKnown.source, refs: b.refs([`py:/basis_records/${scorpKey}/${scorpRows.indexOf(firstKnown)}`]), basis: "record" });
    const lastYear = b.packet.household.tax_year - 1;
    for (let year = firstKnown.year + 1; year <= lastYear; year++) {
      const rec = scorpRows.find((r) => r.year === year);
      const doc = scorpDocs.find((d) => d.tax_year === year);
      const docValues = doc && b.isAvailable(isoOrNull(doc.received_at)) ? b.packet.extracted_values.filter((e) => e.document_id === doc.id) : [];
      const fromDoc = (field: string) => numeric(docValues.find((e) => e.field === field)?.value);
      let income = rec?.k1Income ?? null;
      let interest: number | null = null;
      let distributions = rec?.distributions ?? null;
      let basis: RollforwardRow["basis"] = income !== null || distributions !== null ? "record" : "gap";
      let source = rec?.source ?? "no record";
      let refs: RefView[] = rec ? b.refs([`py:/basis_records/${scorpKey}/${scorpRows.indexOf(rec)}`]) : [];
      if ((income === null || distributions === null) && doc) {
        income = income ?? fromDoc("box1");
        interest = fromDoc("box4");
        distributions = distributions ?? fromDoc("box16d");
        basis = income !== null && distributions !== null ? "document" : basis;
        source = `${doc.title} (${doc.id})`;
        refs = [...refs, ...b.refs(docValues.filter((e) => /^(box1|box4|box16d)$/.test(e.field)).map((e) => e.id))];
      }
      const beginning = running;
      const ending = beginning !== null && income !== null && distributions !== null ? Math.round((beginning + income + (interest ?? 0) - distributions) * 100) / 100 : null;
      rollforward.push({ year, beginning, income, interest, distributions, ending, source, refs, basis });
      running = ending;
    }
  }
  const engineBeginning = f7203.find((l) => /beginning/i.test(l.label)) ?? null;
  const engineValue = engineBeginning ? numeric(engineBeginning.effective) : null;
  const versions = b.packet.return_versions.map((v) => {
    const l = v.lines.find((x) => x.key === engineBeginning?.key);
    return { version: v.version, computedAt: isoOrNull(v.computed_at) ?? v.computed_at, value: (l?.value as LineValue) ?? null, note: l?.note ?? null };
  });
  const priorWp = (b.packet.prior_years.prior_preparer_workpaper as { notes?: string[]; open_items_left_by_prior_preparer?: string[]; source_document?: string } | undefined) ?? {};
  const priorNotes = [...(priorWp.notes ?? []), ...(priorWp.open_items_left_by_prior_preparer ?? [])].filter((n) => /basis|K-1/i.test(n));

  // Partnership: capital account is known, outside basis is not.
  const partnerKey = Object.keys(basisRecords).find((k) => k.startsWith("partnership_")) ?? "";
  const partnerRecord = ((basisRecords[partnerKey] as Record<string, unknown>[] | undefined) ?? [])[0];
  const capitalEnd = Object.keys((b.version.carryovers_out.federal as Record<string, unknown>) ?? {}).find((k) => /capital_account_end$/.test(k)) ?? "";
  const k1Doc = partnershipDocs.find((d) => d.document_type === "K-1-1065");
  const capEndValue = k1Doc ? b.packet.extracted_values.find((e) => e.document_id === k1Doc.id && e.field === "cap_end") : undefined;
  const supplementDoc = partnershipDocs.find((d) => d.document_type === "K-1-state-supplement");
  const supplementView = supplementDoc ? b.doc(supplementDoc.id, { pages: true }) : null;

  const k1Refs = [...partnershipDocs.map((d) => d.id)];
  const lateEvents = b.timelineCiting(k1Refs);
  const v3Changes = b.version.changes_from_previous.filter((c) => partnerKeys.includes(c.key)).map((c) => b.change(c));

  const view: PassthroughsView = {
    ...b.header("pass_throughs_and_basis"),
    entities,
    scorpBasis: {
      records: scorpRows,
      rollforward,
      computedBeginning: running,
      engineBeginning,
      matches: running !== null && engineValue !== null ? Math.abs(running - engineValue) < 0.51 : null,
      versions,
      diagnostic: b.trail("SCORP_BASIS_INCOMPLETE"),
      f7203,
      distributions: {
        basisBefore: f7203.find((l) => /before distributions/i.test(l.label)) ?? null,
        distributions: f7203.find((l) => /^Distributions$/i.test(l.label)) ?? null,
        excess: f7203.find((l) => /excess/i.test(l.label)) ?? null,
        gainLine: b.line("F8949.F.SCORP"),
      },
      priorNotes,
      priorDoc: priorWp.source_document ? b.doc(priorWp.source_document) : null,
    },
    partnership: {
      name: partnershipName,
      capitalAccount: {
        amount: b.carryoverOut(capitalEnd) ?? numeric(capEndValue?.value),
        refs: b.refs([...(capEndValue ? [capEndValue.id] : [])]),
        carryoverLabel: capitalEnd ? `carryovers_out.federal.${capitalEnd} (${b.version.version})` : "not in carryovers_out",
      },
      outsideBasis: {
        known: false,
        label: "unknown",
        record: partnerRecord ? String(partnerRecord.source ?? "") : null,
      },
      k1: k1Doc ? b.doc(k1Doc.id) : null,
      stateSupplement: {
        doc: supplementView,
        facts: supplementView?.values ?? [],
        printed: supplementView?.pages[0]?.text ?? null,
        note: "The supplement states the partnership filed the Arizona composite return for nonresident partners. This workpaper records that fact as printed; it does not create, assume or schedule an Arizona filing for the household.",
      },
      record: partnerRecord
        ? { year: Number(partnerRecord.year), endingStockBasis: numeric(partnerRecord.ending_capital_account), k1Income: null, distributions: null, source: String(partnerRecord.source ?? "") }
        : null,
    },
    relatedReturns: related,
    lateK1: {
      events: lateEvents,
      clientItems: b.clientMentions(keywordOf(partnershipName)),
      diagnostic: b.trail("K1_EXPECTED_NOT_RECEIVED"),
      changes: v3Changes,
    },
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* Retirement and foreign: Forms 8606, 8889, SEP, SE health, Schedule B, 8938.*/
/* ------------------------------------------------------------------------ */

export interface FxAlternative {
  rate: string;
  ref: string;
  label: string;
  value: number | null;
  /** The line as it would read at this rate, computed here from the SEK amount. */
  usd: number | null;
  used: boolean;
}

export interface RetirementForeignView extends RbHeader {
  ira: {
    lines: RbLine[];
    docs: DocView[];
    priorBasis: { amount: number | null; refs: RefView[] };
    questionnaire: ClientItemView | null;
    conflict: string;
  };
  hsa: {
    lines: RbLine[];
    docs: DocView[];
    codeW: ValueView[];
    limit: ParamView;
  };
  sep: {
    line: RbLine | null;
    note: string | null;
    deposit: ValueView[];
    doc: DocView | null;
    deposited: number | null;
    deducted: number | null;
    notDeductible: { amount: number | null; label: string };
    openItem: string;
    questionnaire: ClientItemView | null;
  };
  sehi: {
    line: RbLine | null;
    doc: DocView | null;
    premiums: ValueView[];
    questionnaire: ClientItemView | null;
    priorYearNote: string | null;
    judgmentItem: string;
    judgments: JudgmentNote[];
    judgmentHref: string;
  };
  foreign: {
    interest: RbLine | null;
    sek: ValueView | null;
    sekAmount: number | null;
    rateUsed: FxAlternative | null;
    alternatives: FxAlternative[];
    rateNote: string;
    account: RbLine[];
    f8938: RbLine[];
    yearEndRate: FxAlternative | null;
    maxValue: ValueView | null;
    yeValue: ValueView | null;
    fbar: { diagnostic: DiagnosticTrail; deadline: { what: string; date: string } | null; priorNote: string | null };
    doc: DocView | null;
  };
}

export async function retirementForeignView(ctx: SessionContext): Promise<RetirementForeignView> {
  const { b, redact } = await build(ctx);

  const f8606 = b.form("F8606");
  const iraDocs = b.docsByType(["1099-R", "5498"]).map((d) => d.id);
  const prior = f8606.find((l) => /basis in traditional IRAs/i.test(l.label)) ?? null;
  const qa31 = b.packet.client.questionnaire.find((q) => /prior basis/i.test(q.question));

  const f8889 = b.form("F8889");
  const hsaDocs = b.docsByType(["1099-SA", "5498-SA"]).map((d) => d.id);
  const codeW = b.packet.extracted_values.filter((e) => /^box12_W$/.test(e.field)).map((e) => e.id);

  const sep = b.line("Sch1.16");
  const sepDoc = b.docsByType(["retirement_contribution"])[0];
  const sepValues = sepDoc ? b.packet.extracted_values.filter((e) => e.document_id === sepDoc.id).map((e) => e.id) : [];
  const deposited = sepDoc ? numeric(b.packet.extracted_values.find((e) => e.document_id === sepDoc.id && e.value_type === "money")?.value) : null;
  const sepCarry = Object.keys((b.version.carryovers_out.federal as Record<string, unknown>) ?? {}).find((k) => /^sep_/.test(k)) ?? "";
  const qa26 = b.packet.client.questionnaire.find((q) => /SEP/i.test(q.question));

  const sehi = b.line("Sch1.17");
  const sehiDoc = b.docsByType(["insurance_statement"])[0];
  const qa25 = b.packet.client.questionnaire.find((q) => /eligible for health coverage/i.test(q.question));
  const priorNotes = (b.packet.prior_years.return_2024 as { notes?: Record<string, string> } | undefined)?.notes ?? {};

  const schB = b.form("SchB");
  const foreignInterest = schB.find((l) => /SEK/.test(l.label)) ?? null;
  const sekValue = foreignInterest?.sources.find((s) => s.kind === "extracted_value");
  const sekAmount = sekValue ? numeric(b.idx.extractedValues.get(sekValue.ref)?.value) : null;
  const usedRef = foreignInterest?.sources.find((s) => s.kind === "fx")?.ref ?? null;
  const fx = (b.packet.engine_reference.parameters.fx as { SEK?: Record<string, number> } | undefined)?.SEK ?? {};
  const alternatives: FxAlternative[] = Object.keys(fx).map((rate) => {
    const r = b.fxRate(rate);
    return { rate, ref: r.ref, label: r.label, value: r.value, usd: sekAmount !== null && r.value ? Math.round(sekAmount / r.value) : null, used: r.ref === usedRef };
  });
  const rateUsed = alternatives.find((a) => a.used) ?? null;
  const f8938 = b.form("F8938");
  const yeRef = f8938.flatMap((l) => l.sources).find((s) => s.kind === "fx")?.ref ?? null;
  const foreignDoc = b.docsByType(["foreign_bank_statement"])[0];
  const foreignValues = foreignDoc ? b.packet.extracted_values.filter((e) => e.document_id === foreignDoc.id) : [];
  const deadline = b.packet.firm.deadlines.find((d) => /FinCEN|FBAR/i.test(d.what)) ?? null;
  const priorWp = (b.packet.prior_years.prior_preparer_workpaper as { notes?: string[] } | undefined)?.notes ?? [];

  const view: RetirementForeignView = {
    ...b.header("deductions_and_credits"),
    ira: {
      lines: f8606,
      docs: b.docs(iraDocs),
      priorBasis: { amount: prior ? numeric(prior.effective) : null, refs: prior?.sources ?? [] },
      questionnaire: qa31 ? b.client(qa31.id) : null,
      conflict: prior
        ? `The questionnaire answer says there is no prior basis, while the 2024 Form 8606 line 14 and the 2024 Form 5498 show ${moneyText(numeric(prior.effective))} contributed for 2024. The engine carried ${moneyText(numeric(prior.effective))} on ${prior.key}; the records, not the answer, drive the line. Record the resolution as a verification on the line.`
        : "No prior-basis line in this version.",
    },
    hsa: {
      lines: f8889,
      docs: b.docs(hsaDocs),
      codeW: b.values(codeW),
      limit: b.param("hsa_family_limit", "HSA family limit"),
    },
    sep: {
      line: sep,
      note: sep?.note ?? null,
      deposit: b.values(sepValues),
      doc: sepDoc ? b.doc(sepDoc.id) : null,
      deposited,
      deducted: sep ? numeric(sep.effective) : null,
      notDeductible: { amount: b.carryoverOut(sepCarry), label: sepCarry ? `carryovers_out.federal.${sepCarry} (${b.version.version})` : "not in carryovers_out" },
      openItem: "Open item: the deposit exceeds the engine's 2025 limit. The excess is carried out as not deductible for 2025; its treatment for 2026 (and any excess-contribution exposure) is not decided here.",
      questionnaire: qa26 ? b.client(qa26.id) : null,
    },
    sehi: {
      line: sehi,
      doc: sehiDoc ? b.doc(sehiDoc.id) : null,
      premiums: sehiDoc ? b.values(b.packet.extracted_values.filter((e) => e.document_id === sehiDoc.id).map((e) => e.id)) : [],
      questionnaire: qa25 ? b.client(qa25.id) : null,
      priorYearNote: priorNotes["Sch1.17"] ?? null,
      judgmentItem: "Judgment item: the questionnaire says the spouse was eligible for employer coverage, and the 2024 return took no deduction for that reason. The engine allowed the full premiums. Nothing is disallowed automatically here; the eligibility months and the conclusion belong in a recorded judgment.",
      judgments: b.judgmentsFor(sehi ? [sehi.key] : []),
      judgmentHref: sehi ? `/review/judgments?subject=${encodeURIComponent(sehi.key)}` : "/review/judgments",
    },
    foreign: {
      interest: foreignInterest,
      sek: sekValue ? b.value(sekValue.ref) : null,
      sekAmount,
      rateUsed,
      alternatives,
      rateNote:
        "Identified rate choice to document: the engine converted at the rate named in the line's sources. The other supplied rates are shown with what the line would read at each; none is applied here. If a different rate is the right one, propose it on the line with the rate reference as evidence.",
      account: schB.filter((l) => /^SchB\.(7a|7b|8)$/.test(l.key)),
      f8938,
      yearEndRate: yeRef ? (alternatives.find((a) => a.ref === yeRef) ?? null) : null,
      maxValue: b.value(foreignValues.find((e) => /max/i.test(e.field))?.id ?? ""),
      yeValue: b.value(foreignValues.find((e) => /balance_ye|year.?end/i.test(e.field))?.id ?? ""),
      fbar: {
        diagnostic: b.trail("FBAR_OUTSIDE_RETURN"),
        deadline,
        priorNote: priorWp.find((n) => /FBAR/i.test(n)) ?? null,
      },
      doc: foreignDoc ? b.doc(foreignDoc.id, { pages: true }) : null,
    },
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* Deductions and credits.                                                    */
/* ------------------------------------------------------------------------ */

export interface Callout {
  id: string;
  title: string;
  detail: string;
  evidence: ValueView[];
  refs: RefView[];
  docs: DocView[];
  /** Where to act: the inspector's propose form, the evidence page, or the judgments screen. */
  actions: { label: string; href: string }[];
}

export interface DeductionsCreditsView extends RbHeader {
  salt: {
    lines: RbLine[];
    params: ParamView[];
    rules: { id: string; text: string }[];
    agi: RbLine | null;
    capApplies: string;
  };
  propertyTax: { line: RbLine | null; docs: DocView[]; sellerCredit: Callout | null };
  mortgage: { lines: RbLine[]; docs: DocView[]; payoff: Callout | null; rentalInterest: RbLine | null };
  charitable: {
    cash: { line: RbLine | null; docs: DocView[]; lowConfidence: Callout | null; corroboration: ClientItemView[] };
    noncash: { lines: RbLine[]; total: RbLine | null; docs: DocView[]; vehicle: Callout | null };
    totals: RbLine[];
  };
  education: { lines: RbLine[]; docs: DocView[]; params: ParamView[]; diagnostic: DiagnosticTrail; agi: RbLine | null };
  dependentCare: { lines: RbLine[]; docs: DocView[]; params: ParamView[]; callouts: Callout[] };
  childTaxCredit: { lines: RbLine[]; params: ParamView[] };
  dueDiligence: { line: RbLine | null; finding: FindingNote | null; trail: DiagnosticTrail; judgments: JudgmentNote[]; href: string };
  itemizedTotal: RbLine | null;
}

export async function deductionsCreditsView(ctx: SessionContext): Promise<DeductionsCreditsView> {
  const { b, redact } = await build(ctx);
  const schA = b.form("SchA");
  const agi = b.line("F1040.11");
  const saltLines = schA.filter((l) => /^SchA\.(5[a-e]|7)$/.test(l.key));
  const saltRules = ["R-SALT-INCOME", "R-SALT-PROPERTY", "R-SALT-CAP"].map((id) => ({ id, text: b.packet.engine_reference.rules[id] ?? "not described" }));
  const saltParams = ["salt_cap", "salt_cap_phase_start", "salt_cap_phase_rate", "salt_cap_floor"].map((n) => b.param(n));
  const agiValue = agi ? numeric(agi.effective) : null;
  const phaseStart = numeric(b.packet.engine_reference.parameters.salt_cap_phase_start);
  const capApplies =
    agiValue !== null && phaseStart !== null
      ? agiValue > phaseStart
        ? `Modified AGI ${moneyText(agiValue)} is above the phase start ${moneyText(phaseStart)}: the cap is reduced per the rule.`
        : `Modified AGI ${moneyText(agiValue)} is below the phase start ${moneyText(phaseStart)}: the full cap applies.`
      : "AGI or the phase start is not available in this version.";

  // Property tax and the buyer closing statement's seller credit.
  const propertyTax = schA.find((l) => l.rule === "R-SALT-PROPERTY") ?? null;
  const buyerClosing = b.docsByType(["closing_statement_buyer"])[0];
  const sellerCredit = buyerClosing ? b.packet.extracted_values.find((e) => e.document_id === buyerClosing.id && /tax_credit|seller credit/i.test(`${e.field} ${e.label}`)) : undefined;
  const taxDocs = b.docsCitedBy(propertyTax?.sources.map((s) => s.ref) ?? []);

  // Mortgage interest: each 1098 and the payoff statement.
  const mortgageLines = schA.filter((l) => /^SchA\.(8[a-e]|10)$/.test(l.key));
  const interestLine = schA.find((l) => l.rule === "R-MORTGAGE-INTEREST") ?? null;
  const mortgageDocIds = [...new Set([...b.docsCitedBy(mortgageLines.flatMap((l) => l.sources.map((s) => s.ref))), ...b.docsByType(["1098", "payoff_statement"]).map((d) => d.id)])].sort();
  const payoffDoc = b.docsByType(["payoff_statement"])[0];
  const payoffValue = payoffDoc ? b.packet.extracted_values.find((e) => e.document_id === payoffDoc.id && /interest/i.test(e.field)) : undefined;
  const form1098WithPayoff = b.docsByType(["1098"]).find((d) => d.pages.some((p) => /interest paid at payoff|includes interest to payoff/i.test(p.printed_content)) && d.title.includes("home"));
  const payoffPrinted = form1098WithPayoff?.pages.map((p) => p.printed_content).find((t) => /payoff/i.test(t)) ?? null;
  const payoffMatch = payoffPrinted?.match(/\(([^)]*payoff[^)]*)\)/i)?.[1]?.trim() ?? payoffPrinted;
  const payoffCallout: Callout | null =
    interestLine && payoffDoc && payoffValue && form1098WithPayoff && interestLine.sources.some((s) => s.ref === payoffValue.id)
      ? {
          id: "payoff-interest",
          title: "Duplicate risk: payoff interest counted inside the 1098 and again from the payoff statement",
          detail: `${form1098WithPayoff.title} (${form1098WithPayoff.id}) prints: "${payoffMatch ?? "box 1 includes interest paid at payoff"}". ${interestLine.key} lists both that Form 1098 box 1 and ${payoffDoc.title} (${payoffDoc.id}) interest ${displayExtractedValue(payoffValue)} among its sources, and the engine note adds them. This is an evidence conflict to resolve in the inspector; the workpaper does not change the line by itself.`,
          evidence: b.values([...b.packet.extracted_values.filter((e) => e.document_id === form1098WithPayoff.id && /box1/.test(e.field)).map((e) => e.id), payoffValue.id]),
          refs: b.refs([`doc:${form1098WithPayoff.id}#page1`, payoffValue.id]),
          docs: b.docs([form1098WithPayoff.id, payoffDoc.id]),
          actions: [
            { label: `Propose on ${interestLine.key}`, href: `${interestLine.href}#propose` },
            { label: `Open ${form1098WithPayoff.id} page 1`, href: `/evidence/${form1098WithPayoff.id}?page=1` },
          ],
        }
      : null;

  // Charitable gifts.
  const cash = schA.find((l) => l.rule === "R-CHARITY-CASH") ?? null;
  const cashDocs = b.docsCitedBy(cash?.sources.map((s) => s.ref) ?? []);
  const lowConf = cash ? cash.sources.map((s) => b.idx.extractedValues.get(s.ref)).find((e) => e && e.confidence < 0.7) : undefined;
  const lowDoc = lowConf ? b.idx.documents.get(lowConf.document_id) : undefined;
  const corroboration = lowDoc ? b.clientMentions(keywordOf(lowDoc.issuer)).filter((c) => c.kind !== "questionnaire") : [];
  const lowCallout: Callout | null =
    lowConf && lowDoc
      ? {
          id: "low-confidence-gift",
          title: `Low-confidence read on ${lowDoc.title}`,
          detail: `${lowConf.label} was read as ${displayExtractedValue(lowConf)} at confidence ${lowConf.confidence}. The page prints: "${lowDoc.pages[lowConf.page - 1]?.printed_content ?? ""}". ${corroboration.length ? corroboration.every((c) => c.available) ? "Client corroboration is in the file at the current replay clock." : `Client corroboration arrives ${corroboration.map((c) => c.at?.slice(0, 10)).filter(Boolean).join(", ")}, after the replay clock, so it cannot be cited yet.` : "No client corroboration is in the packet."}`,
          evidence: b.values([lowConf.id]),
          refs: b.refs([lowConf.id, ...b.findingsCiting([lowConf.id]).map((f) => `finding:${f.id}`)]),
          docs: b.docs([lowDoc.id]),
          actions: [
            { label: `Verify on ${cash!.key}`, href: `${cash!.href}#evidence` },
            { label: `Open ${lowDoc.id}`, href: `/evidence/${lowDoc.id}?page=${lowConf.page}` },
          ],
        }
      : null;
  const noncash = b.form("F8283");
  const noncashDocs = b.docsCitedBy(noncash.flatMap((l) => l.sources.map((s) => s.ref)));
  const vehicleLine = noncash.find((l) => /vehicle/i.test(l.key) || /VIN/i.test(l.label)) ?? null;
  const vehicleDoc = b.docsByType(["1098-C"])[0];
  const auction = vehicleDoc ? b.packet.extracted_values.find((e) => e.document_id === vehicleDoc.id && /proceeds/i.test(e.label)) : undefined;
  const vehicleQa = vehicleLine?.sources.find((s) => s.kind === "questionnaire");
  const vehicleCallout: Callout | null =
    vehicleLine && vehicleDoc && auction
      ? {
          id: "vehicle-gift",
          title: "Vehicle gift: donor estimate on the return versus the charity's auction proceeds",
          detail: `${vehicleLine.key} carries ${moneyText(numeric(vehicleLine.effective))}, sourced from the client's estimate${vehicleQa ? ` (${vehicleQa.ref})` : ""}. ${vehicleDoc.title} (${vehicleDoc.id}) reports ${auction.label} ${displayExtractedValue(auction)}. The Form 1098-C figure is printed evidence; the estimate is not. Resolve the difference in the inspector.`,
          evidence: b.values([auction.id]),
          refs: b.refs([auction.id, ...(vehicleQa ? [vehicleQa.ref] : [])]),
          docs: b.docs([vehicleDoc.id]),
          actions: [
            { label: `Propose on ${vehicleLine.key}`, href: `${vehicleLine.href}#propose` },
            { label: `Open ${vehicleDoc.id}`, href: `/evidence/${vehicleDoc.id}` },
          ],
        }
      : null;

  // Education.
  const f8863 = b.form("F8863");
  const eduDocs = b.docsCitedBy(f8863.flatMap((l) => l.sources.map((s) => s.ref)));

  // Child and dependent care: compare what the return says about each provider with what the statement prints.
  const f2441 = b.form("F2441");
  const careDocs = b.docsCitedBy(f2441.flatMap((l) => l.sources.map((s) => s.ref)));
  const careCallouts: Callout[] = [];
  for (const l of f2441.filter((x) => x.rule === "R-DEP-CARE-PROVIDER")) {
    const m = l.label.match(/Care provider: (.+?), tax ID ([\d-]+)/);
    if (!m) continue;
    const [, name, ein] = m;
    const docIds = b.docsCitedBy(l.sources.map((s) => s.ref));
    for (const id of docIds) {
      const doc = b.idx.documents.get(id);
      if (!doc) continue;
      const printed = doc.pages.map((p) => p.printed_content).join(" ");
      const einValue = b.packet.extracted_values.find((e) => e.document_id === id && e.value_type === "ein");
      if (!printed.includes(ein)) {
        const printedEin = printed.match(/Tax ID ([\d-]+)/i)?.[1] ?? "a different number";
        careCallouts.push({
          id: `ein-${l.key}`,
          title: `Provider tax ID on ${l.key} does not match what ${doc.id} prints`,
          detail: `${l.key} carries tax ID ${ein}${einValue ? ` (read from ${einValue.id} at confidence ${einValue.confidence})` : ""}; ${doc.title} prints ${printedEin}. A transposed digit on Form 2441 is a filing defect. Confirm against the page and propose a label change if the extraction is wrong.`,
          evidence: einValue ? b.values([einValue.id]) : [],
          refs: b.refs([`doc:${doc.id}#page1`, ...(einValue ? [einValue.id] : [])]),
          docs: b.docs([doc.id]),
          actions: [
            { label: `Open ${doc.id}`, href: `/evidence/${doc.id}?page=1` },
            { label: `Propose label on ${l.key}`, href: `${l.href}#propose` },
          ],
        });
      }
      if (!printed.includes(name)) {
        careCallouts.push({
          id: `name-${l.key}`,
          title: `Provider name on ${l.key} does not match what ${doc.id} prints`,
          detail: `${l.key} names "${name}"; ${doc.title} prints "${doc.issuer}". The name on Form 2441 should match the provider's statement.`,
          evidence: [],
          refs: b.refs([`doc:${doc.id}#page1`]),
          docs: b.docs([doc.id]),
          actions: [
            { label: `Open ${doc.id}`, href: `/evidence/${doc.id}?page=1` },
            { label: `Propose label on ${l.key}`, href: `${l.href}#propose` },
          ],
        });
      }
    }
  }

  const f8812 = b.form("F8812");
  const f8867 = b.line("F8867.status");
  const dueFinding = b.findingsByCode("DUE_DILIGENCE_REQUIRED")[0] ?? null;

  const view: DeductionsCreditsView = {
    ...b.header("deductions_and_credits"),
    salt: { lines: saltLines, params: saltParams, rules: saltRules, agi, capApplies },
    propertyTax: {
      line: propertyTax,
      docs: b.docs(taxDocs),
      sellerCredit:
        propertyTax && buyerClosing && sellerCredit
          ? {
              id: "seller-credit",
              title: "Seller credit for 2025 taxes printed on the purchase closing statement",
              detail: `${buyerClosing.title} (${buyerClosing.id}) prints ${sellerCredit.label} ${displayExtractedValue(sellerCredit)}. ${propertyTax.key} is sourced from the escrow disbursement on the Form 1098 and the county receipt; the closing statement is not among its sources. How the seller's share affects the deductible amount is a question for the inspector, not a figure changed here.`,
              evidence: b.values([sellerCredit.id]),
              refs: b.refs([sellerCredit.id]),
              docs: b.docs([buyerClosing.id]),
              actions: [
                { label: `Propose on ${propertyTax.key}`, href: `${propertyTax.href}#propose` },
                { label: `Open ${buyerClosing.id}`, href: `/evidence/${buyerClosing.id}` },
              ],
            }
          : null,
    },
    mortgage: { lines: mortgageLines, docs: b.docs(mortgageDocIds), payoff: payoffCallout, rentalInterest: b.line("SchE.12B") },
    charitable: {
      cash: { line: cash, docs: b.docs(cashDocs), lowConfidence: lowCallout, corroboration },
      noncash: { lines: noncash, total: schA.find((l) => /^SchA\.12$/.test(l.key)) ?? null, docs: b.docs(noncashDocs), vehicle: vehicleCallout },
      totals: schA.filter((l) => /^SchA\.(14)$/.test(l.key)),
    },
    education: {
      lines: f8863,
      docs: b.docs(eduDocs),
      params: [b.param("aotc_phaseout", "AOTC phase-out range (modified AGI)")],
      diagnostic: b.trail("AOTC_PHASED_OUT"),
      agi,
    },
    dependentCare: {
      lines: f2441,
      docs: b.docs(careDocs),
      params: [b.param("dep_care_limit_one", "Dependent care expense limit, one qualifying person"), b.param("dep_care_exclusion_max", "Dependent care benefit exclusion maximum")],
      callouts: careCallouts,
    },
    childTaxCredit: {
      lines: f8812,
      params: [b.param("ctc_per_child", "Child tax credit per child"), b.param("odc_per_dependent", "Credit per other dependent"), b.param("ctc_phaseout_start", "Phase-out start (modified AGI)")],
    },
    dueDiligence: {
      line: f8867,
      finding: dueFinding,
      trail: b.trail("DUE_DILIGENCE_REQUIRED"),
      judgments: b.judgmentsFor(f8867 ? [f8867.key] : []),
      href: f8867 ? `/review/judgments?subject=${encodeURIComponent(f8867.key)}` : "/review/judgments",
    },
    itemizedTotal: schA.find((l) => /^SchA\.17$/.test(l.key)) ?? null,
  };
  return redact.deep(view);
}

/** The lot id prefix (N, M, X, C, SCORP) that splits Form 8949 lines into broker groups. */
export function lotPrefix(key: string): string | null {
  const m = key.match(LOT_KEY);
  return m ? m[2] : null;
}
