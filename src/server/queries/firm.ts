/**
 * Everything the Firm screen shows, assembled server-side and masked before
 * it leaves. Identity numbers are returned only in their masked form; the
 * Reveal button on the screen goes through the logged reveal path.
 */
import { desc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { AREAS } from "@/domain/areas";
import { can, findActor, isAvailableAt, staffActor } from "@/domain/policy";
import { makeRedactor } from "@/domain/redaction";
import type { SessionContext } from "../context";

export const STANDARDS_VERSION = "starter-standards-v1";

export interface FirmStaffRow {
  id: string;
  name: string;
  role: string;
  credential: string | null;
  clearance: boolean;
  activeFrom: string;
  /** Availability at the replay clock, not today. */
  available: boolean;
  note: string | null;
  /** Engagement roles this person holds in the workspace. */
  assignments: string[];
}

export interface FirmView {
  name: string;
  status: { workflowState: string; activeVersion: string; asOf: string; revision: number; filingLocked: boolean };
  assignments: { level: "preparer" | "reviewer" | "partner"; id: string; name: string }[];
  deadlines: { what: string; date: string; daysFromClock: number }[];
  staff: FirmStaffRow[];
  identity: {
    ein: string;
    address: string;
    phone: string;
    efinMasked: string;
    eroPinMasked: string;
    ptins: { staffId: string; name: string; masked: string }[];
    signer: string;
  };
  standards: {
    version: string;
    note: string;
    rules: string[];
    requiredSteps: string[];
    verificationTypes: string[];
    reviewLevels: string[];
    variance: { compareTo: string; percent: number; amount: number };
  };
  budget: { rows: { areaId: string; label: string; hours: number }[]; total: number };
  /** Staff only. */
  household: null | {
    filingStatus: string;
    taxYear: number;
    people: {
      id: string;
      name: string;
      role: string;
      relationship: string | null;
      dob: string;
      ssnMasked: string;
      ipPinMasked: string | null;
    }[];
    bank: { bank: string; type: string; routingMasked: string; accountMasked: string };
  };
  /** Cleared staff and the firm administrator only; null means "restricted". */
  viewLog: null | {
    id: number;
    at: string;
    actorId: string;
    actorName: string;
    ref: string;
    field: string;
    outcome: string;
    reason: string | null;
    revision: number;
  }[];
}

function daysBetween(fromIso: string, dateOnly: string): number {
  const from = Date.UTC(
    new Date(fromIso).getUTCFullYear(),
    new Date(fromIso).getUTCMonth(),
    new Date(fromIso).getUTCDate(),
  );
  const to = Date.parse(`${dateOnly}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export async function loadFirm(ctx: SessionContext): Promise<FirmView> {
  const packet = ctx.packet.packet;
  const firm = packet.firm;
  const ws = ctx.workspace;
  const asOf = new Date(ws.asOf).toISOString();
  const redact = makeRedactor(packet);
  const nameOf = (id: string) => findActor(packet, id)?.name ?? id;

  const assignments: FirmView["assignments"] = [
    { level: "preparer", id: ws.assignedPreparer, name: nameOf(ws.assignedPreparer) },
    { level: "reviewer", id: ws.assignedReviewer, name: nameOf(ws.assignedReviewer) },
    { level: "partner", id: ws.assignedPartner, name: nameOf(ws.assignedPartner) },
  ];

  const staff: FirmStaffRow[] = firm.staff.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role.replace(/_/g, " "),
    credential: s.credential,
    clearance: s.sensitive_data_clearance,
    activeFrom: s.active_from,
    available: isAvailableAt(staffActor(s), asOf),
    note: s.note ?? null,
    assignments: assignments.filter((a) => a.id === s.id).map((a) => a.level),
  }));

  const maskedIdentity = redact.deep(firm.firm_identity);
  const identity: FirmView["identity"] = {
    ein: firm.firm_identity.ein,
    address: firm.firm_identity.address,
    phone: firm.firm_identity.phone,
    efinMasked: maskedIdentity.efin,
    eroPinMasked: maskedIdentity.ero_pin,
    ptins: Object.entries(maskedIdentity.ptins).map(([staffId, masked]) => ({ staffId, name: nameOf(staffId), masked })),
    signer: nameOf(firm.firm_identity.paid_preparer_signing_returns),
  };

  const std = firm.starter_standards;
  const standards: FirmView["standards"] = {
    version: STANDARDS_VERSION,
    note: std.note,
    rules: std.rules,
    requiredSteps: std.required_steps,
    verificationTypes: std.verification_types,
    reviewLevels: std.review_levels,
    variance: { compareTo: std.variance_review.compare_to, percent: std.variance_review.flag_if_change_over_percent, amount: std.variance_review.and_over_amount },
  };

  const budgetRows = AREAS.filter((a) => a.budgetKey).map((a) => ({ areaId: a.id, label: a.label, hours: firm.budget_hours[a.budgetKey!] ?? 0 }));
  const budget = { rows: budgetRows, total: budgetRows.reduce((sum, r) => sum + r.hours, 0) };

  const isStaff = ctx.actor.role !== "client";
  let household: FirmView["household"] = null;
  if (isStaff) {
    const people = redact.deep(packet.household.people);
    const bank = redact.deep(packet.household.bank_account_for_refund_or_payment);
    household = {
      filingStatus: packet.household.filing_status.replace(/_/g, " "),
      taxYear: packet.household.tax_year,
      people: people.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        relationship: p.relationship ?? null,
        dob: p.dob,
        ssnMasked: p.ssn,
        ipPinMasked: p.ip_pin,
      })),
      bank: { bank: bank.bank, type: bank.type, routingMasked: bank.routing, accountMasked: bank.account },
    };
  }

  const canSeeLog = isStaff && (can(ctx.actor, "reveal_sensitive") || ctx.actor.role === "firm_administrator");
  let viewLog: FirmView["viewLog"] = null;
  if (canSeeLog) {
    const rows = await ctx.db
      .select()
      .from(t.viewEvents)
      .where(eq(t.viewEvents.workspaceId, ws.id))
      .orderBy(desc(t.viewEvents.createdAt), desc(t.viewEvents.id))
      .limit(200);
    viewLog = rows.map((r) => ({
      id: r.id,
      at: new Date(r.createdAt).toISOString(),
      actorId: r.actorId,
      actorName: nameOf(r.actorId),
      ref: r.ref,
      field: r.field,
      outcome: r.outcome,
      reason: r.reason ? redact.text(r.reason) : null,
      revision: r.revision,
    }));
  }

  return {
    name: firm.name,
    status: { workflowState: ws.workflowState, activeVersion: ws.activeVersion, asOf, revision: ws.revision, filingLocked: ws.filingLocked },
    assignments,
    deadlines: firm.deadlines.map((d) => ({ what: d.what, date: d.date, daysFromClock: daysBetween(asOf, d.date) })),
    staff,
    identity,
    standards,
    budget,
    household,
    viewLog,
  };
}
