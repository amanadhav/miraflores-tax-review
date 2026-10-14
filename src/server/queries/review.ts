/**
 * Fully resolved view models for the review workspace: the area screen, the
 * line inspector and the depreciation schedule. Pages and components render
 * these without touching the packet, and every packet-derived string passes
 * through the redactor here before it can reach JSX.
 */
import { AREAS, areaForLine, areaLabel, type Area } from "@/domain/areas";
import { CATEGORY_LABELS, EFFECT_CATEGORIES, type EffectCategory } from "@/domain/effects";
import type { EffectiveLine, LineStatus } from "@/domain/effective";
import { dependentsIndex, describeFormula, type Formula } from "@/domain/formulas";
import { can, findActor, signOffPermission, type Actor, type Level } from "@/domain/policy";
import { makeRedactor } from "@/domain/redaction";
import { availableAt } from "@/packet/availability";
import { indexPacket } from "@/packet/load";
import { resolveRef } from "@/packet/refs";
import type { Jurisdiction, Packet, ReturnLine, VersionAsset } from "@/packet/types";
import type { SessionContext } from "@/server/context";
import {
  linesInArea,
  loadWorkspaceState,
  scopePreparers,
  type AdjustmentRow,
  type AnchorRow,
  type FindingRow,
  type SignoffRow,
  type VerificationRow,
  type WorkspaceState,
} from "@/server/state";

/* ------------------------------------------------------------------------ */
/* View model types.                                                          */
/* ------------------------------------------------------------------------ */

export type SignLevel = Level;
export const SIGN_LEVELS: SignLevel[] = ["preparer", "reviewer", "partner"];

export type LineValue = number | string | boolean | null;

export interface ActorView {
  id: string;
  name: string;
  role: string;
}

/** A reference resolved against the packet and the replay clock. */
export interface RefView {
  ref: string;
  label: string;
  kind: string;
  found: boolean;
  availableAt: string | null;
  available: boolean;
}

export interface LineRef {
  key: string;
  label: string;
  effective: LineValue;
  status: LineStatus;
}

export interface LineRowView {
  key: string;
  form: string;
  line: string;
  label: string;
  jurisdiction: Jurisdiction;
  baseline: LineValue;
  effective: LineValue;
  status: LineStatus;
  /** Plain-words explanation of the status (shown inline or on hover). */
  statusReason: string;
  /** Inputs whose change drove a recomputed or stale status. */
  changedInputs: { key: string; label: string }[];
  adjustmentId: string | null;
  pendingProposals: number;
  openFindings: number;
}

export interface AreaSummary {
  id: string;
  label: string;
  description: string;
  lines: number;
  openFindings: number;
  blockers: number;
  proposed: number;
  accepted: number;
  stale: number;
  signoffs: Record<SignLevel, "active" | "stale" | "none">;
}

export interface FindingView {
  id: string;
  origin: string;
  originLabel: string;
  code: string | null;
  severity: string;
  title: string;
  detail: string;
  refs: RefView[];
  area: string;
  areaLabel: string;
  blocksFiling: boolean;
  status: string;
  owner: ActorView | null;
  raisedBy: ActorView | null;
  createdRevision: number;
  createdAt: string;
  resolvedBy: ActorView | null;
  resolvedAt: string | null;
  resolvedRevision: number | null;
  resolution: string | null;
}

export interface SignoffView {
  id: string;
  scopeType: string;
  scopeId: string;
  scopeLabel: string;
  level: string;
  actor: ActorView;
  status: string;
  revision: number;
  createdAt: string;
  note: string | null;
  invalidatedAt: string | null;
  invalidatedRevision: number | null;
  invalidationReason: string | null;
  /** True when the viewer recorded this sign-off. */
  mine: boolean;
  /** True when the viewer may withdraw it (own sign-off, or partner permission). */
  canWithdraw: boolean;
}

export interface SignCapability {
  level: SignLevel;
  /** The viewer's role carries the permission for this level. */
  allowed: boolean;
  /** The viewer prepared part of the scope, so reviewer or partner sign-off would be refused. */
  selfReview: boolean;
  /** Plain-words explanation of an expected refusal, or null when the server should accept. */
  warning: string | null;
}

export interface SignoffPanelView {
  scopeType: "area" | "line";
  scopeId: string;
  scopeLabel: string;
  signoffs: SignoffView[];
  capabilities: SignCapability[];
}

export interface LotGroup {
  box: string;
  label: string;
  holding: "short" | "long" | "unknown";
  holdingLabel: string;
  /** The box total line when it belongs to this area. */
  total: LineRowView | null;
  /** Key of the box total line in the version, wherever it lives, for linking. */
  totalKey: string | null;
  totalLabel: string | null;
  lots: LineRowView[];
  /** Lots in this box across all pages (after the search filter). */
  lotCount: number;
  /** One-based position of the first and last lot shown, within the box. */
  from: number;
  to: number;
}

export interface LotsView {
  totals: (LineRowView & { box: string; lotCount: number })[];
  groups: LotGroup[];
  page: number;
  pageCount: number;
  pageSize: number;
  lotCount: number;
  from: number;
  to: number;
}

export interface AreaQuery {
  q?: string;
  page?: number;
  finding?: string;
}

export interface AreaView {
  area: Area;
  areas: AreaSummary[];
  query: string;
  revision: number;
  asOf: string;
  actor: ActorView & { canRaise: boolean; canResolve: boolean };
  findings: FindingView[];
  openFindings: number;
  signoffs: SignoffPanelView;
  /** Lines other than Form 8949 lots, after the search filter, in packet order. */
  lines: LineRowView[];
  /** All lines in the area before any filter. */
  lineCount: number;
  lots: LotsView | null;
  /** Staff who can own a finding. */
  owners: ActorView[];
}

export interface CalculationInput extends LineRef {
  sign?: 1 | -1;
  signVerified?: boolean;
  /** Present in the version at all; false when the engine lists an input the version lacks. */
  present: boolean;
}

export interface CalculationView {
  kind: Formula["kind"];
  rule: { id: string; description: string };
  /** describeFormula output with plain labels. */
  formula: string;
  inputs: CalculationInput[];
  factor: { value: number; ref: string; label: string } | null;
  reproducible: boolean;
  reason: string | null;
  statement: string;
}

export interface VerificationView {
  id: string;
  method: string;
  methodLabel: string;
  evidenceRefs: RefView[];
  conclusion: string;
  note: string | null;
  actor: ActorView;
  createdRevision: number;
  createdAt: string;
}

export interface AnchorView {
  id: string;
  ref: string;
  label: string;
  documentId: string;
  page: number;
  textSpan: string;
  origin: string;
  note: string | null;
  createdBy: ActorView;
  createdRevision: number;
}

export interface AdjustmentView {
  id: string;
  targetRef: string;
  kind: string;
  status: string;
  priorValue: LineValue;
  proposedValue: LineValue;
  priorLabel: string | null;
  proposedLabel: string | null;
  reason: string;
  evidenceRefs: RefView[];
  category: string | null;
  categoryLabel: string | null;
  measureDelta: number | null;
  caSource: boolean;
  effectFederal: number | null;
  effectCalifornia: number | null;
  balanceFederal: number | null;
  balanceCalifornia: number | null;
  effectStatus: string;
  effectBasis: string | null;
  limitations: string[];
  requiresPartner: boolean;
  author: ActorView;
  createdRevision: number;
  createdAt: string;
  decidedBy: ActorView | null;
  decidedAt: string | null;
  decidedRevision: number | null;
  decisionNote: string | null;
  supersedesId: string | null;
  supersededById: string | null;
  revertsId: string | null;
  revertedById: string | null;
  /** The viewer may accept or reject this proposal (server still decides). */
  canDecide: boolean;
  canUndo: boolean;
  /** Plain-words explanation of an expected refusal on accept, or null. */
  decideWarning: string | null;
}

export interface ProposeDefaults {
  category: EffectCategory;
  caSource: boolean;
  /** True when the line is a Schedule C expense, where reducing the line increases profit. */
  schcExpense: boolean;
}

export interface LineView {
  key: string;
  form: string;
  line: string;
  label: string;
  note: string | null;
  jurisdiction: Jurisdiction;
  area: { id: string; label: string };
  rule: { id: string; description: string };
  value: {
    baseline: LineValue;
    effective: LineValue;
    status: LineStatus;
    statusReason: string;
    staleBecause: LineRef[];
    recomputedFrom: LineRef[];
    adjustmentId: string | null;
  };
  calculation: CalculationView;
  dependents: LineRef[];
  evidence: {
    sources: RefView[];
    anchors: AnchorView[];
    verifications: VerificationView[];
    verificationTypes: string[];
    asOf: string;
  };
  history: AdjustmentView[];
  reviews: { line: SignoffPanelView; area: SignoffPanelView };
  findings: FindingView[];
  propose: {
    defaults: ProposeDefaults;
    categories: { value: EffectCategory; label: string }[];
    canPropose: boolean;
  };
  actor: ActorView & { canPropose: boolean; canDecide: boolean; canDecideMaterial: boolean; canUndo: boolean; canVerify: boolean };
  revision: number;
}

export interface AssetYearRow {
  year: string;
  federal: number | null;
  california: number | null;
  amtDifference: number | null;
}

export interface AssetView {
  id: string;
  description: string;
  activity: string;
  cost: number;
  landValue: number | null;
  placedInService: string;
  method: string;
  lifeYears: number;
  federal: { priorAccumulated: number; depreciation2025: number; accumulatedEnd: number };
  california: { priorAccumulated: number; depreciation2025: number; accumulatedEnd: number };
  amt: { depreciation2025: number; differenceFromRegular: number };
  disposed: string | null;
  disposition: { label: string; value: string }[];
  sources: RefView[];
  prior: {
    years: AssetYearRow[];
    method: string;
    cost: number;
    placedInService: string;
    sources: string[];
  } | null;
}

export interface AssetsView {
  version: string;
  computedAt: string;
  assets: AssetView[];
  revision: number;
}

/* ------------------------------------------------------------------------ */
/* Shared builders.                                                           */
/* ------------------------------------------------------------------------ */

const LOT_PAGE_SIZE = 50;

/** Form 8949 box to holding period as the packet uses them (H and K hold digital assets). */
const BOX_HOLDING: Record<string, "short" | "long"> = {
  A: "short",
  B: "short",
  C: "short",
  H: "short",
  D: "long",
  E: "long",
  F: "long",
  K: "long",
};

const SCHC_EXPENSE = /^SchC\.(8|9|1\d|2\d[a-z]?(\.\d+)?|30)$/;

function actorView(packet: Packet, id: string | null | undefined): ActorView | null {
  if (!id) return null;
  const a = findActor(packet, id);
  if (a) return { id: a.id, name: a.name, role: a.role.replace(/_/g, " ") };
  if (id === "engine") return { id, name: "Engine", role: "pipeline diagnostic" };
  if (id === "system") return { id, name: "System", role: "system" };
  return { id, name: id, role: "unknown" };
}

function num(value: string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

function iso(value: string): string {
  return isoOrNull(value) ?? value;
}

class ViewBuilder {
  readonly packet: Packet;
  readonly state: WorkspaceState;
  readonly asOf: string;
  readonly version: string;
  readonly packetLines: Map<string, ReturnLine>;
  readonly actor: Actor;

  constructor(ctx: SessionContext, state: WorkspaceState) {
    this.packet = ctx.packet.packet;
    this.state = state;
    this.asOf = iso(ctx.workspace.asOf);
    this.version = state.version.version;
    this.packetLines = indexPacket(this.packet).linesByVersion.get(this.version)!;
    this.actor = ctx.actor;
  }

  labelOf(key: string): string {
    return this.packetLines.get(key)?.label ?? key;
  }

  ref(ref: string): RefView {
    const r = resolveRef(this.packet, ref, { version: this.version });
    const at = availableAt(this.packet, ref);
    const atIso = at ? isoOrNull(at) : null;
    const available = atIso ? new Date(atIso).getTime() <= new Date(this.asOf).getTime() : true;
    return { ref, label: r.label, kind: r.parsed.kind, found: r.found, availableAt: atIso, available };
  }

  lineRef(key: string): LineRef {
    const eff = this.state.effective.lines.get(key);
    return {
      key,
      label: this.labelOf(key),
      effective: eff ? eff.effective : null,
      status: eff ? eff.status : "baseline",
    };
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
        const why =
          eff.formula.kind === "opaque"
            ? `engine rule ${eff.formula.rule} cannot be reproduced here`
            : "an input is itself stale, so the formula could not be re-evaluated";
        return {
          reason: `Engine value no longer trustworthy: these inputs changed: ${list(keys)}; ${why}. The baseline number is shown but must be reviewed.`,
          changed: named(keys),
        };
      }
    }
  }

  lineRow(line: ReturnLine): LineRowView {
    const eff = this.state.effective.lines.get(line.key)!;
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
    };
  }

  finding(f: FindingRow): FindingView {
    return {
      id: f.id,
      origin: f.origin,
      originLabel: f.origin === "engine_diagnostic" ? "Engine diagnostic" : f.origin === "reviewer" ? "Raised by a reviewer" : "System",
      code: f.code,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      refs: f.refs.map((r) => this.ref(r)),
      area: f.area,
      areaLabel: areaLabel(f.area),
      blocksFiling: f.blocksFiling,
      status: f.status,
      owner: actorView(this.packet, f.ownerId),
      raisedBy: actorView(this.packet, f.createdBy),
      createdRevision: f.createdRevision,
      createdAt: iso(f.createdAt),
      resolvedBy: actorView(this.packet, f.resolvedBy),
      resolvedAt: isoOrNull(f.resolvedAt),
      resolvedRevision: f.resolvedRevision,
      resolution: f.resolution,
    };
  }

  signoff(s: SignoffRow): SignoffView {
    const mine = s.actorId === this.actor.id;
    const live = s.status === "active" || s.status === "stale";
    return {
      id: s.id,
      scopeType: s.scopeType,
      scopeId: s.scopeId,
      scopeLabel: s.scopeType === "area" ? areaLabel(s.scopeId) : `${this.labelOf(s.scopeId)} (${s.scopeId})`,
      level: s.level,
      actor: actorView(this.packet, s.actorId) ?? { id: s.actorId, name: s.actorId, role: "unknown" },
      status: s.status,
      revision: s.revision,
      createdAt: iso(s.createdAt),
      note: s.note,
      invalidatedAt: isoOrNull(s.invalidatedAt),
      invalidatedRevision: s.invalidatedRevision,
      invalidationReason: s.invalidationReason,
      mine,
      canWithdraw: live && (mine || can(this.actor, "sign_off_partner")),
    };
  }

  async signoffPanel(db: SessionContext["db"], workspaceId: string, scopeType: "area" | "line", scopeId: string): Promise<SignoffPanelView> {
    const preparers = await scopePreparers(db, workspaceId, scopeType, scopeId);
    const prepared = preparers.has(this.actor.id);
    const roleName = this.actor.role.replace(/_/g, " ");
    const scopeLabel = scopeType === "area" ? areaLabel(scopeId) : `${this.labelOf(scopeId)} (${scopeId})`;
    const capabilities: SignCapability[] = SIGN_LEVELS.map((level) => {
      const allowed = can(this.actor, signOffPermission(level));
      const selfReview = level !== "preparer" && prepared;
      let warning: string | null = null;
      if (!allowed) warning = `${this.actor.name} (${roleName}) does not hold ${level}-level sign-off permission; the server will refuse this.`;
      else if (selfReview)
        warning = `${this.actor.name} prepared part of ${scopeLabel} (a proposal, verification, anchor or the engagement assignment), so ${level} sign-off would be refused as self-review.`;
      return { level, allowed, selfReview, warning };
    });
    const rows = this.state.signoffs.filter((s) => s.scopeType === scopeType && s.scopeId === scopeId);
    const order = (s: SignoffRow) => (s.status === "active" ? 0 : s.status === "stale" ? 1 : 2);
    const signoffs = [...rows].sort((a, b) => order(a) - order(b) || b.revision - a.revision).map((s) => this.signoff(s));
    return { scopeType, scopeId, scopeLabel, signoffs, capabilities };
  }

  verification(v: VerificationRow): VerificationView {
    return {
      id: v.id,
      method: v.method,
      methodLabel: v.method.replace(/_/g, " "),
      evidenceRefs: v.evidenceRefs.map((r) => this.ref(r)),
      conclusion: v.conclusion,
      note: v.note,
      actor: actorView(this.packet, v.actorId) ?? { id: v.actorId, name: v.actorId, role: "unknown" },
      createdRevision: v.createdRevision,
      createdAt: iso(v.createdAt),
    };
  }

  anchor(a: AnchorRow): AnchorView {
    const ref = `doc:${a.documentId}#page${a.page}`;
    return {
      id: a.id,
      ref,
      label: this.ref(ref).label,
      documentId: a.documentId,
      page: a.page,
      textSpan: a.textSpan,
      origin: a.origin,
      note: a.note,
      createdBy: actorView(this.packet, a.createdBy) ?? { id: a.createdBy, name: a.createdBy, role: "unknown" },
      createdRevision: a.createdRevision,
    };
  }

  adjustment(a: AdjustmentRow, preparersOfLine: Set<string>): AdjustmentView {
    const all = this.state.adjustments;
    const canDecideBase = can(this.actor, "decide_adjustment");
    const selfReview = preparersOfLine.has(this.actor.id) || a.authorId === this.actor.id;
    let decideWarning: string | null = null;
    if (a.status === "proposed") {
      if (!canDecideBase) decideWarning = `${this.actor.name} (${this.actor.role.replace(/_/g, " ")}) cannot accept or reject adjustments.`;
      else if (selfReview) decideWarning = `${this.actor.name} prepared part of ${a.targetRef} or authored this proposal, so deciding it would be refused as self-review.`;
      else if (a.requiresPartner && !can(this.actor, "decide_material_adjustment"))
        decideWarning = "The estimated effect is over the 1,000 threshold (or unknown), so only a partner can accept it; rejecting is allowed.";
    }
    return {
      id: a.id,
      targetRef: a.targetRef,
      kind: a.kind,
      status: a.status,
      priorValue: a.priorValue as LineValue,
      proposedValue: a.proposedValue as LineValue,
      priorLabel: a.priorLabel,
      proposedLabel: a.proposedLabel,
      reason: a.reason,
      evidenceRefs: a.evidenceRefs.map((r) => this.ref(r)),
      category: a.category,
      categoryLabel: a.category && a.category in CATEGORY_LABELS ? CATEGORY_LABELS[a.category as EffectCategory] : a.category,
      measureDelta: num(a.measureDelta),
      caSource: a.caSource,
      effectFederal: num(a.effectFederal),
      effectCalifornia: num(a.effectCalifornia),
      balanceFederal: num(a.balanceFederal),
      balanceCalifornia: num(a.balanceCalifornia),
      effectStatus: a.effectStatus,
      effectBasis: a.effectBasis,
      limitations: a.limitations,
      requiresPartner: a.requiresPartner,
      author: actorView(this.packet, a.authorId) ?? { id: a.authorId, name: a.authorId, role: "unknown" },
      createdRevision: a.createdRevision,
      createdAt: iso(a.createdAt),
      decidedBy: actorView(this.packet, a.decidedBy),
      decidedAt: isoOrNull(a.decidedAt),
      decidedRevision: a.decidedRevision,
      decisionNote: a.decisionNote,
      supersedesId: a.supersedesId,
      supersededById: all.find((o) => o.supersedesId === a.id)?.id ?? null,
      revertsId: a.revertsId,
      revertedById: all.find((o) => o.revertsId === a.id)?.id ?? null,
      canDecide: a.status === "proposed" && canDecideBase,
      canUndo: a.status === "accepted" && can(this.actor, "undo_adjustment"),
      decideWarning,
    };
  }

  calculation(line: ReturnLine, eff: EffectiveLine): CalculationView {
    const formula = eff.formula;
    const rules = this.packet.engine_reference.rules;
    const rule = { id: line.rule, description: rules[line.rule] ?? "No description supplied in the engine reference." };
    const input = (key: string, extra: Partial<CalculationInput> = {}): CalculationInput => ({
      ...this.lineRef(key),
      present: this.packetLines.has(key),
      ...extra,
    });
    const labels = (key: string) => `${this.labelOf(key)} (${key})`;
    switch (formula.kind) {
      case "sum":
        return {
          kind: "sum",
          rule,
          formula: describeFormula(formula, labels),
          inputs: formula.terms.map((t) => input(t.key, { sign: t.sign, signVerified: t.signVerified })),
          factor: null,
          reproducible: true,
          reason: null,
          statement: "Verified signed sum: this combination reproduces the engine's baseline exactly, so the line is recomputed here when an input changes.",
        };
      case "carry":
        return {
          kind: "carry",
          rule,
          formula: describeFormula(formula, labels),
          inputs: [input(formula.from)],
          factor: null,
          reproducible: true,
          reason: null,
          statement: "Verified carry: the value equals the source line, so the line follows that line when it changes.",
        };
      case "multiply":
        return {
          kind: "multiply",
          rule,
          formula: describeFormula(formula, labels),
          inputs: [input(formula.input)],
          factor: { value: formula.factor, ref: formula.factorRef, label: formula.factorRef.startsWith("ref:") ? this.ref(formula.factorRef).label : formula.factorRef },
          reproducible: true,
          reason: null,
          statement: "Verified multiplication: the input times the supplied factor, rounded to whole dollars, reproduces the engine's baseline.",
        };
      case "opaque":
        return {
          kind: "opaque",
          rule,
          formula: `Engine rule ${rule.id}: ${rule.description}`,
          inputs: line.inputs.map((k) => input(k)),
          factor: null,
          reproducible: false,
          reason: formula.reason,
          statement:
            "This calculation cannot be reproduced here. The engine's baseline value is kept, and the line goes stale (shown but not trusted) as soon as any input changes.",
        };
    }
  }
}

function proposeDefaults(line: ReturnLine): ProposeDefaults {
  const { key, form } = line;
  let category: EffectCategory = "none";
  if (form === "SchC" && typeof line.value === "number") category = "schc_profit";
  else if (form === "F8949") {
    const h = holdingFor(key, line.label);
    category = h === "long" ? "ltcg" : h === "short" ? "stcg" : "none";
  } else if (/^F1040\.2[56]/.test(key) || /^F540NR\.7\d/.test(key) || key === "Sch3.10") category = "payment";
  else if (form === "Sch3" || form === "F8812" || form === "F8863" || form === "F2441") category = "credit";
  else if (form === "SchB" && typeof line.value === "number") category = "interest";
  return { category, caSource: false, schcExpense: SCHC_EXPENSE.test(key) };
}

export function holdingFor(key: string, label: string): "short" | "long" | "unknown" {
  const m = key.match(/^F8949\.([A-Z]+)\./);
  if (m && BOX_HOLDING[m[1]]) return BOX_HOLDING[m[1]];
  const d = label.match(/acquired (\d{4}-\d{2}-\d{2}), sold (\d{4}-\d{2}-\d{2})/);
  if (d) {
    const acquired = new Date(d[1]);
    const sold = new Date(d[2]);
    const limit = new Date(acquired);
    limit.setUTCFullYear(limit.getUTCFullYear() + 1);
    return sold.getTime() > limit.getTime() ? "long" : "short";
  }
  return "unknown";
}

function boxOf(key: string): string {
  const m = key.match(/^F8949\.([A-Z]+)\./);
  return m ? m[1] : "?";
}

function isLotForm(line: ReturnLine): boolean {
  return line.form === "F8949";
}

function matchesQuery(line: ReturnLine, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return line.key.toLowerCase().includes(needle) || line.label.toLowerCase().includes(needle);
}

function areaSummaries(state: WorkspaceState): AreaSummary[] {
  return AREAS.map((area) => {
    const keys = new Set(linesInArea(state.version, area.id));
    const sig = (level: SignLevel) => {
      const rows = state.signoffs.filter((s) => s.scopeType === "area" && s.scopeId === area.id && s.level === level);
      if (rows.some((r) => r.status === "active")) return "active" as const;
      if (rows.some((r) => r.status === "stale")) return "stale" as const;
      return "none" as const;
    };
    return {
      id: area.id,
      label: area.label,
      description: area.description,
      lines: keys.size,
      openFindings: state.findings.filter((f) => f.status === "open" && f.area === area.id).length,
      blockers: state.findings.filter((f) => f.status === "open" && f.blocksFiling && f.area === area.id).length,
      proposed: state.adjustments.filter((a) => a.status === "proposed" && a.area === area.id).length,
      accepted: state.accepted.filter((a) => a.area === area.id).length,
      stale: state.effective.staleKeys.filter((k) => keys.has(k)).length,
      signoffs: { preparer: sig("preparer"), reviewer: sig("reviewer"), partner: sig("partner") },
    };
  });
}

/** The area a reviewer should land on: the first with open blockers, else the first. */
export function defaultAreaId(state: WorkspaceState): string {
  const blocked = AREAS.find((a) => state.findings.some((f) => f.status === "open" && f.blocksFiling && f.area === a.id));
  return (blocked ?? AREAS[0]).id;
}

function buildLots(b: ViewBuilder, lotLines: ReturnLine[], page: number): LotsView {
  const rows = lotLines.map((l) => b.lineRow(l));
  const boxOrder = (x: LineRowView, y: LineRowView) => boxOf(x.key).localeCompare(boxOf(y.key));
  const totals = rows
    .filter((r) => r.key.endsWith(".total"))
    .sort(boxOrder)
    .map((r) => ({ ...r, box: boxOf(r.key), lotCount: rows.filter((o) => !o.key.endsWith(".total") && boxOf(o.key) === boxOf(r.key)).length }));
  const lots = rows.filter((r) => !r.key.endsWith(".total")).sort(boxOrder); // stable: packet order within a box
  const lotCount = lots.length;
  const pageCount = Math.max(1, Math.ceil(lotCount / LOT_PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * LOT_PAGE_SIZE;
  const slice = lots.slice(start, start + LOT_PAGE_SIZE);
  const groups: LotGroup[] = [];
  for (const row of slice) {
    const box = boxOf(row.key);
    let group = groups.find((g) => g.box === box);
    if (!group) {
      const inBox = lots.filter((l) => boxOf(l.key) === box);
      const totalKey = `F8949.${box}.total`;
      const holding = holdingFor(row.key, row.label);
      const firstIndex = inBox.findIndex((l) => l.key === row.key);
      group = {
        box,
        label: `Box ${box}`,
        holding,
        holdingLabel: holding === "short" ? "short-term" : holding === "long" ? "long-term" : "holding period not known",
        total: totals.find((t) => t.box === box) ?? null,
        totalKey: b.packetLines.has(totalKey) ? totalKey : null,
        totalLabel: b.packetLines.get(totalKey)?.label ?? null,
        lots: [],
        lotCount: inBox.length,
        from: firstIndex + 1,
        to: firstIndex + 1,
      };
      groups.push(group);
    }
    group.lots.push(row);
    group.to = group.from + group.lots.length - 1;
  }
  return {
    totals,
    groups,
    page: current,
    pageCount,
    pageSize: LOT_PAGE_SIZE,
    lotCount,
    from: lotCount === 0 ? 0 : start + 1,
    to: Math.min(start + LOT_PAGE_SIZE, lotCount),
  };
}

/* ------------------------------------------------------------------------ */
/* Queries.                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * The area screen: every area's counts for the left column, and for the
 * selected area its findings, sign-offs and lines. When `areaId` is missing
 * or unknown the default area is chosen (the finding's area when `finding`
 * is given, else the first area with open blockers).
 */
export async function areaView(ctx: SessionContext, areaId: string | null | undefined, query: AreaQuery | string = {}): Promise<AreaView> {
  const opts: AreaQuery = typeof query === "string" ? { q: query } : query;
  const q = (opts.q ?? "").trim();
  const state = await loadWorkspaceState(ctx.db, ctx);
  const b = new ViewBuilder(ctx, state);
  const redact = makeRedactor(ctx.packet.packet);

  let chosen = AREAS.find((a) => a.id === areaId);
  if (!chosen && opts.finding) {
    const f = state.findings.find((x) => x.id === opts.finding);
    if (f) chosen = AREAS.find((a) => a.id === f.area);
  }
  const area = chosen ?? AREAS.find((a) => a.id === defaultAreaId(state))!;

  const allLines = state.version.lines.filter((l) => areaForLine(l.key, l.form) === area.id);
  const matched = allLines.filter((l) => matchesQuery(l, q));
  const plain = matched.filter((l) => !isLotForm(l));
  const lotLines = matched.filter(isLotForm);
  const hasLots = allLines.some(isLotForm);

  const findingOrder = (f: FindingRow) => (f.status === "open" ? 0 : 1);
  const severityOrder = (f: FindingRow) => (f.severity === "blocker" ? 0 : f.severity === "warning" ? 1 : 2);
  const findings = state.findings
    .filter((f) => f.area === area.id)
    .sort((x, y) => findingOrder(x) - findingOrder(y) || (x.status === "open" ? severityOrder(x) - severityOrder(y) : 0) || x.createdRevision - y.createdRevision)
    .map((f) => b.finding(f));

  const signoffs = await b.signoffPanel(ctx.db, ctx.workspace.id, "area", area.id);
  const owners = ctx.packet.packet.firm.staff.map((s) => ({ id: s.id, name: s.name, role: s.role.replace(/_/g, " ") }));

  const view: AreaView = {
    area,
    areas: areaSummaries(state),
    query: q,
    revision: ctx.workspace.revision,
    asOf: b.asOf,
    actor: {
      id: ctx.actor.id,
      name: ctx.actor.name,
      role: ctx.actor.role.replace(/_/g, " "),
      canRaise: can(ctx.actor, "raise_finding"),
      canResolve: can(ctx.actor, "resolve_finding"),
    },
    findings,
    openFindings: findings.filter((f) => f.status === "open").length,
    signoffs,
    lines: plain.map((l) => b.lineRow(l)),
    lineCount: allLines.length,
    lots: hasLots ? buildLots(b, lotLines, opts.page ?? 1) : null,
    owners,
  };
  return redact.deep(view);
}

/** The line inspector. Returns null when the key is not a line of the active version. */
export async function lineView(ctx: SessionContext, key: string): Promise<LineView | null> {
  const state = await loadWorkspaceState(ctx.db, ctx);
  const b = new ViewBuilder(ctx, state);
  const line = b.packetLines.get(key);
  const eff = state.effective.lines.get(key);
  if (!line || !eff) return null;
  const redact = makeRedactor(ctx.packet.packet);
  const areaId = areaForLine(line.key, line.form);
  const { reason } = b.statusReason(eff);

  const [linePanel, areaPanel] = await Promise.all([
    b.signoffPanel(ctx.db, ctx.workspace.id, "line", key),
    b.signoffPanel(ctx.db, ctx.workspace.id, "area", areaId),
  ]);
  const linePreparers = await scopePreparers(ctx.db, ctx.workspace.id, "line", key);

  const history = state.adjustments
    .filter((a) => a.targetRef === key)
    .sort((x, y) => x.createdRevision - y.createdRevision || x.createdAt.localeCompare(y.createdAt))
    .map((a) => b.adjustment(a, linePreparers));

  const view: LineView = {
    key: line.key,
    form: line.form,
    line: line.line,
    label: line.label,
    note: line.note ?? null,
    jurisdiction: line.jurisdiction,
    area: { id: areaId, label: areaLabel(areaId) },
    rule: { id: line.rule, description: ctx.packet.packet.engine_reference.rules[line.rule] ?? "No description supplied in the engine reference." },
    value: {
      baseline: eff.baseline,
      effective: eff.effective,
      status: eff.status,
      statusReason: reason,
      staleBecause: (eff.staleBecause ?? []).map((k) => b.lineRef(k)),
      recomputedFrom: (eff.recomputedFrom ?? []).map((k) => b.lineRef(k)),
      adjustmentId: eff.adjustmentId ?? null,
    },
    calculation: b.calculation(line, eff),
    dependents: (dependentsIndex(state.version).get(key) ?? []).map((k) => b.lineRef(k)),
    evidence: {
      sources: line.sources.map((r) => b.ref(r)),
      anchors: state.anchors.filter((a) => a.subjectRef === key).map((a) => b.anchor(a)),
      verifications: state.verifications.filter((v) => v.subjectRef === key).map((v) => b.verification(v)),
      verificationTypes: ctx.packet.packet.firm.starter_standards.verification_types,
      asOf: b.asOf,
    },
    history,
    reviews: { line: linePanel, area: areaPanel },
    findings: state.findings.filter((f) => f.refs.includes(key)).map((f) => b.finding(f)),
    propose: {
      defaults: proposeDefaults(line),
      categories: EFFECT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
      canPropose: can(ctx.actor, "propose_adjustment"),
    },
    actor: {
      id: ctx.actor.id,
      name: ctx.actor.name,
      role: ctx.actor.role.replace(/_/g, " "),
      canPropose: can(ctx.actor, "propose_adjustment"),
      canDecide: can(ctx.actor, "decide_adjustment"),
      canDecideMaterial: can(ctx.actor, "decide_material_adjustment"),
      canUndo: can(ctx.actor, "undo_adjustment"),
      canVerify: can(ctx.actor, "add_verification"),
    },
    revision: ctx.workspace.revision,
  };
  return redact.deep(view);
}

interface PriorAssetRecord {
  asset_id: string;
  description?: string;
  activity?: string;
  cost?: number;
  placed_in_service?: string;
  method?: string;
  life_years?: number;
  disposed?: string | null;
  land_value?: number | null;
  federal?: Record<string, number>;
  california?: Record<string, number>;
  amt_difference?: Record<string, number>;
  sources?: string[];
}

function dispositionRows(d: Record<string, unknown> | undefined): { label: string; value: string }[] {
  if (!d) return [];
  return Object.entries(d).map(([k, v]) => ({
    label: k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    value: typeof v === "number" ? v.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }) : v === null || v === undefined ? "blank" : String(v),
  }));
}

/** Depreciation by asset for the active version, with prior-year history per asset. */
export async function assetsView(ctx: SessionContext): Promise<AssetsView> {
  const state = await loadWorkspaceState(ctx.db, ctx);
  const b = new ViewBuilder(ctx, state);
  const redact = makeRedactor(ctx.packet.packet);
  const prior = (ctx.packet.packet.prior_years.asset_records as PriorAssetRecord[] | undefined) ?? [];
  const assets: AssetView[] = state.version.assets.map((a: VersionAsset) => {
    const p = prior.find((r) => r.asset_id === a.asset_id);
    let history: AssetView["prior"] = null;
    if (p) {
      const years = new Set<string>([...Object.keys(p.federal ?? {}), ...Object.keys(p.california ?? {}), ...Object.keys(p.amt_difference ?? {})]);
      history = {
        years: [...years]
          .sort()
          .map((year) => ({
            year,
            federal: p.federal?.[year] ?? null,
            california: p.california?.[year] ?? null,
            amtDifference: p.amt_difference?.[year] ?? null,
          })),
        method: p.method ?? a.method,
        cost: p.cost ?? a.cost,
        placedInService: p.placed_in_service ?? a.placed_in_service,
        sources: p.sources ?? [],
      };
    }
    return {
      id: a.asset_id,
      description: a.description,
      activity: a.activity,
      cost: a.cost,
      landValue: a.land_value_not_depreciated,
      placedInService: a.placed_in_service,
      method: a.method,
      lifeYears: a.life_years,
      federal: { priorAccumulated: a.federal.prior_accumulated, depreciation2025: a.federal.depreciation_2025, accumulatedEnd: a.federal.accumulated_end },
      california: { priorAccumulated: a.california.prior_accumulated, depreciation2025: a.california.depreciation_2025, accumulatedEnd: a.california.accumulated_end },
      amt: { depreciation2025: a.amt.depreciation_2025, differenceFromRegular: a.amt.difference_from_regular },
      disposed: a.disposed,
      disposition: dispositionRows(a.disposition),
      sources: a.sources.map((r) => b.ref(r)),
      prior: history,
    };
  });
  return redact.deep({ version: state.version.version, computedAt: state.version.computed_at, assets, revision: ctx.workspace.revision });
}
