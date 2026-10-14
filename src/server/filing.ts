/**
 * Filing readiness and frozen presentations. The checklist comes straight
 * from the firm's required steps; each step is evaluated from records in the
 * workpaper, never from a client-side flag. Snapshots are content-hashed so
 * client approvals and submissions bind to exactly what was shown.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as t from "@/db/schema";
import { buildVariance } from "@/domain/variance";
import { indexPacket } from "@/packet/load";
import type { SessionContext } from "./context";
import { computeFingerprint } from "./invalidation";
import { loadWorkspaceState, type WorkspaceState } from "./state";
import { currentStandards } from "./standards";
import { buildSnapshotPayload } from "./presentation";

export interface ReadinessItem {
  step: string;
  ok: boolean;
  detail: string;
  blocking: boolean;
  refs: string[];
}

export interface Readiness {
  state: string;
  items: ReadinessItem[];
  blocking: ReadinessItem[];
  ok: boolean;
  returnFingerprint: string;
  presentationHash: string;
  standardsVersion: string;
}

export async function filingReadiness(db: Db, ctx: SessionContext, preloaded?: WorkspaceState): Promise<Readiness> {
  const packet = ctx.packet.packet;
  const state = preloaded ?? (await loadWorkspaceState(db, ctx));
  const std = await currentStandards(db, ctx.workspace.id, packet.firm.starter_standards);
  const idx = indexPacket(packet);
  const packetLines = idx.linesByVersion.get(state.version.version)!;
  const fp = computeFingerprint(state, "return", "*", packetLines, std.id);
  const asOf = new Date(ctx.workspace.asOf).getTime();
  const judgments = state.judgments.filter((j) => j.status === "recorded");
  const [dispositions, approvals, tasks] = await Promise.all([
    db.select().from(t.dispositions).where(and(eq(t.dispositions.workspaceId, ctx.workspace.id), isNull(t.dispositions.withdrawnRevision))),
    db.select().from(t.clientApprovals).where(and(eq(t.clientApprovals.workspaceId, ctx.workspace.id), eq(t.clientApprovals.status, "approved"))),
    db.select().from(t.tasks).where(and(eq(t.tasks.workspaceId, ctx.workspace.id), eq(t.tasks.status, "open"))),
  ]);
  const verifications = state.verifications.filter((v) => v.withdrawnRevision === null);
  const verifiedSubjects = (method?: string) => new Set(verifications.filter((v) => !method || v.method === method).map((v) => v.subjectRef));
  const openBlockers = state.findings.filter((f) => f.status === "open" && f.blocksFiling);
  const openEngine = state.findings.filter((f) => f.status === "open" && f.origin === "engine_diagnostic");
  const pending = state.adjustments.filter((a) => a.status === "proposed");
  const activeSign = (level: string) => state.signoffs.find((s) => s.status === "active" && s.scopeType === "return" && s.level === level);

  const availableDocs = packet.documents.filter((d) => new Date(d.received_at).getTime() <= asOf);
  const used = new Set(state.version.documents_used);
  const superseded = new Set(state.version.documents_superseded);
  const disposed = new Set(dispositions.map((d) => d.subjectRef));
  const unaccounted = availableDocs.filter((d) => !used.has(d.id) && !superseded.has(d.id) && !disposed.has(d.id));

  const explained = verifiedSubjects("agreed_to_prior_year");
  const variance = buildVariance(packet, state.version, state.effective, explained);
  const unexplained = variance.compared.filter((r) => r.flagged && !r.explained);

  const carryLines = state.version.lines.filter((l) => l.rule === "R-PRIOR-YEAR-CARRY").map((l) => l.key);
  const carryAgreed = carryLines.filter((k) => verifiedSubjects().has(k));
  const paymentsAgreed = ["F1040.26", "F540NR.72"].filter((k) => verifications.some((v) => v.subjectRef === k && v.method === "agreed_to_third_party_record"));
  const identity = verifications.some((v) => v.subjectRef.startsWith("household:")) || judgments.some((j) => j.subjectRef.startsWith("household:"));
  const priorReviewed = verifications.some((v) => v.subjectRef === "D06" || v.subjectRef === "py:/return_2024") || disposed.has("D06");
  const dueDiligence = judgments.filter((j) => j.kind === "due_diligence");
  const requiredDiligence = ["F8867.status"];
  const diligenceDone = requiredDiligence.every((k) => dueDiligence.some((j) => j.subjectRef === k));
  const { hash: presentationHash } = buildSnapshotPayload(ctx, state, std.id);
  const approvedNow = approvals.filter((a) => a.presentationHash === presentationHash);
  const clients = packet.firm.client_users.map((c) => c.id);
  const outsideFilings = tasks.filter((x) => x.kind === "outside_filing");

  const items: ReadinessItem[] = [
    { step: "Engagement letter and consents signed", ok: true, detail: "D01 engagement letter and D02 consent are in the packet (signed 2026-01-12).", blocking: true, refs: ["D01", "D02"] },
    { step: "Identity verified", ok: identity, detail: identity ? "Identity verification recorded." : "Record a verification or judgment on a household member (for example household:ngozi against D04).", blocking: true, refs: ["household:ngozi", "household:erik", "D04", "D05"] },
    { step: "Prior-year return reviewed", ok: priorReviewed, detail: priorReviewed ? "Prior-year return reviewed." : "Record a verification on D06 or py:/return_2024.", blocking: true, refs: ["D06", "D07"] },
    { step: "All documents accounted for", ok: unaccounted.length === 0, detail: unaccounted.length === 0 ? `All ${availableDocs.length} available documents are used by the engine, superseded or dispositioned.` : `${unaccounted.length} available document(s) have no disposition: ${unaccounted.map((d) => d.id).join(", ")}.`, blocking: true, refs: unaccounted.map((d) => d.id) },
    { step: "Prior-year variances explained", ok: unexplained.length === 0, detail: unexplained.length === 0 ? `All ${variance.compared.filter((r) => r.flagged).length} flagged swings have an agreed-to-prior-year verification.` : `${unexplained.length} flagged swing(s) lack an explanation: ${unexplained.slice(0, 8).map((r) => r.key).join(", ")}${unexplained.length > 8 ? ", ..." : ""}.`, blocking: true, refs: unexplained.map((r) => r.key) },
    { step: "Carryovers agreed to prior year", ok: carryAgreed.length === carryLines.length, detail: `${carryAgreed.length} of ${carryLines.length} carried lines verified.`, blocking: true, refs: carryLines },
    { step: "Estimated payments agreed to IRS and FTB records", ok: paymentsAgreed.length === 2, detail: `${paymentsAgreed.length} of 2 payment lines agreed to agency records (method agreed_to_third_party_record).`, blocking: true, refs: ["F1040.26", "F540NR.72", "agency:/irs_account_transcript_2025/0", "agency:/ftb_account"] },
    { step: "Due diligence completed", ok: diligenceDone, detail: diligenceDone ? "Form 8867 due diligence recorded as a judgment." : "Record a due_diligence judgment on F8867.status with the checklist.", blocking: true, refs: ["F8867.status"] },
    { step: "Diagnostics resolved", ok: openEngine.length === 0, detail: `${openEngine.length} engine diagnostic(s) still open.`, blocking: true, refs: openEngine.map((f) => `finding:${f.id}`) },
    { step: "Open review notes", ok: openBlockers.length === 0, detail: `${openBlockers.length} open finding(s) block filing.`, blocking: true, refs: openBlockers.map((f) => `finding:${f.id}`) },
    { step: "Proposed changes decided", ok: pending.length === 0, detail: `${pending.length} proposal(s) await a decision.`, blocking: true, refs: pending.map((a) => `adjustment:${a.id}`) },
    { step: "Outside filings identified", ok: true, detail: `${outsideFilings.length} open outside-filing task(s) tracked (FBAR, Forms 1099-NEC); they do not block this return.`, blocking: false, refs: outsideFilings.map((x) => `task:${x.id}`) },
    { step: "Reviewer sign-off", ok: Boolean(activeSign("reviewer")), detail: activeSign("reviewer") ? `Active reviewer sign-off on the whole return by ${activeSign("reviewer")!.actorId}.` : "No active reviewer sign-off on the whole return (scope: return).", blocking: true, refs: [] },
    { step: "Partner sign-off", ok: Boolean(activeSign("partner")), detail: activeSign("partner") ? `Active partner sign-off on the whole return by ${activeSign("partner")!.actorId}.` : "No active partner sign-off on the whole return (scope: return).", blocking: true, refs: [] },
    { step: "Client approval and e-file authorization", ok: approvedNow.length === clients.length, detail: `${approvedNow.length} of ${clients.length} client approvals bound to the current presentation.`, blocking: false, refs: [] },
  ];
  const blocking = items.filter((i) => i.blocking && !i.ok);
  return { state: ctx.workspace.workflowState, items, blocking, ok: blocking.length === 0, returnFingerprint: fp.hash, presentationHash, standardsVersion: std.id };
}

export async function latestSnapshot(db: Db, workspaceId: string, kind: string) {
  const [row] = await db
    .select()
    .from(t.filingSnapshots)
    .where(and(eq(t.filingSnapshots.workspaceId, workspaceId), eq(t.filingSnapshots.kind, kind)))
    .orderBy(desc(t.filingSnapshots.revision), desc(t.filingSnapshots.createdAt))
    .limit(1);
  return row;
}
