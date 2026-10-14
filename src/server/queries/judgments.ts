/**
 * Read model for the judgments screen: every judgment call, election, due
 * diligence record and penalty decision with its authority and evidence, plus
 * the packet's open judgment items as suggested subjects. A suggestion names
 * the question and the evidence that bears on it; it never carries a
 * prefilled conclusion. Staff only; clients get a refusal.
 */
import { AREAS, areaForLine, areaLabel } from "@/domain/areas";
import { can } from "@/domain/policy";
import { makeRedactor } from "@/domain/redaction";
import { parseRef } from "@/packet/refs";
import { indexPacket } from "@/packet/load";
import type { SessionContext } from "../context";
import { loadWorkspaceState, type JudgmentRow } from "../state";
import { actorOrUnknown, clockIso, isoOrNull, JUDGMENT_KIND_LABELS, kindLabel, refusalFor, refView, selfView, type Refusal } from "./people";
import type { ActorView, RefView } from "./review";

export type JudgmentKind = "judgment" | "election" | "due_diligence" | "penalty_decision";
export const JUDGMENT_KINDS: JudgmentKind[] = ["judgment", "election", "due_diligence", "penalty_decision"];

export interface ChecklistItemView {
  item: string;
  done: boolean;
  note: string | null;
}

export interface JudgmentView {
  id: string;
  ref: string;
  kind: JudgmentKind;
  kindLabel: string;
  subject: RefView;
  area: string;
  areaLabel: string;
  title: string;
  authority: string;
  applicability: string;
  conclusion: string;
  consequences: string | null;
  evidenceRefs: RefView[];
  checklist: ChecklistItemView[] | null;
  checklistDone: number;
  status: string;
  supersedesId: string | null;
  supersededById: string | null;
  decidedBy: ActorView;
  createdRevision: number;
  createdAt: string;
  mine: boolean;
}

export interface SuggestedSubject {
  id: string;
  title: string;
  /** The open question in plain words. Never a conclusion. */
  question: string;
  suggestedKind: JudgmentKind;
  subject: RefView;
  area: string;
  areaLabel: string;
  evidence: RefView[];
  /** Related screens (a what-if, the tasks page) that are not evidence references. */
  links: { href: string; label: string }[];
  /** Judgments already recorded on this subject and still in force. */
  recorded: { id: string; title: string; kindLabel: string; decidedBy: string; createdRevision: number }[];
}

export interface JudgmentsFilters {
  kind?: string;
  area?: string;
}

export interface JudgmentsView {
  asOf: string;
  version: string;
  revision: number;
  actor: ActorView & { canRecord: boolean };
  judgments: JudgmentView[];
  total: number;
  counts: { byKind: Record<JudgmentKind, number>; byArea: { id: string; label: string; count: number }[] };
  filters: { kind: JudgmentKind | null; area: string | null };
  kinds: { value: JudgmentKind; label: string }[];
  areas: { id: string; label: string }[];
  suggestions: SuggestedSubject[];
}

interface SuggestionSeed {
  id: string;
  title: string;
  question: string;
  kind: JudgmentKind;
  subjectRef: string;
  area?: string;
  evidence: string[];
  links?: { href: string; label: string }[];
}

/** The packet's judgment items. Subjects and evidence are references; conclusions are the reviewer's. */
const SUGGESTIONS: SuggestionSeed[] = [
  {
    id: "health_insurance_eligibility",
    title: "Self-employed health insurance: eligibility for employer coverage",
    question: "The questionnaire says Erik was eligible for family coverage through Ngozi's employers. The deduction is not allowed for any month of eligibility, whatever plan he kept. Which months, if any, qualify?",
    kind: "judgment",
    subjectRef: "Sch1.17",
    evidence: ["qa-25", "D25", "ev-0484"],
  },
  {
    id: "hvac_repair_vs_improvement",
    title: "HVAC replacement at 1450 Fremont Way: repair or improvement",
    question: "The owner statement books the 11,000 system replacement inside repairs; the call note describes a whole new heat pump system. Is this a deductible repair or a capital improvement depreciated over 27.5 years?",
    kind: "judgment",
    subjectRef: "SchE.14A",
    evidence: ["D47", "call-01", "ev-1000"],
    links: [{ href: "/changes/whatif?alt=hvac_improvement", label: "What-if: HVAC as an improvement" }],
  },
  {
    id: "vehicle_donation_value",
    title: "Vehicle donation: deductible value of the 2012 Subaru",
    question: "The client estimates 6,000 and the charity sold the car at auction. Form 1098-C governs the deduction when the charity sells the vehicle. What amount is substantiated?",
    kind: "judgment",
    subjectRef: "F8283.A1.vehicle",
    evidence: ["D66", "qa-39", "call-01", "ev-1055"],
  },
  {
    id: "property_tax_seller_credit",
    title: "Real estate taxes on the home: seller credit at closing",
    question: "The buyer closing statement for 7709 Barton Ridge shows a property tax credit from the seller. Does the Schedule A amount need to be reduced for taxes the seller bore?",
    kind: "judgment",
    subjectRef: "SchA.5b",
    evidence: ["D54", "ev-1036", "ev-1038"],
  },
  {
    id: "california_wage_sourcing",
    title: "California wage sourcing for the part-year resident",
    question: "The California wage amount rests on the W-2 state boxes. The July paystub shows the pay period straddling the move. Are wages sourced by residency period or by where the work was done?",
    kind: "judgment",
    subjectRef: "SchCA540NR.1.E",
    evidence: ["D73", "ev-0030", "ev-0047"],
  },
  {
    id: "sep_limit",
    title: "SEP contribution above the deductible limit",
    question: "The confirmation shows an 18,000 contribution; the engine limited the deduction to 15,214. Is the excess an excess contribution for 2025, a 2026 contribution, or to be withdrawn?",
    kind: "judgment",
    subjectRef: "Sch1.16",
    evidence: ["D26", "ev-0485"],
  },
  {
    id: "c6_basis",
    title: "Coinhaven lot C6: cost basis of the transferred BTC",
    question: "The engine used zero basis for the lot transferred in from an external wallet. The client describes a March 2021 purchase on a closed exchange. What basis and holding period are substantiated, and by what?",
    kind: "judgment",
    subjectRef: "F8949.H.C6",
    evidence: ["msg-07", "ev-0879", "ev-0918", "ev-0919"],
  },
  {
    id: "parish_receipt",
    title: "St. Brigid Parish gift: handwritten receipt read with low confidence",
    question: "The pipeline read the handwritten amount at 0.41 confidence. The client later confirmed 1,500 by phone and bank statement. What amount is substantiated, and is the receipt adequate?",
    kind: "judgment",
    subjectRef: "ev-1049",
    evidence: ["D64", "msg-08"],
  },
  {
    id: "california_amt",
    title: "California AMT not computed",
    question: "The engine did not compute Schedule P (540NR). The incentive stock option exercise is an AMT adjustment for the California resident period. Is a California AMT computation required, and what is its basis?",
    kind: "judgment",
    subjectRef: "F540NR.61",
    evidence: ["F6251.2i", "D12"],
  },
  {
    id: "outside_filings",
    title: "2023 Form 3520 and FBAR: filings outside this return",
    question: "The prior workpaper left a 2023 Form 3520 (foreign inheritance over 100,000) unresolved, and the foreign account triggers an FBAR. Which filings are outside this engagement, and how are they tracked?",
    kind: "judgment",
    subjectRef: "F8938.req",
    evidence: ["D07", "F8938.1.max", "py:/prior_preparer_workpaper/open_items_left_by_prior_preparer"],
    links: [{ href: "/people/tasks?kind=outside_filing", label: "Outside filing tasks" }],
  },
  {
    id: "contractor_1099s",
    title: "Contractor Forms 1099-NEC not filed",
    question: "Two contractors were paid 600 or more by ACH and no Forms 1099-NEC were filed. Schedule C asks whether the forms were or will be filed; the penalty exposure depends on when they are.",
    kind: "judgment",
    subjectRef: "SchC.I",
    evidence: ["D27", "call-01", "qa-22", "ev-0487", "ev-0488"],
    links: [{ href: "/people/tasks?kind=outside_filing", label: "Outside filing tasks" }],
  },
  {
    id: "form_8867_due_diligence",
    title: "Form 8867 due diligence for the child tax credit and the credit for other dependents",
    question: "The paid preparer checklist is required for the credits claimed. Record each requirement with whether it was met and from what.",
    kind: "due_diligence",
    subjectRef: "F8867.status",
    evidence: ["D04", "D05", "D59", "qa-04"],
  },
  {
    id: "partnership_outside_basis",
    title: "Ridgeline partnership: outside basis never computed",
    question: "The 2024 K-1 shows a capital account of 60,000 and the prior workpaper says outside basis was never computed. Can the 2025 passive items and any distributions be reported without it, and what is the plan to establish it?",
    kind: "judgment",
    subjectRef: "SchE.28B",
    area: "pass_throughs_and_basis",
    evidence: ["D37", "D38", "py:/basis_records/partnership_ridgeline/0", "D07"],
  },
];

function judgmentView(ctx: SessionContext, asOf: string, j: JudgmentRow, all: JudgmentRow[]): JudgmentView {
  const packet = ctx.packet.packet;
  const version = ctx.workspace.activeVersion;
  const checklist = j.checklist ? j.checklist.map((c) => ({ item: c.item, done: c.done, note: c.note ?? null })) : null;
  return {
    id: j.id,
    ref: `judgment:${j.id}`,
    kind: j.kind as JudgmentKind,
    kindLabel: kindLabel(JUDGMENT_KIND_LABELS, j.kind),
    subject: refView(packet, version, asOf, j.subjectRef),
    area: j.area,
    areaLabel: areaLabel(j.area),
    title: j.title,
    authority: j.authority,
    applicability: j.applicability,
    conclusion: j.conclusion,
    consequences: j.consequences,
    evidenceRefs: j.evidenceRefs.map((r) => refView(packet, version, asOf, r)),
    checklist,
    checklistDone: checklist ? checklist.filter((c) => c.done).length : 0,
    status: j.status,
    supersedesId: j.supersedesId,
    supersededById: all.find((o) => o.supersedesId === j.id)?.id ?? null,
    decidedBy: actorOrUnknown(packet, j.decidedBy),
    createdRevision: j.createdRevision,
    createdAt: isoOrNull(j.createdAt) ?? j.createdAt,
    mine: j.decidedBy === ctx.actor.id,
  };
}

function areaOfSubject(ctx: SessionContext, seed: SuggestionSeed): string {
  if (seed.area) return seed.area;
  const parsed = parseRef(seed.subjectRef);
  const idx = indexPacket(ctx.packet.packet);
  if (parsed.kind === "line") {
    const line = idx.linesByVersion.get(ctx.workspace.activeVersion)?.get(parsed.key);
    if (line) return areaForLine(line.key, line.form);
  }
  if (parsed.kind === "extracted_value") {
    const ev = idx.extractedValues.get(parsed.id);
    if (ev) {
      const doc = idx.documents.get(ev.document_id);
      if (doc) return doc.document_type === "donation_receipt" ? "deductions_and_credits" : "intake_and_engagement";
    }
  }
  return "intake_and_engagement";
}

export async function judgmentsView(ctx: SessionContext, filters: JudgmentsFilters = {}): Promise<JudgmentsView | Refusal> {
  const refused = refusalFor(ctx);
  if (refused) return refused;
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const asOf = clockIso(ctx);
  const version = ctx.workspace.activeVersion;
  const state = await loadWorkspaceState(ctx.db, ctx);
  const all = [...state.judgments].sort((a, b) => b.createdRevision - a.createdRevision);
  const views = all.map((j) => judgmentView(ctx, asOf, j, all));
  const kind = JUDGMENT_KINDS.includes(filters.kind as JudgmentKind) ? (filters.kind as JudgmentKind) : null;
  const area = AREAS.some((a) => a.id === filters.area) ? filters.area! : null;
  const byKind: Record<JudgmentKind, number> = { judgment: 0, election: 0, due_diligence: 0, penalty_decision: 0 };
  for (const v of views) byKind[v.kind] += 1;
  const byArea = AREAS.map((a) => ({ id: a.id, label: a.label, count: views.filter((v) => v.area === a.id).length })).filter((a) => a.count > 0);
  const judgments = views.filter((v) => (!kind || v.kind === kind) && (!area || v.area === area));

  const suggestions: SuggestedSubject[] = SUGGESTIONS.map((s) => {
    const areaId = areaOfSubject(ctx, s);
    const recorded = views
      .filter((v) => v.status === "recorded" && v.subject.ref === s.subjectRef)
      .map((v) => ({ id: v.id, title: v.title, kindLabel: v.kindLabel, decidedBy: v.decidedBy.name, createdRevision: v.createdRevision }));
    return {
      id: s.id,
      title: s.title,
      question: s.question,
      suggestedKind: s.kind,
      subject: refView(packet, version, asOf, s.subjectRef),
      area: areaId,
      areaLabel: areaLabel(areaId),
      evidence: s.evidence.map((r) => refView(packet, version, asOf, r)),
      links: s.links ?? [],
      recorded,
    };
  }).filter((s) => !area || s.area === area);

  const view: JudgmentsView = {
    asOf,
    version,
    revision: ctx.workspace.revision,
    actor: { ...selfView(ctx), canRecord: can(ctx.actor, "add_verification") },
    judgments,
    total: views.length,
    counts: { byKind, byArea },
    filters: { kind, area },
    kinds: JUDGMENT_KINDS.map((k) => ({ value: k, label: JUDGMENT_KIND_LABELS[k] })),
    areas: AREAS.map((a) => ({ id: a.id, label: a.label })),
    suggestions,
  };
  return redact.deep(view);
}
