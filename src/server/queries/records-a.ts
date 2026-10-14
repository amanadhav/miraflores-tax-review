/**
 * View models for the CPA record views: the return summary versus last year,
 * prior-year variance, the books-to-tax bridge, California, the payments
 * reconciliation and carryovers. Every query loads the workspace state once,
 * builds a plain object from the packet and the workpaper, and redacts it
 * before it can reach JSX. Nothing here recomputes a return: engine totals
 * are shown as the engine's, workpaper changes carry estimates, and unknown
 * values stay unknown.
 */
import { eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { areaForLine, areaLabel } from "@/domain/areas";
import { buildBridge, type BridgeItem } from "@/domain/bridge";
import { CATEGORY_LABELS, round2, type EffectCategory } from "@/domain/effects";
import type { EffectiveLine, LineStatus } from "@/domain/effective";
import { describeFormula, numeric } from "@/domain/formulas";
import { can, findActor } from "@/domain/policy";
import { makeRedactor } from "@/domain/redaction";
import { buildVariance } from "@/domain/variance";
import { availableAt } from "@/packet/availability";
import { indexPacket } from "@/packet/load";
import { resolvePointer, resolveRef } from "@/packet/refs";
import type { ExtractedValue, Jurisdiction, Packet, ReturnLine } from "@/packet/types";
import type { SessionContext } from "@/server/context";
import { loadWorkspaceState, type AdjustmentRow, type FindingRow, type VerificationRow, type WorkspaceState } from "@/server/state";
import { workpaperUsesOf, type WorkpaperUse } from "@/server/queries/trace";
import type { ActorView, LineValue, RefView } from "@/server/queries/review";

/* ------------------------------------------------------------------------ */
/* Shared view types.                                                         */
/* ------------------------------------------------------------------------ */

/** One return line of the active version with its effective value and status. */
export interface LineCell {
  key: string;
  form: string;
  line: string;
  label: string;
  jurisdiction: Jurisdiction;
  baseline: LineValue;
  effective: LineValue;
  status: LineStatus;
  statusReason: string;
  changedInputs: { key: string; label: string }[];
  rule: string;
  ruleText: string;
  note: string | null;
}

export interface LineCellWithSources extends LineCell {
  sources: RefView[];
}

export interface ChangeFlag {
  delta: number | null;
  /** Absolute percent change; null when the prior amount is zero or missing. */
  percent: number | null;
  flagged: boolean;
  reason: string;
}

export interface ViewActor extends ActorView {
  canVerify: boolean;
  canRaise: boolean;
}

export interface ViewMeta {
  version: string;
  computedAt: string;
  revision: number;
  asOf: string;
  actor: ViewActor;
  owners: ActorView[];
}

/** A verification shown beside the line it explains. */
export interface VerificationBrief {
  id: string;
  method: string;
  methodLabel: string;
  conclusion: string;
  note: string | null;
  actor: ActorView;
  revision: number;
  batchId: string | null;
  evidenceRefs: RefView[];
}

export interface FindingBrief {
  id: string;
  code: string | null;
  severity: string;
  title: string;
  detail: string;
  status: string;
  blocksFiling: boolean;
  area: string;
  areaLabel: string;
  refs: RefView[];
}

/* ------------------------------------------------------------------------ */
/* Summary.                                                                   */
/* ------------------------------------------------------------------------ */

export interface PriorValueView {
  key: string;
  label: string;
  value: number | null;
  display: LineValue;
  source: RefView | null;
  ref: string;
  note: string | null;
}

export interface HeadlineRow extends LineCell {
  prior: PriorValueView | null;
  change: ChangeFlag | null;
  explained: boolean;
}

export interface SummaryLine extends LineCell {
  formula: string;
  reproducible: boolean;
}

export interface FormGroup {
  form: string;
  label: string;
  jurisdiction: Jurisdiction;
  lines: SummaryLine[];
  /** Form 8949 lots left out of the table (box totals are kept). */
  lotsSkipped: number;
}

export interface AcceptedChangeView {
  id: string;
  targetRef: string;
  label: string;
  kind: string;
  priorValue: LineValue;
  proposedValue: LineValue;
  categoryLabel: string | null;
  effectFederal: number | null;
  effectCalifornia: number | null;
  balanceFederal: number | null;
  balanceCalifornia: number | null;
  effectStatus: string;
  effectBasis: string | null;
  limitations: string[];
  author: ActorView;
  decidedBy: ActorView | null;
  decidedRevision: number | null;
}

export interface SummaryView extends ViewMeta {
  trigger: string;
  engine: {
    federal: Record<string, number>;
    california: Record<string, number>;
    statement: string;
  };
  accepted: AcceptedChangeView[];
  estimates: {
    federal: number | null;
    california: number | null;
    balanceFederal: number | null;
    balanceCalifornia: number | null;
    complete: boolean;
    unknownCount: number;
    statement: string;
  };
  thresholds: { percent: number; amount: number };
  priorReturn: { document: RefView; preparedBy: string; filed: string; residency: string };
  federalHeadline: HeadlineRow[];
  californiaHeadline: HeadlineRow[];
  californiaNote: string;
  forms: FormGroup[];
}

/* ------------------------------------------------------------------------ */
/* Variance.                                                                  */
/* ------------------------------------------------------------------------ */

export interface VarianceRowView {
  key: string;
  form: string;
  line: string;
  label: string;
  jurisdiction: Jurisdiction;
  prior: number | null;
  priorRef: string;
  priorSource: RefView | null;
  current: number | null;
  delta: number | null;
  percent: number | null;
  flagged: boolean;
  reason: string;
  status: LineStatus | null;
  statusReason: string | null;
  explained: boolean;
  explanations: VerificationBrief[];
}

export interface VarianceView extends ViewMeta {
  thresholds: { percent: number; amount: number; statement: string };
  rows: VarianceRowView[];
  flaggedCount: number;
  explainedCount: number;
  onlyPrior: { key: string; label: string; prior: number | null; note: string; equivalent: LineCell | null }[];
  onlyCurrent: { key: string; label: string; current: number | null; status: LineStatus | null }[];
  method: string;
  priorDocument: RefView;
  zeroPriorNote: string;
  californiaNote: string;
}

/* ------------------------------------------------------------------------ */
/* Bridge.                                                                    */
/* ------------------------------------------------------------------------ */

export interface BridgeRowView {
  kind: BridgeItem["kind"];
  kindLabel: string;
  label: string;
  amount: number;
  booksAmount: number | null;
  taxAmount: number | null;
  line: LineCell | null;
  evidence: RefView[];
  explanation: string;
  status: LineStatus | null;
  statusReason: string | null;
}

export interface BridgeCorrection {
  id: string;
  targetRef: string;
  label: string;
  status: string;
  kind: string;
  priorValue: LineValue;
  proposedValue: LineValue;
  reason: string;
  effectFederal: number | null;
  effectCalifornia: number | null;
  effectStatus: string;
  author: ActorView;
  createdRevision: number;
  decidedBy: ActorView | null;
  decidedRevision: number | null;
}

export interface BridgeView extends ViewMeta {
  books: RefView;
  transactions: RefView;
  rows: BridgeRowView[];
  computedProfit: number;
  effectiveProfit: number | null;
  profitStatus: string;
  unexplained: number;
  agrees: boolean;
  agreement: string;
  corrections: {
    accepted: BridgeCorrection[];
    proposed: BridgeCorrection[];
    other: BridgeCorrection[];
    statement: string;
  };
}

/* ------------------------------------------------------------------------ */
/* California.                                                                */
/* ------------------------------------------------------------------------ */

export interface ResidencyPeriod {
  state: string;
  from: string;
  to: string;
  status: string;
  days: number;
  address: string | null;
}

export interface ScheduleCARow {
  line: string;
  label: string;
  cells: Record<string, LineCellWithSources | null>;
}

export interface W2View {
  document: RefView;
  employer: string;
  box1: ValueView | null;
  box2: ValueView | null;
  box16: ValueView | null;
  box17: ValueView | null;
  box12W: ValueView | null;
}

export interface ValueView {
  ref: RefView;
  value: unknown;
  display: string;
  label: string;
}

export interface QaView {
  id: string;
  ref: RefView;
  question: string;
  answer: string;
  answeredBy: string;
  answeredAt: string;
}

export interface CaliforniaView extends ViewMeta {
  residency: {
    periods: ResidencyPeriod[];
    caDays: number | null;
    yearDays: number | null;
    parameters: RefView[];
    statement: string;
  };
  scheduleCA: {
    columns: { id: string; label: string }[];
    rows: ScheduleCARow[];
    other: LineCellWithSources[];
    rules: { id: string; description: string }[];
  };
  f540nr: LineCellWithSources[];
  scheduleS: LineCellWithSources[];
  ftb3885a: LineCellWithSources[];
  ftb5805: LineCellWithSources[];
  wageSourcing: {
    engine: LineCellWithSources | null;
    w2: W2View[];
    paystub: { document: RefView; values: ValueView[]; printed: string } | null;
    questionnaire: QaView | null;
    withholding: LineCellWithSources | null;
    statements: string[];
  };
  amt: {
    line: LineCellWithSources | null;
    isoLine: LineCellWithSources | null;
    statement: string;
    findings: FindingBrief[];
  };
  depreciation: {
    rows: { assetId: string; description: string; difference: number; asset: RefView; line: LineCell | null }[];
    note: string;
  };
}

/* ------------------------------------------------------------------------ */
/* Payments.                                                                  */
/* ------------------------------------------------------------------------ */

export interface PaymentEntry {
  date: string;
  amount: number;
  refs: RefView[];
  label: string;
  /** Tax year the payer designated (FTB Web Pay), when printed. */
  year: string | null;
}

export interface TranscriptTransaction {
  date: string;
  code: string;
  description: string;
  amount: number | string;
}

export interface TranscriptSnapshot {
  ref: string;
  link: RefView;
  asOf: string;
  available: boolean;
  transactions: TranscriptTransaction[];
}

export type RecordMatchStatus = "agrees" | "differs" | "missing" | "credited_elsewhere" | "record_unavailable";

export interface PaymentMatch {
  engine: { date: string; amount: number };
  confirmation: { kind: "document" | "client_answer" | "none"; entry: PaymentEntry | null; refs: RefView[]; note: string };
  record: { date: string | null; amount: number | null; status: RecordMatchStatus; difference: number | null; note: string };
}

export interface VerifyTarget {
  subjectRef: string;
  subjectLabel: string;
  method: string;
  evidenceRefs: RefView[];
  existing: VerificationBrief[];
}

export interface JurisdictionPayments {
  line: LineCellWithSources | null;
  engineEntries: { date: string; amount: number }[];
  confirmations: PaymentEntry[];
  matches: PaymentMatch[];
  unmatchedRecords: { date: string; amount: number; note: string }[];
  totals: {
    engine: number | null;
    confirmed: number;
    recorded: number | null;
    difference: number | null;
    statement: string;
  };
  withholding: LineCellWithSources[];
  extension: LineCellWithSources[];
  penalty: LineCellWithSources[];
  verify: VerifyTarget;
  findingRefs: string[];
  area: string;
}

export interface PaymentsView extends ViewMeta {
  statement: string;
  federal: JurisdictionPayments & {
    transcripts: TranscriptSnapshot[];
    extensionOnTranscript: { status: RecordMatchStatus; note: string; transaction: TranscriptTransaction | null };
    clientAnswer: QaView | null;
  };
  california: JurisdictionPayments & {
    ftb: {
      ref: string;
      link: RefView;
      asOf: string | null;
      available: boolean;
      payments2025: { date: string; amount: number }[];
      payments2024AfterFiling: { date: string; amount: number; note: string | null }[];
    };
    creditedTo2024: number;
    otherYearConfirmations: PaymentEntry[];
  };
  penaltyMethod: {
    chosen: LineCellWithSources | null;
    regular: LineCellWithSources | null;
    annualized: LineCellWithSources | null;
    required: LineCellWithSources | null;
    whatIf: { id: string; description: string; basePenalty: number | null; alternativePenalty: number | null; penaltyChange: number | null } | null;
    statement: string;
  };
}

/* ------------------------------------------------------------------------ */
/* Carryovers.                                                                */
/* ------------------------------------------------------------------------ */

export interface CarryoverRow {
  key: string;
  label: string;
  into: number | null;
  intoRef: string | null;
  out: number | null;
  difference: number | null;
  usedBy: LineCell[];
  note: string | null;
}

export interface BasisField {
  label: string;
  value: string;
  unknown: boolean;
}

export interface BasisRow {
  period: string;
  fields: BasisField[];
  source: string;
  refs: RefView[];
}

export interface BasisGroup {
  id: string;
  title: string;
  pointer: string;
  rows: BasisRow[];
  engineLines: LineCellWithSources[];
  carryoverOut: { key: string; value: number | null }[];
  filledBy: { document: RefView; firstVersion: string | null; values: ValueView[]; note: string } | null;
  note: string;
}

export interface WorkpaperMatch extends WorkpaperUse {
  actor: ActorView;
}

export interface PriorItem {
  id: string;
  kind: "note" | "open_item";
  text: string;
  subjects: string[];
  documents: RefView[];
  lines: LineCell[];
  workpaper: WorkpaperMatch[];
  status: "addressed" | "in_progress" | "not_yet_addressed";
  summary: string;
}

export interface CarryoversView extends ViewMeta {
  federal: CarryoverRow[];
  california: CarryoverRow[];
  depreciationDifferences: { assetId: string; description: string; difference: number; asset: RefView }[];
  carryLines: LineCellWithSources[];
  basis: BasisGroup[];
  priorPreparer: { document: RefView; memo: string; items: PriorItem[] };
  sourcesNote: string;
  unknownNote: string;
}

/* ------------------------------------------------------------------------ */
/* Builder.                                                                   */
/* ------------------------------------------------------------------------ */

const FORM_LABELS: Record<string, string> = {
  F1040: "Form 1040",
  Sch1: "Schedule 1",
  Sch2: "Schedule 2",
  Sch3: "Schedule 3",
  SchA: "Schedule A",
  SchB: "Schedule B",
  SchC: "Schedule C",
  SchD: "Schedule D",
  SchE: "Schedule E",
  SchSE: "Schedule SE",
  F8949: "Form 8949 (box totals)",
  F4797: "Form 4797",
  "F4562-C": "Form 4562 (Schedule C assets)",
  "F4562-E": "Form 4562 (rental assets)",
  F8582: "Form 8582",
  F6251: "Form 6251",
  F8959: "Form 8959",
  F8960: "Form 8960",
  F8995: "Form 8995",
  F8995A: "Form 8995-A",
  F8812: "Schedule 8812",
  F8863: "Form 8863",
  F2441: "Form 2441",
  F8889: "Form 8889",
  F8606: "Form 8606",
  F8283: "Form 8283",
  F7203: "Form 7203",
  F8938: "Form 8938",
  F2210: "Form 2210",
  F8867: "Form 8867",
  SchCA540NR: "Schedule CA (540NR)",
  F540NR: "Form 540NR",
  ScheduleS: "Schedule S",
  FTB3885A: "FTB 3885A",
  FTB5805: "FTB 5805",
};

export function formLabel(form: string): string {
  return FORM_LABELS[form] ?? form;
}

interface PriorReturn {
  prepared_by?: string;
  filed?: string;
  residency?: string;
  lines: Record<string, unknown>;
  line_labels: Record<string, string>;
  line_sources?: Record<string, string>;
  notes?: Record<string, string>;
}

function actorView(packet: Packet, id: string | null | undefined): ActorView | null {
  if (!id) return null;
  const a = findActor(packet, id);
  if (a) return { id: a.id, name: a.name, role: a.role.replace(/_/g, " ") };
  if (id === "engine") return { id, name: "Engine", role: "pipeline diagnostic" };
  if (id === "system") return { id, name: "System", role: "system" };
  return { id, name: id, role: "unknown" };
}

function mustActor(packet: Packet, id: string): ActorView {
  return actorView(packet, id) ?? { id, name: id, role: "unknown" };
}

function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

function daysInclusive(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

function moneyText(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}

/** Firm variance rule, applied to one prior and current pair. Same words as the variance report. */
function changeFlag(prior: number | null, current: number | null, std: { percent: number; amount: number }): ChangeFlag {
  if (prior === null || current === null) return { delta: null, percent: null, flagged: false, reason: "Not numeric on one side." };
  const delta = round2(current - prior);
  const overAmount = Math.abs(delta) > std.amount;
  if (prior === 0) {
    return {
      delta,
      percent: null,
      flagged: overAmount,
      reason: overAmount ? `No prior-year amount; change of ${moneyText(Math.abs(delta))} is over ${std.amount}.` : "No prior-year amount; change is under the amount threshold.",
    };
  }
  const percent = round2((Math.abs(delta) / Math.abs(prior)) * 100);
  const flagged = overAmount && percent > std.percent;
  return {
    delta,
    percent,
    flagged,
    reason: flagged
      ? `Change of ${moneyText(Math.abs(delta))} (${percent}%) is over both thresholds.`
      : !overAmount
        ? `Change under ${std.amount}.`
        : `Change of ${percent}% is under ${std.percent}%.`,
  };
}

class Records {
  readonly packet: Packet;
  readonly state: WorkspaceState;
  readonly asOf: string;
  readonly version: string;
  readonly lines: Map<string, ReturnLine>;
  readonly ctx: SessionContext;

  constructor(ctx: SessionContext, state: WorkspaceState) {
    this.ctx = ctx;
    this.packet = ctx.packet.packet;
    this.state = state;
    this.asOf = isoOrNull(ctx.workspace.asOf) ?? ctx.workspace.asOf;
    this.version = state.version.version;
    this.lines = indexPacket(this.packet).linesByVersion.get(this.version)!;
  }

  meta(): ViewMeta {
    const actor = this.ctx.actor;
    return {
      version: this.version,
      computedAt: this.state.version.computed_at,
      revision: this.ctx.workspace.revision,
      asOf: this.asOf,
      actor: {
        id: actor.id,
        name: actor.name,
        role: actor.role.replace(/_/g, " "),
        canVerify: can(actor, "add_verification"),
        canRaise: can(actor, "raise_finding"),
      },
      owners: this.packet.firm.staff.map((s) => ({ id: s.id, name: s.name, role: s.role.replace(/_/g, " ") })),
    };
  }

  labelOf(key: string): string {
    return this.lines.get(key)?.label ?? key;
  }

  ruleText(rule: string): string {
    return this.packet.engine_reference.rules[rule] ?? "No description supplied in the engine reference.";
  }

  ref(ref: string): RefView {
    const r = resolveRef(this.packet, ref, { version: this.version });
    const at = availableAt(this.packet, ref);
    const atIso = at ? isoOrNull(at) : null;
    const available = atIso ? new Date(atIso).getTime() <= new Date(this.asOf).getTime() : true;
    return { ref, label: r.label, kind: r.parsed.kind, found: r.found, availableAt: atIso, available };
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
        return {
          reason: `Engine value no longer trustworthy: these inputs changed: ${list(keys)}; ${why}. The baseline number is shown but must be reviewed.`,
          changed: named(keys),
        };
      }
    }
  }

  cell(key: string): LineCell | null {
    const line = this.lines.get(key);
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
      rule: line.rule,
      ruleText: this.ruleText(line.rule),
      note: line.note ?? null,
    };
  }

  cellWithSources(key: string): LineCellWithSources | null {
    const c = this.cell(key);
    if (!c) return null;
    return { ...c, sources: (this.lines.get(key)?.sources ?? []).map((r) => this.ref(r)) };
  }

  cellsOfForm(form: string): LineCellWithSources[] {
    return this.state.version.lines.filter((l) => l.form === form).map((l) => this.cellWithSources(l.key)!);
  }

  cellsWithRule(rule: string): LineCellWithSources[] {
    return this.state.version.lines.filter((l) => l.rule === rule).map((l) => this.cellWithSources(l.key)!);
  }

  formula(key: string): { formula: string; reproducible: boolean } {
    const eff = this.state.effective.lines.get(key);
    if (!eff) return { formula: "opaque", reproducible: false };
    if (eff.formula.kind === "opaque") return { formula: "opaque", reproducible: false };
    return { formula: describeFormula(eff.formula, (k) => `${this.labelOf(k)} (${k})`), reproducible: true };
  }

  /** Verifications still in force (withdrawn ones are kept in history but no longer count). */
  liveVerifications(): VerificationRow[] {
    return this.state.verifications.filter((v) => v.withdrawnRevision === null);
  }

  verification(v: VerificationRow): VerificationBrief {
    return {
      id: v.id,
      method: v.method,
      methodLabel: v.method.replace(/_/g, " "),
      conclusion: v.conclusion,
      note: v.note,
      actor: mustActor(this.packet, v.actorId),
      revision: v.createdRevision,
      batchId: v.batchId,
      evidenceRefs: v.evidenceRefs.map((r) => this.ref(r)),
    };
  }

  finding(f: FindingRow): FindingBrief {
    return {
      id: f.id,
      code: f.code,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      status: f.status,
      blocksFiling: f.blocksFiling,
      area: f.area,
      areaLabel: areaLabel(f.area),
      refs: f.refs.map((r) => this.ref(r)),
    };
  }

  priorReturn(): PriorReturn {
    return this.packet.prior_years.return_2024 as PriorReturn;
  }

  priorValue(key: string, note: string | null = null): PriorValueView | null {
    const prior = this.priorReturn();
    if (!(key in prior.lines)) return null;
    const raw = prior.lines[key];
    const sourceId = prior.line_sources?.[key];
    return {
      key,
      label: prior.line_labels[key] ?? key,
      value: numeric(raw),
      display: (typeof raw === "number" || typeof raw === "string" || typeof raw === "boolean" || raw === null ? raw : String(raw)) as LineValue,
      source: sourceId ? this.ref(sourceId) : null,
      ref: `py:/return_2024/lines/${key}`,
      note,
    };
  }

  /** Extracted values of one document, by field name. */
  valuesOf(documentId: string): Map<string, ExtractedValue> {
    const out = new Map<string, ExtractedValue>();
    for (const ev of this.packet.extracted_values) if (ev.document_id === documentId) out.set(ev.field, ev);
    return out;
  }

  valueView(ev: ExtractedValue | undefined): ValueView | null {
    if (!ev) return null;
    const v = ev.value;
    let display: string;
    if (v === null || v === undefined) display = "blank";
    else if (ev.value_type === "money" && typeof v === "number") display = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    else if (ev.value_type === "percent" && typeof v === "number") display = `${v}`;
    else display = typeof v === "object" ? JSON.stringify(v) : String(v);
    return { ref: this.ref(ev.id), value: v, display, label: ev.label };
  }

  questionnaire(id: string): QaView | null {
    const q = indexPacket(this.packet).questionnaire.get(id);
    if (!q) return null;
    return { id: q.id, ref: this.ref(q.id), question: q.question, answer: q.answer, answeredBy: q.answered_by, answeredAt: q.answered_at };
  }

  adjustmentBrief(a: AdjustmentRow): BridgeCorrection {
    return {
      id: a.id,
      targetRef: a.targetRef,
      label: this.labelOf(a.targetRef),
      status: a.status,
      kind: a.kind,
      priorValue: a.priorValue as LineValue,
      proposedValue: a.proposedValue as LineValue,
      reason: a.reason,
      effectFederal: num(a.effectFederal),
      effectCalifornia: num(a.effectCalifornia),
      effectStatus: a.effectStatus,
      author: mustActor(this.packet, a.authorId),
      createdRevision: a.createdRevision,
      decidedBy: actorView(this.packet, a.decidedBy),
      decidedRevision: a.decidedRevision,
    };
  }
}

/* ------------------------------------------------------------------------ */
/* Summary.                                                                   */
/* ------------------------------------------------------------------------ */

const FEDERAL_HEADLINE = [
  "F1040.1a",
  "F1040.2b",
  "F1040.3b",
  "F1040.7",
  "F1040.8",
  "F1040.9",
  "F1040.10",
  "F1040.11",
  "F1040.12",
  "F1040.13",
  "F1040.15",
  "F1040.16",
  "F1040.22",
  "F1040.24",
  "F1040.25d",
  "F1040.26",
  "F1040.33",
  "F1040.37",
];

/** Prior-year lines that stand in for a 2025 line the 2024 return did not have. */
const FEDERAL_PRIOR_EQUIVALENT: Record<string, { key: string; compare: boolean; note: string }> = {
  "F1040.25d": { key: "F1040.25a", compare: true, note: "The 2024 return reports withholding on line 25a only (all from Forms W-2); it has no separate line 25d." },
  "F1040.37": { key: "F1040.34", compare: false, note: "The 2024 return had no amount owed: line 34 shows an overpayment, so the two lines are not compared." },
};

/** Form 540NR lines paired with the 2024 Form 540 line of the same meaning. */
const CALIFORNIA_HEADLINE: { key: string; prior: string; compare: boolean; note: string | null }[] = [
  { key: "F540NR.13", prior: "CA540.13", compare: true, note: null },
  { key: "F540NR.17", prior: "CA540.17", compare: true, note: null },
  { key: "F540NR.18", prior: "CA540.18", compare: true, note: "2024 used the California standard deduction; 2025 uses California itemized deductions." },
  { key: "F540NR.19", prior: "CA540.19", compare: true, note: null },
  { key: "F540NR.31", prior: "CA540.31", compare: true, note: null },
  { key: "F540NR.39", prior: "CA540.32", compare: true, note: "2024 line 32 is the full exemption credit; 2025 line 39 is prorated for the part-year period." },
  { key: "F540NR.64", prior: "CA540.64", compare: true, note: null },
  { key: "F540NR.71", prior: "CA540.71", compare: true, note: null },
  { key: "F540NR.72", prior: "CA540.72", compare: true, note: null },
  { key: "F540NR.97", prior: "CA540.111", compare: false, note: "2024 line 111 was an amount owed; 2025 line 97 is an overpayment. Not compared." },
];

export async function summaryView(ctx: SessionContext): Promise<SummaryView> {
  const state = await loadWorkspaceState(ctx.db, ctx);
  const b = new Records(ctx, state);
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const std = packet.firm.starter_standards.variance_review;
  const thresholds = { percent: std.flag_if_change_over_percent, amount: std.and_over_amount };
  const explainedKeys = new Set(b.liveVerifications().filter((v) => v.method === "agreed_to_prior_year").map((v) => v.subjectRef));
  const variance = buildVariance(packet, state.version, state.effective, explainedKeys);
  const compared = new Map(variance.compared.map((r) => [r.key, r]));

  const headline = (key: string, equivalent: { key: string; compare: boolean; note: string | null } | null): HeadlineRow | null => {
    const cell = b.cell(key);
    if (!cell) return null;
    const direct = compared.get(key);
    if (direct && !equivalent) {
      return {
        ...cell,
        prior: b.priorValue(key),
        change: { delta: direct.delta, percent: direct.percent, flagged: direct.flagged, reason: direct.reason },
        explained: direct.explained,
      };
    }
    const prior = equivalent ? b.priorValue(equivalent.key, equivalent.note) : b.priorValue(key);
    if (!prior) return { ...cell, prior: null, change: null, explained: explainedKeys.has(key) };
    const change = equivalent && !equivalent.compare ? null : changeFlag(prior.value, numeric(cell.effective), thresholds);
    return { ...cell, prior, change, explained: explainedKeys.has(key) };
  };

  const federalHeadline = FEDERAL_HEADLINE.map((k) => headline(k, FEDERAL_PRIOR_EQUIVALENT[k] ?? null)).filter((r): r is HeadlineRow => r !== null);
  const californiaHeadline = CALIFORNIA_HEADLINE.map((c) => headline(c.key, { key: c.prior, compare: c.compare, note: c.note })).filter((r): r is HeadlineRow => r !== null);

  const forms: FormGroup[] = [];
  for (const line of state.version.lines) {
    let group = forms.find((g) => g.form === line.form);
    if (!group) {
      group = { form: line.form, label: formLabel(line.form), jurisdiction: line.jurisdiction, lines: [], lotsSkipped: 0 };
      forms.push(group);
    }
    if (line.form === "F8949" && !line.key.endsWith(".total")) {
      group.lotsSkipped += 1;
      continue;
    }
    group.lines.push({ ...b.cell(line.key)!, ...b.formula(line.key) });
  }

  const accepted: AcceptedChangeView[] = state.accepted.map((a) => ({
    id: a.id,
    targetRef: a.targetRef,
    label: b.labelOf(a.targetRef),
    kind: a.kind,
    priorValue: a.priorValue as LineValue,
    proposedValue: a.proposedValue as LineValue,
    categoryLabel: a.category && a.category in CATEGORY_LABELS ? CATEGORY_LABELS[a.category as EffectCategory] : a.category,
    effectFederal: num(a.effectFederal),
    effectCalifornia: num(a.effectCalifornia),
    balanceFederal: num(a.balanceFederal),
    balanceCalifornia: num(a.balanceCalifornia),
    effectStatus: a.effectStatus,
    effectBasis: a.effectBasis,
    limitations: a.limitations,
    author: mustActor(packet, a.authorId),
    decidedBy: actorView(packet, a.decidedBy),
    decidedRevision: a.decidedRevision,
  }));
  const unknownCount = accepted.filter((a) => a.effectStatus === "unknown").length;
  const complete = unknownCount === 0;
  const sum = (pick: (a: AcceptedChangeView) => number | null) => (complete && accepted.length > 0 ? round2(accepted.reduce((s, a) => s + (pick(a) ?? 0), 0)) : null);
  const estimates: SummaryView["estimates"] = {
    federal: sum((a) => a.effectFederal),
    california: sum((a) => a.effectCalifornia),
    balanceFederal: sum((a) => a.balanceFederal),
    balanceCalifornia: sum((a) => a.balanceCalifornia),
    complete,
    unknownCount,
    statement:
      accepted.length === 0
        ? "No accepted changes yet: the engine's totals stand as the effective return."
        : complete
          ? "Sum of the estimated effects of the accepted changes at the version's per-dollar rates. It is an estimate, not a recomputed total, and the engine blocks above are not adjusted by it."
          : `${unknownCount} accepted change(s) have no estimable effect, so the estimates cannot be totaled. The engine blocks above are not adjusted.`,
  };

  const prior = b.priorReturn();
  const view: SummaryView = {
    ...b.meta(),
    trigger: state.version.trigger,
    engine: {
      federal: state.version.summary.federal,
      california: state.version.summary.california,
      statement: `These are the engine's ${state.version.version} totals exactly as supplied. They do not include any workpaper change; accepted changes are listed separately below with estimated effects, never as a recomputed total.`,
    },
    accepted,
    estimates,
    thresholds,
    priorReturn: {
      document: b.ref("D06"),
      preparedBy: prior.prepared_by ?? "not stated",
      filed: prior.filed ?? "not stated",
      residency: prior.residency ?? "not stated",
    },
    federalHeadline,
    californiaHeadline,
    californiaNote:
      "The 2024 return was a full-year California Form 540. For 2025 the household moved to Texas on 2025-07-15, so the engine prepared a part-year Form 540NR; line numbers are paired by meaning and the bases differ.",
    forms,
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* Variance.                                                                  */
/* ------------------------------------------------------------------------ */

const EXPLAIN_METHOD = "agreed_to_prior_year";

export async function varianceView(ctx: SessionContext): Promise<VarianceView> {
  const state = await loadWorkspaceState(ctx.db, ctx);
  const b = new Records(ctx, state);
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const live = b.liveVerifications().filter((v) => v.method === EXPLAIN_METHOD);
  const explainedKeys = new Set(live.map((v) => v.subjectRef));
  const report = buildVariance(packet, state.version, state.effective, explainedKeys);
  const prior = b.priorReturn();

  const rows: VarianceRowView[] = report.compared.map((r) => {
    const cell = b.cell(r.key);
    const sourceId = prior.line_sources?.[r.key];
    return {
      key: r.key,
      form: cell?.form ?? r.key.split(".")[0],
      line: cell?.line ?? "",
      label: r.label,
      jurisdiction: cell?.jurisdiction ?? "federal",
      prior: r.prior,
      priorRef: `py:/return_2024/lines/${r.key}`,
      priorSource: sourceId ? b.ref(sourceId) : null,
      current: r.current,
      delta: r.delta,
      percent: r.percent,
      flagged: r.flagged,
      reason: r.reason,
      status: cell?.status ?? null,
      statusReason: cell?.statusReason ?? null,
      explained: r.explained,
      explanations: live.filter((v) => v.subjectRef === r.key).map((v) => b.verification(v)),
    };
  });

  const onlyPrior = report.onlyPrior.map((r) => {
    const ca = r.key.match(/^CA540\.(.+)$/);
    const equivalentKey = ca ? `F540NR.${ca[1]}` : null;
    const equivalent = equivalentKey ? b.cell(equivalentKey) : null;
    return {
      key: r.key,
      label: r.label,
      prior: r.prior,
      note: ca
        ? equivalent
          ? `2024 Form 540 line; reported this year on Form 540NR line ${ca[1]} because of the part-year move.`
          : "2024 Form 540 line; the 2025 return is a part-year Form 540NR and has no line with this key."
        : `No line with this key in ${b.version}.`,
      equivalent,
    };
  });
  const onlyCurrent = report.onlyCurrent.map((r) => ({ ...r, status: b.cell(r.key)?.status ?? null }));

  const view: VarianceView = {
    ...b.meta(),
    thresholds: {
      percent: report.thresholdPercent,
      amount: report.thresholdAmount,
      statement: `Firm standard: a line is flagged when the change from 2024 is over ${report.thresholdPercent}% and over ${moneyText(report.thresholdAmount)}.`,
    },
    rows,
    flaggedCount: rows.filter((r) => r.flagged).length,
    explainedCount: rows.filter((r) => r.flagged && r.explained).length,
    onlyPrior,
    onlyCurrent,
    method: EXPLAIN_METHOD,
    priorDocument: b.ref("D06"),
    zeroPriorNote: "A zero or missing 2024 amount has no percentage: those lines are flagged on the amount threshold alone and show no percent.",
    californiaNote: "The CA540 keys from 2024 became F540NR keys this year because of the part-year move to Texas; they appear under 2024 only, paired with their Form 540NR line where one exists.",
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* Bridge.                                                                    */
/* ------------------------------------------------------------------------ */

const BRIDGE_KIND_LABEL: Record<BridgeItem["kind"], string> = {
  start: "Start",
  income: "Income",
  difference: "Difference",
  add_back: "Add-back",
  tax_only: "Tax-only deduction",
  result: "Result",
};

export async function bridgeView(ctx: SessionContext): Promise<BridgeView> {
  const state = await loadWorkspaceState(ctx.db, ctx);
  const b = new Records(ctx, state);
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const bridge = buildBridge(packet, state.version, state.effective);

  const rows: BridgeRowView[] = bridge.items.map((i) => {
    const line = i.lineKey ? b.cell(i.lineKey) : null;
    return {
      kind: i.kind,
      kindLabel: BRIDGE_KIND_LABEL[i.kind],
      label: i.label,
      amount: i.amount,
      booksAmount: i.booksAmount ?? null,
      taxAmount: i.taxAmount ?? null,
      line,
      evidence: i.evidenceRefs.map((r) => b.ref(r)),
      explanation: i.explanation,
      status: i.status ?? line?.status ?? null,
      statusReason: line?.statusReason ?? null,
    };
  });

  const schC = state.adjustments.filter((a) => a.targetRef.startsWith("SchC."));
  const accepted = schC.filter((a) => a.status === "accepted").map((a) => b.adjustmentBrief(a));
  const proposed = schC.filter((a) => a.status === "proposed").map((a) => b.adjustmentBrief(a));
  const other = schC.filter((a) => a.status !== "accepted" && a.status !== "proposed").map((a) => b.adjustmentBrief(a));

  const view: BridgeView = {
    ...b.meta(),
    books: b.ref(bridge.booksDocument),
    transactions: b.ref("D15"),
    rows,
    computedProfit: bridge.computedProfit,
    effectiveProfit: bridge.effectiveProfit,
    profitStatus: bridge.profitStatus,
    unexplained: bridge.unexplained,
    agrees: bridge.agrees,
    agreement: bridge.agrees
      ? `The bridge agrees: books net income reconciles to the effective Schedule C profit of ${bridge.effectiveProfit === null ? "unknown" : moneyText(bridge.effectiveProfit)} (${bridge.profitStatus}).`
      : `Unexplained difference of ${moneyText(bridge.unexplained)} between the bridge (${moneyText(bridge.computedProfit)}) and the effective Schedule C profit (${bridge.effectiveProfit === null ? "unknown" : moneyText(bridge.effectiveProfit)}, ${bridge.profitStatus}). It needs review before the area is signed.`,
    corrections: {
      accepted,
      proposed,
      other,
      statement:
        accepted.length === 0 && proposed.length === 0
          ? "No Schedule C corrections have been proposed: the bridge runs on the engine's baseline."
          : `${accepted.length} accepted Schedule C correction(s) move the return side of the bridge now; ${proposed.length} proposed correction(s) do not move it until accepted.`,
    },
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* California.                                                                */
/* ------------------------------------------------------------------------ */

const SCHEDULE_CA_COLUMNS = [
  { id: "A", label: "A: federal amounts" },
  { id: "B", label: "B: subtractions" },
  { id: "C", label: "C: additions" },
  { id: "D", label: "D: total using CA law" },
  { id: "E", label: "E: California amount" },
];

export async function californiaView(ctx: SessionContext): Promise<CaliforniaView> {
  const state = await loadWorkspaceState(ctx.db, ctx);
  const b = new Records(ctx, state);
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const params = packet.engine_reference.parameters;

  const periods: ResidencyPeriod[] = packet.household.residency.map((r) => {
    const address = packet.household.addresses.find((a) => a.from <= r.to && (a.to === null || a.to >= r.from));
    return { state: r.state, from: r.from, to: r.to, status: r.status, days: daysInclusive(r.from, r.to), address: address?.address ?? null };
  });
  const caDays = numeric(params.ca_resident_days);
  const yearDays = numeric(params.year_days);
  const caPeriod = periods.find((p) => p.state === "CA");

  const rows = new Map<string, ScheduleCARow>();
  const other: LineCellWithSources[] = [];
  for (const line of state.version.lines) {
    if (line.form !== "SchCA540NR") continue;
    const m = line.key.match(/^SchCA540NR\.(\d+)\.([A-E])$/);
    const cell = b.cellWithSources(line.key)!;
    if (!m) {
      other.push(cell);
      continue;
    }
    let row = rows.get(m[1]);
    if (!row) {
      row = { line: m[1], label: line.label.replace(/\s+-\s+.*$/, ""), cells: Object.fromEntries(SCHEDULE_CA_COLUMNS.map((c) => [c.id, null])) };
      rows.set(m[1], row);
    }
    row.cells[m[2]] = cell;
  }
  const rules = Object.entries(packet.engine_reference.rules)
    .filter(([id]) => id.startsWith("R-CA-"))
    .map(([id, description]) => ({ id, description }));

  const wageLine = b.cellWithSources("SchCA540NR.1.E");
  const w2Docs = [...new Set((b.lines.get("F1040.1a")?.sources ?? []).map((s) => indexPacket(packet).extractedValues.get(s)?.document_id).filter((d): d is string => Boolean(d)))];
  const w2: W2View[] = w2Docs.map((id) => {
    const values = b.valuesOf(id);
    return {
      document: b.ref(id),
      employer: String(values.get("employer_name")?.value ?? indexPacket(packet).documents.get(id)?.issuer ?? id),
      box1: b.valueView(values.get("box1")),
      box2: b.valueView(values.get("box2")),
      box16: b.valueView(values.get("box16")),
      box17: b.valueView(values.get("box17")),
      box12W: b.valueView(values.get("box12_W")),
    };
  });
  const paystubDoc = indexPacket(packet).documents.get("D73");
  const paystub = paystubDoc
    ? {
        document: b.ref("D73"),
        values: packet.extracted_values.filter((e) => e.document_id === "D73").map((e) => b.valueView(e)!),
        printed: paystubDoc.pages[0]?.printed_content ?? "",
      }
    : null;

  const amtLine = b.cellWithSources("F540NR.61");
  const amtFindings = state.findings.filter((f) => f.code === "CA_AMT_NOT_COMPUTED" || f.refs.includes("F540NR.61") || f.refs.includes("F6251.2i")).map((f) => b.finding(f));
  const caOut = (state.version.carryovers_out.california as { depreciation_basis_differences?: Record<string, number> } | undefined) ?? {};
  const depreciation = Object.entries(caOut.depreciation_basis_differences ?? {}).map(([assetId, difference]) => ({
    assetId,
    description: state.version.assets.find((a) => a.asset_id === assetId)?.description ?? assetId,
    difference,
    asset: b.ref(`asset:${assetId}`),
    line: b.cell(`FTB3885A.${assetId}`),
  }));

  const view: CaliforniaView = {
    ...b.meta(),
    residency: {
      periods,
      caDays,
      yearDays,
      parameters: [b.ref("ref:param.ca_resident_days"), b.ref("ref:param.year_days")],
      statement:
        caPeriod && caDays !== null && yearDays !== null
          ? `California resident ${caPeriod.from} through ${caPeriod.to} (${caPeriod.days} days by the household record); the engine prorates by ${caDays} of ${yearDays} days (engine parameters ca_resident_days and year_days). Texas resident from ${periods.find((p) => p.state === "TX")?.from ?? "the move"}.`
          : "Residency periods come from the household record; the engine's day counts are the parameters shown.",
    },
    scheduleCA: {
      columns: SCHEDULE_CA_COLUMNS,
      rows: [...rows.values()].sort((x, y) => Number(x.line) - Number(y.line)),
      other,
      rules,
    },
    f540nr: b.cellsOfForm("F540NR"),
    scheduleS: b.cellsOfForm("ScheduleS"),
    ftb3885a: b.cellsOfForm("FTB3885A"),
    ftb5805: b.cellsOfForm("FTB5805"),
    wageSourcing: {
      engine: wageLine,
      w2,
      paystub,
      questionnaire: b.questionnaire("qa-45"),
      withholding: b.cellWithSources("F540NR.71"),
      statements: [
        "The engine's California-source wages (Schedule CA line 1, column E) come from Form W-2 box 16 of both employers, so the whole year of Halvorsen wages is treated as California-source.",
        "The Halvorsen paystub (D73) prints California taxable wages through 2025-07-15, the day before the move, and the client says the new employer kept withholding California tax until September by mistake.",
        "Withholding stays separate from income sourcing: W-2 box 17 amounts flow to Form 540NR line 71 whatever the sourcing, and any over-withholding comes back through the return. It does not make the wages California-source.",
        "Allocating the Halvorsen wages between the California period and the Texas period is a judgment item for the reviewer, not an automatic correction: record it as a judgment or propose an adjustment with the paystub as evidence.",
      ],
    },
    amt: {
      line: amtLine,
      isoLine: b.cellWithSources("F6251.2i"),
      statement:
        "Form 540NR line 61 shows 0 only because the engine does not compute California AMT (rule R-CA-AMT-NOT-COMPUTED). Treat it as not computed, review required: nothing in the file checks the amount, so the 0 must not be read as a checked result. The incentive stock option exercise on Form 6251 line 2i is the item to allocate to California.",
      findings: amtFindings,
    },
    depreciation: {
      rows: depreciation,
      note: "Remaining California basis differences from the engine's carryovers_out: California did not allow the federal special depreciation, so these assets keep a California basis to depreciate on FTB 3885A in later years.",
    },
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* Payments.                                                                  */
/* ------------------------------------------------------------------------ */

interface TranscriptRecord {
  as_of: string;
  transactions: TranscriptTransaction[];
}

interface FtbRecord {
  as_of?: string;
  tax_year_2025_payments?: { date: string; amount: number }[];
  tax_year_2024_payments_after_filing?: { date: string; amount: number; note?: string }[];
}

/** The engine's own list of the payments it counted, from the line note ("2025-04-15 3,000.00; ..."). */
function parseNoteEntries(note: string | null | undefined): { date: string; amount: number }[] {
  if (!note) return [];
  const out: { date: string; amount: number }[] = [];
  for (const m of note.matchAll(/(\d{4}-\d{2}-\d{2})\s+([\d,]+(?:\.\d+)?)/g)) out.push({ date: m[1], amount: Number(m[2].replace(/,/g, "")) });
  return out;
}

function daysApart(a: string, b: string): number {
  return Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000;
}

/** Group a payment confirmation's values by their field prefix (q1_amount + q1_date, pay3_amount + pay3_date + pay3_year). */
function confirmationEntries(b: Records, documentId: string): PaymentEntry[] {
  const groups = new Map<string, ExtractedValue[]>();
  for (const ev of b.packet.extracted_values) {
    if (ev.document_id !== documentId) continue;
    const prefix = ev.field.replace(/_(amount|date|year)$/, "");
    const list = groups.get(prefix) ?? [];
    list.push(ev);
    groups.set(prefix, list);
  }
  const out: PaymentEntry[] = [];
  for (const [prefix, evs] of groups) {
    const amount = evs.find((e) => e.field.endsWith("_amount"));
    const date = evs.find((e) => e.field.endsWith("_date"));
    const year = evs.find((e) => e.field.endsWith("_year"));
    const n = numeric(amount?.value);
    if (!amount || !date || n === null) continue;
    out.push({
      date: String(date.value),
      amount: n,
      refs: evs.map((e) => b.ref(e.id)),
      label: `${amount.label} (${prefix})`,
      year: year ? String(year.value) : null,
    });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

function matchPayments(
  engineEntries: { date: string; amount: number }[],
  confirmations: PaymentEntry[],
  records: { date: string; amount: number; elsewhere?: string | null }[],
  recordAvailable: boolean,
  clientAnswer: QaView | null,
): { matches: PaymentMatch[]; unmatched: { date: string; amount: number; note: string }[] } {
  const usedRecords = new Set<number>();
  const matches: PaymentMatch[] = engineEntries.map((e) => {
    const conf = confirmations.find((c) => c.date === e.date) ?? confirmations.find((c) => daysApart(c.date, e.date) <= 3 && c.amount === e.amount) ?? null;
    const confirmation: PaymentMatch["confirmation"] = conf
      ? {
          kind: "document",
          entry: conf,
          refs: conf.refs,
          note: conf.amount === e.amount ? `Confirmed ${moneyText(conf.amount)} on ${conf.date}${conf.year ? `, designated tax year ${conf.year}` : ""}.` : `Confirmation shows ${moneyText(conf.amount)} on ${conf.date}, not ${moneyText(e.amount)}.`,
        }
      : clientAnswer
        ? { kind: "client_answer", entry: null, refs: [clientAnswer.ref], note: `No payment confirmation in the file; the engine relied on the client's answer: "${clientAnswer.answer}"` }
        : { kind: "none", entry: null, refs: [], note: "No payment confirmation in the file." };
    let record: PaymentMatch["record"];
    if (!recordAvailable) {
      record = { date: null, amount: null, status: "record_unavailable", difference: null, note: "The agency record is not available at the replay clock." };
    } else {
      let best = -1;
      let bestDistance = Infinity;
      records.forEach((r, i) => {
        if (usedRecords.has(i)) return;
        const d = daysApart(r.date, e.date);
        if (d <= 7 && d < bestDistance) {
          best = i;
          bestDistance = d;
        }
      });
      if (best < 0) {
        record = { date: null, amount: null, status: "missing", difference: e.amount, note: `No agency payment within a week of ${e.date}.` };
      } else {
        usedRecords.add(best);
        const r = records[best];
        if (r.elsewhere) {
          record = { date: r.date, amount: r.amount, status: "credited_elsewhere", difference: e.amount, note: r.elsewhere };
        } else if (r.amount === e.amount) {
          record = { date: r.date, amount: r.amount, status: "agrees", difference: 0, note: `Agency shows ${moneyText(r.amount)} on ${r.date}.` };
        } else {
          record = { date: r.date, amount: r.amount, status: "differs", difference: round2(e.amount - r.amount), note: `Agency shows ${moneyText(r.amount)} on ${r.date}; the return counts ${moneyText(e.amount)}, a difference of ${moneyText(Math.abs(e.amount - r.amount))}.` };
        }
      }
    }
    return { engine: e, confirmation, record };
  });
  const unmatched = recordAvailable
    ? records.filter((_, i) => !usedRecords.has(i)).map((r) => ({ date: r.date, amount: r.amount, note: r.elsewhere ?? "On the agency record but not counted on the return." }))
    : [];
  return { matches, unmatched };
}

export async function paymentsView(ctx: SessionContext): Promise<PaymentsView> {
  const state = await loadWorkspaceState(ctx.db, ctx);
  const b = new Records(ctx, state);
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const verify = (subjectRef: string, evidence: string[]): VerifyTarget => ({
    subjectRef,
    subjectLabel: b.labelOf(subjectRef),
    method: "agreed_to_third_party_record",
    evidenceRefs: evidence.map((r) => b.ref(r)),
    existing: b.liveVerifications().filter((v) => v.subjectRef === subjectRef).map((v) => b.verification(v)),
  });

  /* Federal. */
  const snapshots = ((packet.tax_agency_records.irs_account_transcript_2025 as TranscriptRecord[] | undefined) ?? []).map((s, i) => {
    const ref = `agency:/irs_account_transcript_2025/${i}`;
    const link = b.ref(ref);
    return { ref, link, asOf: s.as_of, available: link.available, transactions: link.available ? s.transactions : [] };
  });
  const latest = [...snapshots].reverse().find((s) => s.available) ?? null;
  const federalLine = b.cellWithSources("F1040.26");
  const federalEntries = parseNoteEntries(federalLine?.note);
  const eftps = confirmationEntries(b, "D67");
  const clientAnswer = b.questionnaire("qa-41");
  const estimated = (latest?.transactions ?? []).filter((x) => x.code === "670" && /estimated/i.test(x.description) && typeof x.amount === "number").map((x) => ({ date: x.date, amount: x.amount as number }));
  const fed = matchPayments(federalEntries, eftps, estimated, latest !== null, clientAnswer);
  const fedEngineTotal = numeric(federalLine?.effective);
  const fedRecorded = latest ? round2(estimated.reduce((s, x) => s + x.amount, 0)) : null;
  const fedDifference = fedEngineTotal !== null && fedRecorded !== null ? round2(fedEngineTotal - fedRecorded) : null;
  const extensionTxn = (latest?.transactions ?? []).find((x) => x.code === "670" && /extension/i.test(x.description)) ?? null;
  const extensionLine = b.cellWithSources("Sch3.10");
  const extensionAmount = numeric(extensionLine?.effective);
  const extensionOnTranscript: PaymentsView["federal"]["extensionOnTranscript"] = !latest
    ? { status: "record_unavailable", note: "No IRS transcript is available at the replay clock.", transaction: null }
    : !extensionTxn
      ? { status: "missing", note: `The extension payment is not on the ${latest.asOf} transcript snapshot; a later snapshot may show it.`, transaction: null }
      : typeof extensionTxn.amount === "number" && extensionAmount !== null && extensionTxn.amount === extensionAmount
        ? { status: "agrees", note: `The ${latest.asOf} transcript shows ${moneyText(extensionTxn.amount)} paid with the extension on ${extensionTxn.date}.`, transaction: extensionTxn }
        : { status: "differs", note: `The ${latest.asOf} transcript shows ${String(extensionTxn.amount)} on ${extensionTxn.date}; the return carries ${extensionAmount === null ? "no amount" : moneyText(extensionAmount)}.`, transaction: extensionTxn };

  /* California. */
  const ftbRecord = (packet.tax_agency_records.ftb_account as FtbRecord | undefined) ?? {};
  const ftbLink = b.ref("agency:/ftb_account");
  const ftbAvailable = ftbLink.available;
  const caLine = b.cellWithSources("F540NR.72");
  const caEntries = parseNoteEntries(caLine?.note);
  const webPay = confirmationEntries(b, "D68");
  const ca2025 = ftbRecord.tax_year_2025_payments ?? [];
  const ca2024 = ftbRecord.tax_year_2024_payments_after_filing ?? [];
  const caRecords = [
    ...ca2025.map((p) => ({ date: p.date, amount: p.amount, elsewhere: null as string | null })),
    ...ca2024.map((p) => ({ date: p.date, amount: p.amount, elsewhere: p.note ? `FTB credited this payment to tax year 2024: ${p.note}.` : "FTB credited this payment to tax year 2024, not 2025." })),
  ];
  const cal = matchPayments(caEntries, webPay.filter((w) => w.year === "2025" || w.year === null || caEntries.some((e) => e.date === w.date)), caRecords, ftbAvailable, null);
  const caEngineTotal = numeric(caLine?.effective);
  const caRecorded = ftbAvailable ? round2(ca2025.reduce((s, p) => s + p.amount, 0)) : null;
  const caDifference = caEngineTotal !== null && caRecorded !== null ? round2(caEngineTotal - caRecorded) : null;
  const creditedTo2024 = ftbAvailable ? round2(cal.matches.filter((m) => m.record.status === "credited_elsewhere").reduce((s, m) => s + (m.record.amount ?? 0), 0)) : 0;
  const otherYearConfirmations = webPay.filter((w) => w.year !== null && w.year !== "2025" && !caEntries.some((e) => e.date === w.date));

  /* Penalty method. */
  const alt = packet.what_if.alternatives.find((a) => a.id === "penalty_annualized") ?? null;
  const chosen = b.cellWithSources("F1040.38");
  const regular = b.cellWithSources("F2210.19");
  const annualized = b.cellWithSources("F2210.AI");
  const whatIf = alt
    ? {
        id: alt.id,
        description: alt.description,
        basePenalty: numeric(alt.federal.base.penalty),
        alternativePenalty: numeric(alt.federal.alternative.penalty),
        penaltyChange: numeric(alt.federal.penalty_change),
      }
    : null;

  const view: PaymentsView = {
    ...b.meta(),
    statement:
      "Payments change the balance due, not the tax. A payment the agency did not receive, or credited to another year, leaves total tax unchanged and raises the balance due one for one; the underpayment penalty may move with it.",
    federal: {
      line: federalLine,
      engineEntries: federalEntries,
      confirmations: eftps,
      matches: fed.matches,
      unmatchedRecords: fed.unmatched,
      totals: {
        engine: fedEngineTotal,
        confirmed: round2(eftps.reduce((s, e) => s + e.amount, 0)),
        recorded: fedRecorded,
        difference: fedDifference,
        statement:
          fedRecorded === null
            ? "No IRS transcript snapshot is available at the replay clock, so the return's payments cannot be agreed to the IRS yet."
            : fedDifference === 0
              ? `The return's ${moneyText(fedEngineTotal ?? 0)} of estimated payments agrees with the ${latest?.asOf} IRS transcript.`
              : `The return counts ${moneyText(fedEngineTotal ?? 0)} of 2025 estimated payments; the ${latest?.asOf} IRS transcript shows ${moneyText(fedRecorded)}. The difference of ${moneyText(Math.abs(fedDifference ?? 0))} ${fedDifference !== null && fedDifference > 0 ? "is not on the transcript" : "is on the transcript but not on the return"}.`,
      },
      withholding: ["F1040.25a", "F1040.25d"].map((k) => b.cellWithSources(k)).filter((c): c is LineCellWithSources => c !== null),
      extension: b.cellsWithRule("R-EXTENSION-PAYMENT").filter((c) => c.jurisdiction === "federal"),
      penalty: ["F2210.8", "F2210.19", "F2210.AI", "F1040.38"].map((k) => b.cellWithSources(k)).filter((c): c is LineCellWithSources => c !== null),
      verify: verify("F1040.26", ["agency:/irs_account_transcript_2025/0", "D67"]),
      findingRefs: ["F1040.26", "agency:/irs_account_transcript_2025/0", "D67", "qa-41"],
      area: areaForLine("F1040.26", "F1040"),
      transcripts: snapshots,
      extensionOnTranscript,
      clientAnswer,
    },
    california: {
      line: caLine,
      engineEntries: caEntries,
      confirmations: webPay,
      matches: cal.matches,
      unmatchedRecords: cal.unmatched,
      totals: {
        engine: caEngineTotal,
        confirmed: round2(webPay.filter((w) => w.year === "2025").reduce((s, e) => s + e.amount, 0)),
        recorded: caRecorded,
        difference: caDifference,
        statement:
          caRecorded === null
            ? "The FTB account record is not available at the replay clock."
            : caDifference === 0
              ? `The return's ${moneyText(caEngineTotal ?? 0)} of California estimated payments agrees with the FTB account.`
              : `The return counts ${moneyText(caEngineTotal ?? 0)} of 2025 California estimated payments; the FTB account holds ${moneyText(caRecorded)} for 2025. The difference of ${moneyText(Math.abs(caDifference ?? 0))} is the payment the FTB credited to tax year 2024 (${moneyText(creditedTo2024)}), as the Web Pay confirmation itself designates.`,
      },
      withholding: ["F540NR.71"].map((k) => b.cellWithSources(k)).filter((c): c is LineCellWithSources => c !== null),
      extension: b.cellsWithRule("R-EXTENSION-PAYMENT").filter((c) => c.jurisdiction === "california"),
      penalty: b.cellsOfForm("FTB5805"),
      verify: verify("F540NR.72", ["agency:/ftb_account", "D68"]),
      findingRefs: ["F540NR.72", "agency:/ftb_account", "D68"],
      area: areaForLine("F540NR.72", "F540NR"),
      ftb: {
        ref: "agency:/ftb_account",
        link: ftbLink,
        asOf: ftbRecord.as_of ?? null,
        available: ftbAvailable,
        payments2025: ftbAvailable ? ca2025 : [],
        payments2024AfterFiling: ftbAvailable ? ca2024.map((p) => ({ date: p.date, amount: p.amount, note: p.note ?? null })) : [],
      },
      creditedTo2024,
      otherYearConfirmations,
    },
    penaltyMethod: {
      chosen,
      regular,
      annualized,
      required: b.cellWithSources("F2210.8"),
      whatIf,
      statement: whatIf
        ? `The engine's Form 1040 line 38 uses rule R-2210-METHOD-CHOICE (default regular). The what-if "${whatIf.description}" gives a federal penalty of ${whatIf.alternativePenalty === null ? "unknown" : moneyText(whatIf.alternativePenalty)} against ${whatIf.basePenalty === null ? "unknown" : moneyText(whatIf.basePenalty)} under the regular method (change ${whatIf.penaltyChange === null ? "unknown" : moneyText(whatIf.penaltyChange)}). California FTB 5805 is computed under the regular method only.`
        : "The engine's Form 1040 line 38 uses rule R-2210-METHOD-CHOICE (default regular); no annualized what-if is in the packet.",
    },
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* Carryovers.                                                                */
/* ------------------------------------------------------------------------ */

const CARRYOVER_LABELS: Record<string, string> = {
  capital_loss_short: "Short-term capital loss",
  capital_loss_long: "Long-term capital loss",
  capital_loss: "Capital loss (combined)",
  passive_1450_fremont: "Passive loss, 1450 Fremont Way",
  passive_1200_barton_hills: "Passive loss, 1200 Barton Hills Dr 4C",
  passive: "Passive loss (combined)",
  section_1231_losses: "Section 1231 losses",
  charitable: "Charitable contributions",
  amt_credit: "Minimum tax credit",
  minimum_tax_credit_from_2025_amt: "Minimum tax credit from 2025 AMT",
  nol: "Net operating loss",
  foreign_tax_credit: "Foreign tax credit",
  qbi_loss: "QBI loss",
  section_179: "Section 179 carryover",
  ira_nondeductible_basis_ngozi: "IRA nondeductible basis (Ngozi)",
  scorp_stock_basis_end: "S corporation stock basis, end of year",
  ridgeline_capital_account_end: "Ridgeline capital account, end of year",
  sep_contribution_not_deductible_for_2025: "SEP contribution not deductible for 2025",
};

/** Carryover keys the engine reports under a different name from the 2024 record. */
const CARRYOVER_ALIAS: Record<string, string> = { amt_credit: "minimum_tax_credit_from_2025_amt" };

function carryLabel(key: string): string {
  return CARRYOVER_LABELS[key] ?? key.replace(/_/g, " ");
}

function carryoverRows(b: Records, into: Record<string, unknown>, out: Record<string, unknown>, pointerBase: string, usedBy: Map<string, LineCell[]>): CarryoverRow[] {
  const rows: CarryoverRow[] = [];
  const outUsed = new Set<string>();
  for (const [key, raw] of Object.entries(into)) {
    if (typeof raw === "object" && raw !== null) continue;
    if (key === "note") continue;
    const outKey = key in out ? key : CARRYOVER_ALIAS[key] && CARRYOVER_ALIAS[key] in out ? CARRYOVER_ALIAS[key] : null;
    if (outKey) outUsed.add(outKey);
    const intoValue = numeric(raw);
    const outValue = outKey ? numeric(out[outKey]) : null;
    const pointer = `${pointerBase}/${key}`;
    rows.push({
      key,
      label: carryLabel(key),
      into: intoValue,
      intoRef: pointer,
      out: outValue,
      difference: intoValue !== null && outValue !== null ? round2(outValue - intoValue) : null,
      usedBy: usedBy.get(pointer) ?? [],
      note: outKey === null ? `The ${b.version} engine output has no carryover with this name.` : outKey !== key ? `Reported by the engine as ${outKey}.` : null,
    });
  }
  for (const [key, raw] of Object.entries(out)) {
    if (outUsed.has(key) || (typeof raw === "object" && raw !== null)) continue;
    rows.push({
      key,
      label: carryLabel(key),
      into: null,
      intoRef: null,
      out: numeric(raw),
      difference: null,
      usedBy: [],
      note: "No 2024 carryover with this name; it starts this year.",
    });
  }
  return rows;
}

interface BasisSpec {
  id: string;
  title: string;
  pointer: string;
  periodKey: "year" | "event";
  engineKeys: string[];
  carryoverOutKeys: string[];
  fillDocument: string | null;
  note: string;
}

const BASIS_SPECS: BasisSpec[] = [
  {
    id: "scorp",
    title: "S corporation stock basis: Lindqvist Family Woodworks",
    pointer: "/basis_records/scorp_lindqvist_family_woodworks",
    periodKey: "year",
    engineKeys: ["F7203.1", "F7203.5", "F7203.6", "F7203.15", "F7203.excess"],
    carryoverOutKeys: ["scorp_stock_basis_end"],
    fillDocument: "D40",
    note: "The prior file had no 2023 K-1, so the 2023 and 2024 ending basis were unknown. The 2023 K-1 (D40) arrived later and the engine's Form 7203 rolls the basis forward from it; the prior records themselves still show the gap.",
  },
  {
    id: "partnership",
    title: "Partnership capital: Ridgeline Real Estate Fund III",
    pointer: "/basis_records/partnership_ridgeline",
    periodKey: "year",
    engineKeys: [],
    carryoverOutKeys: ["ridgeline_capital_account_end"],
    fillDocument: null,
    note: "Outside basis was never computed by the prior preparer and nothing in the file computes it now. The engine carries the capital account, which is not outside basis. Unknown stays unknown.",
  },
  {
    id: "ira",
    title: "IRA nondeductible basis: Ngozi",
    pointer: "/basis_records/ira_nondeductible_basis_ngozi",
    periodKey: "year",
    engineKeys: ["F8606.2", "F8606.14"],
    carryoverOutKeys: ["ira_nondeductible_basis_ngozi"],
    fillDocument: null,
    note: "2024 Form 8606 line 14 carries into Form 8606 line 2 for 2025; after the conversion the engine carries no basis to 2026.",
  },
  {
    id: "home",
    title: "Home cost: 7709 Barton Ridge Dr",
    pointer: "/basis_records/home_7709_barton_ridge",
    periodKey: "event",
    engineKeys: [],
    carryoverOutKeys: [],
    fillDocument: null,
    note: "Purchase price from the buyer closing statement; no return line uses it this year.",
  },
];

function basisFieldLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function basisGroup(b: Records, spec: BasisSpec, outFederal: Record<string, unknown>): BasisGroup {
  const r = resolvePointer(b.packet.prior_years, spec.pointer);
  const records = (r.found && Array.isArray(r.value) ? (r.value as Record<string, unknown>[]) : []) ?? [];
  const rows: BasisRow[] = records.map((rec, i) => {
    const fields: BasisField[] = [];
    for (const [k, v] of Object.entries(rec)) {
      if (k === spec.periodKey || k === "source") continue;
      const unknown = v === null || v === undefined;
      fields.push({
        label: basisFieldLabel(k),
        value: unknown ? "unknown" : typeof v === "number" ? moneyText(v) : String(v),
        unknown,
      });
    }
    const source = String(rec.source ?? "not stated");
    const docRefs = [...source.matchAll(/\bD\d{2}\b/g)].map((m) => b.ref(m[0]));
    return { period: String(rec[spec.periodKey] ?? i), fields, source, refs: [b.ref(`py:${spec.pointer}/${i}`), ...docRefs] };
  });
  let filledBy: BasisGroup["filledBy"] = null;
  if (spec.fillDocument) {
    const doc = indexPacket(b.packet).documents.get(spec.fillDocument);
    if (doc) {
      const firstVersion = b.packet.return_versions.find((v) => v.documents_used.includes(spec.fillDocument!))?.version ?? null;
      filledBy = {
        document: b.ref(spec.fillDocument),
        firstVersion,
        values: b.packet.extracted_values.filter((e) => e.document_id === spec.fillDocument).map((e) => b.valueView(e)!),
        note: firstVersion
          ? `${doc.title} received ${doc.received_at.slice(0, 10)}; first used by the engine in ${firstVersion}.`
          : `${doc.title} received ${doc.received_at.slice(0, 10)}; not used by any engine version.`,
      };
    }
  }
  return {
    id: spec.id,
    title: spec.title,
    pointer: `py:${spec.pointer}`,
    rows,
    engineLines: spec.engineKeys.map((k) => b.cellWithSources(k)).filter((c): c is LineCellWithSources => c !== null),
    carryoverOut: spec.carryoverOutKeys.filter((k) => k in outFederal).map((k) => ({ key: k, value: numeric(outFederal[k]) })),
    filledBy,
    note: spec.note,
  };
}

interface PriorItemSpec {
  test: RegExp;
  subjects: string[];
  documents: string[];
  linePrefixes: string[];
  keywords: RegExp;
}

/** What each prior-preparer topic is about, so workpaper records can be paired with it. */
const PRIOR_ITEM_SPECS: PriorItemSpec[] = [
  {
    test: /woodworks|s corp|stock basis|2023 k-1/i,
    subjects: ["D07", "D40", "D39", "Form 7203", "S corporation basis records"],
    documents: ["D07", "D40", "D39"],
    linePrefixes: ["F7203."],
    keywords: /woodworks|stock basis|7203|2023 k-1|s corp/i,
  },
  {
    test: /8606|5498|ira basis/i,
    subjects: ["D07", "D42", "D43", "Form 8606", "IRA basis records"],
    documents: ["D07", "D42", "D43"],
    linePrefixes: ["F8606."],
    keywords: /8606|5498|ira basis|nondeductible/i,
  },
  {
    test: /sparbanken|fbar|8938/i,
    subjects: ["D07", "Form 8938", "FBAR (outside filing)"],
    documents: ["D07"],
    linePrefixes: ["F8938."],
    keywords: /fbar|8938|fincen|sparbanken|foreign account/i,
  },
  {
    test: /appliances|fremont/i,
    subjects: ["D07", "asset:SAC-APPL", "FTB 3885A"],
    documents: ["D07"],
    linePrefixes: ["FTB3885A.SAC-APPL", "SchCA540NR.17."],
    keywords: /appliance|sac-appl|bonus depreciation|special depreciation/i,
  },
  {
    test: /home office|square footage/i,
    subjects: ["D07", "SchC.30", "qa-19"],
    documents: ["D07"],
    linePrefixes: ["SchC.30"],
    keywords: /home office|square f|sq ft/i,
  },
  {
    test: /3520|inheritance/i,
    subjects: ["D07", "Form 3520 (outside filing)", "qa-07", "qa-08"],
    documents: ["D07"],
    linePrefixes: [],
    keywords: /3520|inheritance|foreign gift/i,
  },
];

export async function carryoversView(ctx: SessionContext): Promise<CarryoversView> {
  const state = await loadWorkspaceState(ctx.db, ctx);
  const b = new Records(ctx, state);
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const tasks = await ctx.db.select().from(t.tasks).where(eq(t.tasks.workspaceId, ctx.workspace.id));

  const into = (packet.prior_years.carryovers_into_2025 as Record<string, unknown> | undefined) ?? {};
  const intoCalifornia = (into.california as Record<string, unknown> | undefined) ?? {};
  const outFederal = (state.version.carryovers_out.federal as Record<string, unknown> | undefined) ?? {};
  const outCalifornia = (state.version.carryovers_out.california as Record<string, unknown> | undefined) ?? {};

  const carryLines = b.cellsWithRule("R-PRIOR-YEAR-CARRY");
  const usedBy = new Map<string, LineCell[]>();
  for (const line of state.version.lines) {
    if (line.rule !== "R-PRIOR-YEAR-CARRY") continue;
    for (const s of line.sources) {
      if (!s.startsWith("py:")) continue;
      const pointer = s.slice(3);
      const list = usedBy.get(pointer) ?? [];
      list.push(b.cell(line.key)!);
      usedBy.set(pointer, list);
    }
  }
  const federal = carryoverRows(b, into, outFederal, "/carryovers_into_2025", usedBy);
  const california = carryoverRows(b, intoCalifornia, outCalifornia, "/carryovers_into_2025/california", usedBy);
  const caDepreciation = (outCalifornia.depreciation_basis_differences as Record<string, number> | undefined) ?? {};
  const depreciationDifferences = Object.entries(caDepreciation).map(([assetId, difference]) => ({
    assetId,
    description: state.version.assets.find((a) => a.asset_id === assetId)?.description ?? assetId,
    difference,
    asset: b.ref(`asset:${assetId}`),
  }));

  const basis = BASIS_SPECS.map((spec) => basisGroup(b, spec, outFederal));

  /* Prior preparer notes and open items, each paired with what this workpaper did. */
  const workpaper = (packet.prior_years.prior_preparer_workpaper as { source_document?: string; summary_memo?: string; notes?: string[]; open_items_left_by_prior_preparer?: string[] } | undefined) ?? {};
  const allKeys = [...b.lines.keys()];
  const pairItem = (kind: PriorItem["kind"], index: number, text: string): PriorItem => {
    const spec = PRIOR_ITEM_SPECS.find((s) => s.test.test(text));
    const refs = new Set<string>();
    const lineKeys: string[] = [];
    if (spec) {
      for (const d of spec.documents) refs.add(d);
      for (const prefix of spec.linePrefixes) for (const k of allKeys) if (k.startsWith(prefix)) lineKeys.push(k);
      for (const k of lineKeys) refs.add(k);
      for (const s of spec.subjects) if (/^(qa-|asset:)/.test(s)) refs.add(s);
    } else {
      refs.add("D07");
    }
    const byRef = workpaperUsesOf(packet, state, refs);
    const matches: WorkpaperMatch[] = byRef.map((u) => ({ ...u, actor: mustActor(packet, u.actorId) }));
    const seen = new Set(matches.map((m) => m.ref));
    const push = (m: WorkpaperMatch) => {
      if (seen.has(m.ref)) return;
      seen.add(m.ref);
      matches.push(m);
    };
    const keywords = spec?.keywords ?? /never-matches-anything-\u0000/;
    for (const j of state.judgments) {
      const hit = refs.has(j.subjectRef) || j.evidenceRefs.some((r) => refs.has(r)) || keywords.test(`${j.title} ${j.conclusion} ${j.applicability}`);
      if (!hit) continue;
      push({ table: "finding", id: j.id, ref: `judgment:${j.id}`, status: j.status, subject: j.subjectRef, subjectLabel: j.title, actorId: j.decidedBy, detail: `${j.kind.replace(/_/g, " ")}: ${j.conclusion}`, via: [j.subjectRef], createdRevision: j.createdRevision, actor: mustActor(packet, j.decidedBy) });
    }
    for (const task of tasks) {
      const hit = task.refs.some((r) => refs.has(r)) || keywords.test(`${task.title} ${task.detail}`) || (spec && /outside filing/i.test(spec.subjects.join(" ")) && task.kind === "outside_filing" && keywords.test(`${task.title} ${task.detail}`));
      if (!hit) continue;
      push({ table: "finding", id: task.id, ref: `task:${task.id}`, status: task.status, subject: task.kind.replace(/_/g, " "), subjectLabel: task.title, actorId: task.ownerId, detail: `${task.kind.replace(/_/g, " ")} task for ${mustActor(packet, task.ownerId).name}: ${task.detail}${task.completionNote ? ` Completed: ${task.completionNote}` : ""}`, via: task.refs.filter((r) => refs.has(r)), createdRevision: task.createdRevision, actor: mustActor(packet, task.ownerId) });
    }
    for (const f of state.findings) {
      if (seen.has(`finding:${f.id}`)) continue;
      if (!keywords.test(`${f.title} ${f.detail}`)) continue;
      push({ table: "finding", id: f.id, ref: `finding:${f.id}`, status: f.status, subject: f.title, subjectLabel: f.title, actorId: f.createdBy, detail: `${f.severity}${f.blocksFiling ? ", blocks filing" : ""}: ${f.detail}`, via: [], createdRevision: f.createdRevision, actor: mustActor(packet, f.createdBy) });
    }
    matches.sort((x, y) => x.createdRevision - y.createdRevision);
    const documents = (spec?.documents ?? ["D07"]).filter((d) => indexPacket(packet).documents.has(d)).map((d) => b.ref(d));
    const lines = lineKeys.map((k) => b.cell(k)!).filter(Boolean);
    const open = matches.some((m) => m.status === "open" || m.status === "proposed" || m.status === "unresolved");
    const status: PriorItem["status"] = matches.length === 0 ? "not_yet_addressed" : open ? "in_progress" : "addressed";
    const summary =
      matches.length === 0
        ? documents.some((d) => d.ref !== "D07" && d.available)
          ? `Not yet addressed in the workpaper; ${documents.filter((d) => d.ref !== "D07").map((d) => d.ref).join(", ")} in the file bears on it.`
          : "Not yet addressed in the workpaper."
        : `${matches.length} workpaper record(s) touch this item${open ? "; at least one is still open" : ""}.`;
    return { id: `${kind}-${index}`, kind, text, subjects: spec?.subjects ?? ["D07"], documents, lines, workpaper: matches, status, summary };
  };
  const items: PriorItem[] = [
    ...(workpaper.notes ?? []).map((text, i) => pairItem("note", i, text)),
    ...(workpaper.open_items_left_by_prior_preparer ?? []).map((text, i) => pairItem("open_item", i, text)),
  ];

  const view: CarryoversView = {
    ...b.meta(),
    federal,
    california,
    depreciationDifferences,
    carryLines,
    basis,
    priorPreparer: {
      document: b.ref(workpaper.source_document ?? "D07"),
      memo: workpaper.summary_memo ?? "",
      items,
    },
    sourcesNote: String(into.sources ?? "2024 return and prior preparer workpaper"),
    unknownNote: "Unknown stays unknown: a blank in the prior records is shown as unknown, never as zero, and the engine's carryovers out are shown as reported without being reconciled by this workpaper.",
  };
  return redact.deep(view);
}
