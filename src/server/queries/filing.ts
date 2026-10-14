/**
 * Read model for the Filing screen (staff). Everything a page needs to show the
 * lifecycle is computed here: the workflow banner, the firm's required steps
 * evaluated from records, which actions the current state allows, the
 * submission attempts, approvals and frozen snapshots, the packet's extension
 * record and the agency notices filtered by the replay clock. Every
 * packet-derived string is redacted before it leaves this module.
 */
import { asc, desc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { can, findActor } from "@/domain/policy";
import { makeRedactor, type Redactor } from "@/domain/redaction";
import { indexPacket } from "@/packet/load";
import { parseRef, resolveRef } from "@/packet/refs";
import type { Packet } from "@/packet/types";
import type { SessionContext } from "@/server/context";
import { filingReadiness, type Readiness } from "@/server/filing";
import { loadWorkspaceState, type WorkspaceState } from "@/server/state";

/* ------------------------------------------------------------------------ */
/* View model types                                                           */
/* ------------------------------------------------------------------------ */

export type WorkflowStateId = "preparing" | "ready_for_client" | "authorized" | "submitted" | "rejected" | "accepted" | "amending";

export interface BannerView {
  state: WorkflowStateId | string;
  label: string;
  whatNext: string;
  frozen: boolean;
  frozenNote: string;
}

export interface ReadinessRefView {
  ref: string;
  label: string;
  kind: string;
  found: boolean;
}

export interface ReadinessItemView {
  step: string;
  ok: boolean;
  detail: string;
  blocking: boolean;
  refs: ReadinessRefView[];
}

export interface ReadinessView {
  ok: boolean;
  items: ReadinessItemView[];
  blockingCount: number;
  informationalCount: number;
  presentationHash: string;
  returnFingerprint: string;
  standardsVersion: string;
}

export interface ActionGate {
  /** The workflow state allows this action right now. */
  available: boolean;
  /** Who the server lets do it, in plain words. */
  who: string;
  /** The viewer's role carries the permission (the server still decides). */
  allowed: boolean;
}

export interface EfileScriptView {
  index: number;
  date: string;
  jurisdiction: string;
  status: string;
  /** Simulated agency id from the packet. */
  submissionId: string;
  errors: { code: string; message: string }[];
  /** The outcome this script records, or null for a row that is not an outcome (the state hold). */
  outcome: "accepted" | "rejected" | null;
}

export interface SubmissionView {
  id: string;
  jurisdiction: string;
  attempt: number;
  status: string;
  simulated: boolean;
  submissionRef: string;
  errors: { code: string; message: string }[];
  submittedAt: string;
  decidedAt: string | null;
  snapshotId: string;
  snapshotHash: string | null;
  createdRevision: number;
  decidedRevision: number | null;
  /** A transmitted attempt that still awaits the agency's response. */
  awaitingOutcome: boolean;
  /** Packet scripts that apply to this attempt's jurisdiction. */
  scripts: EfileScriptView[];
}

export interface ApprovalView {
  id: string;
  personId: string;
  personName: string;
  snapshotId: string;
  presentationHash: string;
  status: string;
  simulated: boolean;
  signedAt: string;
  createdRevision: number;
  invalidatedRevision: number | null;
  invalidationReason: string | null;
}

export interface SnapshotView {
  id: string;
  kind: string;
  revision: number;
  contentHash: string;
  businessTime: string;
  createdBy: string;
  createdByName: string;
  exports: { label: string; href: string }[];
}

export interface ExtensionView {
  computedAt: string;
  basedOnVersion: string;
  federal: { estimatedTotalTax: number | null; payments: number | null; estimatedBalance: number | null; paidWithForm4868: number | null; rule: string };
  california: { estimatedTotalTax: number | null; payments: number | null; estimatedBalance: number | null; paidWithFtb3519: number | null; rule: string };
  timeline: { id: string; at: string; detail: string; actorName: string | null } | null;
  /** The packet's post-filing note: an extension of time to file is not an extension of time to pay. */
  payNote: string;
  rates: { irsInterestAnnual: number | null; irsFailureToPayPerMonth: number | null; ftbInterestAnnual: number | null; ftbLatePaymentPenalty: string | null };
}

export interface NoticeView {
  index: number;
  id: string;
  agency: string;
  type: string;
  taxYear: number | null;
  dated: string;
  responseDue: string | null;
  summary: string | null;
  status: string | null;
  documentId: string | null;
  documentTitle: string | null;
  items: string[];
  /** Dated at or before the replay clock. */
  available: boolean;
  availabilityLabel: string;
  exports: { label: string; href: string }[];
}

export interface AmendmentView {
  id: string;
  name: string;
  createdAt: string;
  workflowState: string;
}

export interface FilingView {
  revision: number;
  asOf: string;
  workspace: {
    id: string;
    name: string;
    state: string;
    filingLocked: boolean;
    activeVersion: string;
    parentWorkspaceId: string | null;
    amendsSnapshotId: string | null;
  };
  viewer: { id: string; name: string; role: string };
  banner: BannerView;
  readiness: ReadinessView;
  actions: {
    present: ActionGate;
    submit: ActionGate;
    outcome: ActionGate;
    amend: ActionGate;
    nextYear: ActionGate;
  };
  submissions: SubmissionView[];
  approvals: ApprovalView[];
  snapshots: SnapshotView[];
  amendments: AmendmentView[];
  extension: ExtensionView;
  notices: NoticeView[];
  clientUsers: { id: string; name: string }[];
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------ */

const STATE_LABELS: Record<string, string> = {
  preparing: "Preparing",
  ready_for_client: "Ready for client approval",
  authorized: "Authorized for e-filing",
  submitted: "Submitted (simulated)",
  rejected: "Rejected by the agency (simulated)",
  accepted: "Accepted (simulated)",
  amending: "Amending",
};

export function bannerFor(state: string, filingLocked: boolean): BannerView {
  const label = STATE_LABELS[state] ?? state.replace(/_/g, " ");
  let whatNext: string;
  switch (state) {
    case "preparing":
      whatNext =
        "Work through the required steps below. When every blocking step is satisfied, a reviewer or partner presents the return to the client; that freezes a hashed presentation for the clients to approve.";
      break;
    case "ready_for_client":
      whatNext =
        "Both spouses review the presented return in the client portal and sign the e-file authorization (simulated). Any change to what was presented reopens their approvals and moves the return back to preparing.";
      break;
    case "authorized":
      whatNext = "Both clients approved the current presentation. A partner submits the return (simulated transmission); submission freezes the workpaper.";
      break;
    case "submitted":
      whatNext =
        "Waiting for the agencies' responses (simulated). Record an acceptance or a rejection per attempt, or replay the packet's scripted responses. California is held until the federal return is accepted.";
      break;
    case "rejected":
      whatNext =
        "The agency rejected an attempt, so the workpaper is unlocked for corrections. Fix the cause, get fresh reviewer and partner sign-offs, present again, collect both approvals again and resubmit.";
      break;
    case "accepted":
      whatNext =
        "Both returns were accepted (simulated) and the filed return is frozen for good. Later changes go to an amendment workspace branched from the accepted snapshot; next year's starting record can be created from here.";
      break;
    case "amending":
      whatNext =
        "This workspace is an amendment branched from an accepted return. It starts from the filed facts (accepted changes carried with their origin) and goes through the same review, presentation and approval steps. The original workspace stays frozen.";
      break;
    default:
      whatNext = "Unknown workflow state.";
  }
  const frozenNote = filingLocked
    ? "The workpaper is frozen: adjustments, verifications, findings and sign-offs are refused until a rejection unlocks it or an amendment is started."
    : "The workpaper is open: records can still change. Presentations and approvals bind to a content hash, so any change after presentation is detected.";
  return { state, label, whatNext, frozen: filingLocked, frozenNote };
}

function actorName(packet: Packet, id: string | null | undefined): string {
  if (!id) return "";
  if (id === "system") return "System";
  if (id === "engine") return "Engine";
  return findActor(packet, id)?.name ?? id;
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

function iso(value: string): string {
  return isoOrNull(value) ?? value;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readinessRef(
  packet: Packet,
  redact: Redactor,
  state: WorkspaceState,
  tasks: { id: string; title: string }[],
  ref: string,
): ReadinessRefView {
  const parsed = parseRef(ref);
  if (parsed.kind === "workpaper") {
    if (parsed.table === "finding") {
      const f = state.findings.find((x) => x.id === parsed.id);
      return { ref, label: f ? redact.text(f.title) : `finding ${parsed.id}`, kind: "finding", found: Boolean(f) };
    }
    if (parsed.table === "adjustment") {
      const a = state.adjustments.find((x) => x.id === parsed.id);
      return { ref, label: a ? `${a.targetRef}: ${redact.text(a.reason).slice(0, 80)}` : `adjustment ${parsed.id}`, kind: "adjustment", found: Boolean(a) };
    }
    if (parsed.table === "task") {
      const x = tasks.find((y) => y.id === parsed.id);
      return { ref, label: x ? `task: ${redact.text(x.title)}` : `task ${parsed.id}`, kind: "task", found: Boolean(x) };
    }
    return { ref, label: `${parsed.table} ${parsed.id}`, kind: parsed.table, found: true };
  }
  const r = resolveRef(packet, ref, { version: state.version.version });
  return { ref, label: redact.text(r.label), kind: r.parsed.kind, found: r.found };
}

function readinessView(packet: Packet, redact: Redactor, state: WorkspaceState, tasks: { id: string; title: string }[], r: Readiness): ReadinessView {
  const items = r.items.map<ReadinessItemView>((i) => ({
    step: i.step,
    ok: i.ok,
    detail: redact.text(i.detail),
    blocking: i.blocking,
    refs: i.refs.map((ref) => readinessRef(packet, redact, state, tasks, ref)),
  }));
  return {
    ok: r.ok,
    items,
    blockingCount: items.filter((i) => i.blocking && !i.ok).length,
    informationalCount: items.filter((i) => !i.blocking).length,
    presentationHash: r.presentationHash,
    returnFingerprint: r.returnFingerprint,
    standardsVersion: r.standardsVersion,
  };
}

interface PacketEfileRow {
  date?: string;
  jurisdiction?: string;
  submission_id?: string;
  status?: string;
  errors?: { code: string; message: string }[];
}

export function efileScripts(packet: Packet, redact: Redactor): EfileScriptView[] {
  const rows = (packet.tax_agency_records.efile as PacketEfileRow[] | undefined) ?? [];
  return rows.map((e, index) => {
    const status = String(e.status ?? "");
    return {
      index,
      date: String(e.date ?? ""),
      jurisdiction: String(e.jurisdiction ?? ""),
      status,
      submissionId: redact.text(String(e.submission_id ?? "")),
      errors: (e.errors ?? []).map((x) => ({ code: String(x.code), message: redact.text(String(x.message)) })),
      outcome: status === "accepted" ? "accepted" : status === "rejected" ? "rejected" : null,
    };
  });
}

function extensionView(packet: Packet, redact: Redactor): ExtensionView {
  const ext = redact.deep(packet.what_if.extension) as Record<string, unknown>;
  const fed = (ext.federal as Record<string, unknown> | undefined) ?? {};
  const ca = (ext.california as Record<string, unknown> | undefined) ?? {};
  const event = packet.timeline.find((e) => e.id === "extension-2026-04-14") ?? packet.timeline.find((e) => e.event === "extension_filed_with_payment") ?? null;
  const rates = (packet.post_filing_rates ?? {}) as Record<string, unknown>;
  return {
    computedAt: String(ext.computed_at ?? ""),
    basedOnVersion: String(ext.based_on_version ?? ""),
    federal: {
      estimatedTotalTax: numOrNull(fed.estimated_total_tax),
      payments: numOrNull(fed.payments),
      estimatedBalance: numOrNull(fed.estimated_balance),
      paidWithForm4868: numOrNull(fed.paid_with_form_4868),
      rule: String(fed.rule ?? ""),
    },
    california: {
      estimatedTotalTax: numOrNull(ca.estimated_total_tax),
      payments: numOrNull(ca.payments),
      estimatedBalance: numOrNull(ca.estimated_balance),
      paidWithFtb3519: numOrNull(ca.paid_with_ftb_3519),
      rule: String(ca.rule ?? ""),
    },
    timeline: event ? { id: event.id, at: event.at, detail: redact.text(event.detail ?? ""), actorName: event.actor ? actorName(packet, event.actor) : null } : null,
    payNote: redact.text(String(rates.note ?? "An extension of time to file is not an extension of time to pay.")),
    rates: {
      irsInterestAnnual: numOrNull(rates.irs_underpayment_interest_rate_annual),
      irsFailureToPayPerMonth: numOrNull(rates.irs_failure_to_pay_penalty_per_month),
      ftbInterestAnnual: numOrNull(rates.ftb_interest_rate_annual),
      ftbLatePaymentPenalty: typeof rates.ftb_late_payment_penalty === "string" ? rates.ftb_late_payment_penalty : null,
    },
  };
}

interface PacketNotice {
  id: string;
  agency?: string;
  type?: string;
  tax_year?: number;
  dated?: string;
  response_due?: string;
  summary?: string;
  status?: string;
  document?: string;
  items_under_examination?: string[];
}

export function packetNotices(packet: Packet): PacketNotice[] {
  return (packet.tax_agency_records.notices as PacketNotice[] | undefined) ?? [];
}

/** A notice is available once the replay clock reaches its date. */
export function noticeAvailableAt(n: { dated?: string }): string | null {
  return n.dated ? `${n.dated}T00:00:00Z` : null;
}

export function noticeViews(packet: Packet, redact: Redactor, asOfIso: string): NoticeView[] {
  const clock = new Date(asOfIso).getTime();
  const idx = indexPacket(packet);
  return packetNotices(packet).map((n, index) => {
    const at = noticeAvailableAt(n);
    const available = at ? new Date(at).getTime() <= clock : true;
    const doc = n.document ? idx.documents.get(n.document) : undefined;
    return {
      index,
      id: n.id,
      agency: redact.text(String(n.agency ?? "")),
      type: redact.text(String(n.type ?? "")),
      taxYear: typeof n.tax_year === "number" ? n.tax_year : null,
      dated: String(n.dated ?? ""),
      responseDue: n.response_due ?? null,
      summary: n.summary ? redact.text(n.summary) : null,
      status: n.status ? redact.text(n.status) : null,
      documentId: n.document ?? null,
      documentTitle: doc ? redact.text(doc.title) : null,
      items: (n.items_under_examination ?? []).map((i) => redact.text(i)),
      available,
      availabilityLabel: available ? `received (dated ${n.dated})` : `future, replay preview (dated ${n.dated}; the clock is at ${asOfIso.slice(0, 10)})`,
      exports: available
        ? [
            { label: "Notice bundle (HTML)", href: `/api/export/notice?notice=${encodeURIComponent(n.id)}&format=html` },
            { label: "Notice bundle (JSON)", href: `/api/export/notice?notice=${encodeURIComponent(n.id)}&format=json` },
          ]
        : [],
    };
  });
}

export function snapshotExports(kind: string, id: string): { label: string; href: string }[] {
  if (kind === "carryforward") return [{ label: "Carryforward JSON", href: `/api/export/carryforward?snapshot=${encodeURIComponent(id)}` }];
  if (kind === "client_ready" || kind === "submission" || kind === "accepted") {
    return [
      { label: "Client copy (HTML)", href: `/api/export/client-copy?snapshot=${encodeURIComponent(id)}&format=html` },
      { label: "Client copy (JSON)", href: `/api/export/client-copy?snapshot=${encodeURIComponent(id)}&format=json` },
    ];
  }
  return [];
}

/* ------------------------------------------------------------------------ */
/* The view                                                                   */
/* ------------------------------------------------------------------------ */

export async function filingView(ctx: SessionContext): Promise<FilingView> {
  if (ctx.actor.role === "client") throw new Error("The filing view is for firm staff; clients use the client portal.");
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const db = ctx.db;
  const wsId = ctx.workspace.id;
  const asOf = iso(ctx.workspace.asOf);
  const state = await loadWorkspaceState(db, ctx);
  const [readiness, submissions, approvals, snapshots, amendments, openTasks] = await Promise.all([
    filingReadiness(db, ctx, state),
    // "federal" sorts after "california", so descending jurisdiction puts the federal attempt first within a revision.
    db.select().from(t.submissions).where(eq(t.submissions.workspaceId, wsId)).orderBy(asc(t.submissions.createdRevision), desc(t.submissions.jurisdiction)),
    db.select().from(t.clientApprovals).where(eq(t.clientApprovals.workspaceId, wsId)).orderBy(asc(t.clientApprovals.createdRevision)),
    db.select().from(t.filingSnapshots).where(eq(t.filingSnapshots.workspaceId, wsId)).orderBy(desc(t.filingSnapshots.revision), desc(t.filingSnapshots.createdAt)),
    db.select().from(t.workspaces).where(eq(t.workspaces.parentWorkspaceId, wsId)).orderBy(asc(t.workspaces.createdAt)),
    db.select({ id: t.tasks.id, title: t.tasks.title }).from(t.tasks).where(eq(t.tasks.workspaceId, wsId)),
  ]);
  const snapshotHash = new Map(snapshots.map((s) => [s.id, s.contentHash]));
  const scripts = efileScripts(packet, redact);
  const wf = ctx.workspace.workflowState;
  const actor = ctx.actor;
  const awaiting = submissions.some((s) => s.status === "submitted");

  const submissionViews = submissions.map<SubmissionView>((s) => ({
    id: s.id,
    jurisdiction: s.jurisdiction,
    attempt: s.attempt,
    status: s.status,
    simulated: s.simulated,
    submissionRef: s.submissionRef,
    errors: s.errors.map((e) => ({ code: e.code, message: redact.text(e.message) })),
    submittedAt: iso(s.submittedAt),
    decidedAt: isoOrNull(s.decidedAt),
    snapshotId: s.snapshotId,
    snapshotHash: snapshotHash.get(s.snapshotId) ?? null,
    createdRevision: s.createdRevision,
    decidedRevision: s.decidedRevision,
    awaitingOutcome: s.status === "submitted",
    scripts: scripts.filter((x) => x.jurisdiction === s.jurisdiction && x.outcome !== null),
  }));

  return {
    revision: ctx.workspace.revision,
    asOf,
    workspace: {
      id: ctx.workspace.id,
      name: redact.text(ctx.workspace.name),
      state: wf,
      filingLocked: ctx.workspace.filingLocked,
      activeVersion: ctx.workspace.activeVersion,
      parentWorkspaceId: ctx.workspace.parentWorkspaceId,
      amendsSnapshotId: ctx.workspace.amendsSnapshotId,
    },
    viewer: { id: actor.id, name: actor.name, role: actor.role.replace(/_/g, " ") },
    banner: bannerFor(wf, ctx.workspace.filingLocked),
    readiness: readinessView(packet, redact, state, openTasks, readiness),
    actions: {
      present: { available: wf === "preparing" || wf === "rejected", who: "reviewer or partner", allowed: can(actor, "sign_off_reviewer") },
      submit: { available: wf === "authorized", who: "partner", allowed: can(actor, "sign_off_partner") },
      outcome: { available: awaiting, who: "reviewer or partner", allowed: can(actor, "sign_off_reviewer") },
      amend: { available: wf === "accepted", who: "partner", allowed: can(actor, "sign_off_partner") },
      nextYear: { available: true, who: "preparer, reviewer or partner", allowed: can(actor, "propose_adjustment") },
    },
    submissions: submissionViews,
    approvals: approvals.map<ApprovalView>((a) => ({
      id: a.id,
      personId: a.personId,
      personName: actorName(packet, a.personId),
      snapshotId: a.snapshotId,
      presentationHash: a.presentationHash,
      status: a.status,
      simulated: a.simulatedSignature,
      signedAt: iso(a.signedAt),
      createdRevision: a.createdRevision,
      invalidatedRevision: a.invalidatedRevision,
      invalidationReason: a.invalidationReason === null ? null : redact.text(a.invalidationReason),
    })),
    snapshots: snapshots.map<SnapshotView>((s) => ({
      id: s.id,
      kind: s.kind,
      revision: s.revision,
      contentHash: s.contentHash,
      businessTime: iso(s.businessTime),
      createdBy: s.createdBy,
      createdByName: actorName(packet, s.createdBy),
      exports: snapshotExports(s.kind, s.id),
    })),
    amendments: amendments.map((w) => ({ id: w.id, name: redact.text(w.name), createdAt: iso(w.createdAt), workflowState: w.workflowState })),
    extension: extensionView(packet, redact),
    notices: noticeViews(packet, redact, asOf),
    clientUsers: packet.firm.client_users.map((c) => ({ id: c.id, name: c.name })),
  };
}
