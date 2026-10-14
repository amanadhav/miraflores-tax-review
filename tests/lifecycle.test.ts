import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import * as t from "@/db/schema";
import type { LoadedPacket } from "@/packet/load";
import { filingReadiness } from "@/server/filing";
import { loadWorkspaceState } from "@/server/state";
import { importedDb } from "./helpers/db";
import { newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * People, filing and after: a question becomes evidence, tasks and
 * notifications persist, standards are versioned, the firm's required steps
 * gate presentation, both spouses approve a hashed presentation, submission
 * freezes the workpaper, a scripted rejection reopens it, acceptance freezes
 * it for good, and an amendment branches from the accepted snapshot.
 */
describe("people, filing and after", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let wsId: string;
  let priya: Persona;
  let daniel: Persona;
  let helen: Persona;
  let jo: Persona;
  let ngozi: Persona;
  let erik: Persona;

  beforeAll(async () => {
    const db = await importedDb();
    handle = db.handle;
    loaded = db.loaded;
    const ws = await newWorkspace(handle, loaded);
    wsId = ws.id;
    priya = await persona(handle, loaded, wsId, "st-01");
    daniel = await persona(handle, loaded, wsId, "st-02");
    helen = await persona(handle, loaded, wsId, "st-03");
    jo = await persona(handle, loaded, wsId, "st-05");
    ngozi = await persona(handle, loaded, wsId, "cu-01");
    erik = await persona(handle, loaded, wsId, "cu-02");
  });
  afterAll(async () => {
    await handle.close();
  });

  const ok = (r: { ok: boolean; error?: { message: string; code: string } }) => {
    if (!r.ok) throw new Error(`${r.error?.code}: ${r.error?.message}`);
    return r as { ok: true; result: unknown; revision: number };
  };

  let requestId: string;
  let replyRef: string;
  let attachmentRef: string;

  it("a client question is answered with an attachment and the answer becomes citable evidence", async () => {
    const created = ok(await priya.run("create_request", {
      kind: "client_question",
      title: "Cost basis of the BTC lot moved to Coinhaven",
      body: "Where and when was the 0.05 BTC in lot C6 bought, and for how much?",
      toActorId: "cu-01",
      refs: ["F8949.H.C6"],
      dueAt: "2026-06-30T00:00:00Z",
    }));
    requestId = (created.result as { requestId: string }).requestId;
    const inbox = await handle.db.select().from(t.notifications).where(and(eq(t.notifications.workspaceId, wsId), eq(t.notifications.recipientId, "cu-01")));
    expect(inbox).toHaveLength(1);

    const att = ok(await ngozi.run("add_attachment", {
      kind: "file",
      filename: "old-exchange-confirmation.txt",
      contentType: "text/plain",
      content: "Purchase 0.05 BTC on 2021-03-12 for 3,050.00 USD at DeltaCoin (closed 2024).",
      requestId,
    }));
    attachmentRef = (att.result as { evidenceRef: string }).evidenceRef;
    const reply = ok(await ngozi.run("reply_request", { requestId, body: "Bought March 2021 for about 3,050 on an exchange that has since closed; confirmation attached.", attachmentIds: [attachmentRef.split(":")[1]] }));
    replyRef = (reply.result as { evidenceRef: string }).evidenceRef;

    // Erik cannot answer Ngozi's request.
    const wrong = await erik.run("reply_request", { requestId, body: "me too" });
    expect(wrong.ok).toBe(false);

    const bad = await priya.run("propose_adjustment", { targetRef: "F8949.H.C6", kind: "value", proposedValue: 2275, reason: "basis per client", evidenceRefs: ["reply:nope"], category: "stcg" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toMatch(/do not exist here/);

    const good = ok(await priya.run("propose_adjustment", {
      targetRef: "F8949.H.C6",
      kind: "value",
      proposedValue: 2275,
      reason: "Client states a March 2021 purchase for about 3,050; basis substantiation is a third-party confirmation of a closed exchange.",
      evidenceRefs: [replyRef, attachmentRef, "F8949.H.C6"],
      category: "stcg",
    }));
    expect((good.result as { requiresPartner: boolean }).requiresPartner).toBe(true);
    ok(await daniel.run("decide_adjustment", { adjustmentId: (good.result as { adjustmentId: string }).adjustmentId, decision: "reject", note: "Holding period changes to long-term and the lot needs a judgment on source quality; keep as an open item." }));
    ok(await priya.run("resolve_request", { requestId, resolution: "Answered; basis treatment recorded as a judgment item." }));
  });

  it("an outside filing task cannot be closed on a note alone", async () => {
    const created = ok(await daniel.run("create_task", {
      kind: "outside_filing",
      title: "Forms 1099-NEC for two contractors (late)",
      detail: "Client paid two contractors over 600 by ACH and filed nothing; refer and track.",
      ownerId: "st-01",
      dueAt: "2026-07-15T00:00:00Z",
      refs: ["D27", "call-01"],
    }));
    const taskId = (created.result as { taskId: string }).taskId;
    const noEvidence = await priya.run("complete_task", { taskId, note: "Told the client to file." });
    expect(noEvidence.ok).toBe(false);
    const ack = ok(await priya.run("add_attachment", { kind: "note", filename: "client-ack.txt", contentType: "text/plain", content: "Erik confirmed by phone on 2026-06-24 that the 1099-NEC forms were filed through a payroll service.", linkedRefs: [`task:${taskId}`] }));
    ok(await priya.run("complete_task", { taskId, note: "Client acknowledgment on file.", evidenceRefs: [(ack.result as { evidenceRef: string }).evidenceRef] }));
    const inbox = await handle.db.select().from(t.notifications).where(and(eq(t.notifications.workspaceId, wsId), eq(t.notifications.recipientId, "st-02")));
    expect(inbox.some((n) => n.kind === "task_update")).toBe(true);
    ok(await priya.run("log_time", { area: "business", hours: 1.5, workDate: "2026-06-23", note: "Contractor follow-up" }));
  });

  it("publishing a new firm standard reopens every active sign-off with that reason", async () => {
    ok(await daniel.run("sign_off", { scopeType: "area", scopeId: "california", level: "reviewer" }));
    ok(await jo.run("update_standards", { note: "Add a required step for contractor reporting.", requiredSteps: [...loaded.packet.firm.starter_standards.required_steps, "Contractor information returns reviewed"] }));
    const rows = await handle.db.select().from(t.signoffs).where(eq(t.signoffs.workspaceId, wsId));
    const ca = rows.find((s) => s.scopeId === "california")!;
    expect(ca.status).toBe("stale");
    expect(ca.invalidationReason).toMatch(/firm standard in force changed/);
  });

  it("presentation is refused until every required step is satisfied, then produces a hashed snapshot", async () => {
    const early = await daniel.run("present_to_client", {});
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.error.message).toMatch(/Not ready/);

    // Work through the firm's required steps with real records.
    const state = await loadWorkspaceState(handle.db, priya.ctx);
    for (const f of state.findings.filter((x) => x.status === "open")) {
      ok(await daniel.run("resolve_finding", { findingId: f.id, outcome: "resolved", resolution: `Reviewed for the demo: ${f.title}.` }));
    }
    ok(await priya.run("add_verification", { subjectRef: "household:ngozi", method: "agreed_to_source_document", evidenceRefs: ["D04"], conclusion: "agrees", note: "Identity agreed to the Texas license." }));
    ok(await priya.run("add_verification", { subjectRef: "D06", method: "agreed_to_prior_year", evidenceRefs: ["D06"], conclusion: "agrees", note: "Prior-year return reviewed." }));
    ok(await priya.run("add_verification", { subjectRef: "F1040.26", method: "agreed_to_third_party_record", evidenceRefs: ["agency:/irs_account_transcript_2025/0"], conclusion: "disagrees", note: "Transcript shows 12,000; questionnaire claims 13,000." }));
    ok(await priya.run("add_verification", { subjectRef: "F540NR.72", method: "agreed_to_third_party_record", evidenceRefs: ["agency:/ftb_account"], conclusion: "disagrees", note: "FTB credits 10,500 to 2025." }));
    ok(await priya.run("record_judgment", {
      kind: "due_diligence",
      subjectRef: "F8867.status",
      title: "Form 8867 due diligence for CTC and ODC",
      authority: "IRC 6695(g); Form 8867 instructions",
      applicability: "Child tax credit claimed for Theo; credit for other dependents for Ada.",
      conclusion: "Checklist completed from the organizer, identity documents and school records.",
      evidenceRefs: ["D04", "D59", "qa-04"],
      checklist: [{ item: "Residency of qualifying child confirmed", done: true }, { item: "Relationship confirmed", done: true }, { item: "Knowledge requirement questions documented", done: true }],
    }));
    let readiness = await filingReadiness(handle.db, (await priya.refresh()));
    const docs = readiness.items.find((i) => i.step === "All documents accounted for")!;
    if (!docs.ok) ok(await priya.run("batch_disposition", { subjectRefs: docs.refs, disposition: "reviewed_no_use", note: "Reviewed; not an input to the computed return." }));
    const swings = readiness.items.find((i) => i.step === "Prior-year variances explained")!;
    if (!swings.ok) {
      const batch = ok(await priya.run("batch_verify", { subjectRefs: swings.refs, method: "agreed_to_prior_year", conclusion: "agrees", note: "Swing explained by the move, the sale and the job change." }));
      // Undo and redo the batch to prove the batch undo path.
      ok(await priya.run("undo_batch", { batchId: (batch.result as { batchId: string }).batchId }));
      ok(await priya.run("batch_verify", { subjectRefs: swings.refs, method: "agreed_to_prior_year", conclusion: "agrees", note: "Swing explained by the move, the sale and the job change." }));
    }
    const carry = readiness.items.find((i) => i.step === "Carryovers agreed to prior year")!;
    if (!carry.ok) ok(await priya.run("batch_verify", { subjectRefs: carry.refs, method: "agreed_to_prior_year", conclusion: "agrees", evidenceRefs: ["py:/carryovers_into_2025"] }));
    readiness = await filingReadiness(handle.db, (await priya.refresh()));
    expect(readiness.blocking.map((b) => b.step)).toEqual(["Reviewer sign-off", "Partner sign-off"]);

    ok(await daniel.run("sign_off", { scopeType: "return", scopeId: "*", level: "reviewer" }));
    const self = await priya.run("sign_off", { scopeType: "return", scopeId: "*", level: "reviewer" });
    expect(self.ok).toBe(false);
    ok(await helen.run("sign_off", { scopeType: "return", scopeId: "*", level: "partner" }));
    const presented = ok(await daniel.run("present_to_client", { note: "Demo presentation" }));
    expect((presented.result as { contentHash: string }).contentHash).toHaveLength(64);
    expect((await daniel.refresh()).workspace.workflowState).toBe("ready_for_client");
  });

  let snapshotId: string;

  it("evidence-only changes reopen sign-offs; a change to the presented return reopens the approval", async () => {
    const snap = await handle.db.select().from(t.filingSnapshots).where(and(eq(t.filingSnapshots.workspaceId, wsId), eq(t.filingSnapshots.kind, "client_ready")));
    snapshotId = snap[snap.length - 1].id;
    const staff = await priya.run("approve_return", { snapshotId, acknowledgement: true });
    expect(staff.ok).toBe(false);
    ok(await ngozi.run("approve_return", { snapshotId, acknowledgement: true }));

    // Same numbers, new anchor: the reviewer and partner sign-offs reopen, the client presentation is unchanged.
    ok(await priya.run("add_anchor", { subjectRef: "F2441.1b", documentId: "D62", page: 1, textSpan: "Tax ID 74-3829156" }));
    let approvals = await handle.db.select().from(t.clientApprovals).where(eq(t.clientApprovals.workspaceId, wsId));
    expect(approvals[0].status).toBe("approved");
    const returnSignoffs = await handle.db.select().from(t.signoffs).where(and(eq(t.signoffs.workspaceId, wsId), eq(t.signoffs.scopeType, "return")));
    expect(returnSignoffs.filter((x) => x.status === "active")).toHaveLength(0);
    expect(returnSignoffs.find((x) => x.status === "stale")?.invalidationReason).toMatch(/evidence link, verification or anchor/);

    // A change to what the client saw: the care provider's name is corrected (E16). The approval reopens and the state falls back.
    const label = ok(await priya.run("propose_adjustment", {
      targetRef: "F2441.1a",
      kind: "label",
      proposedLabel: "Care provider: Bright Oak Kids Club, tax ID 68-0412257",
      reason: "The provider statement D61 names the provider Bright Oak Kids Club, not Bright Oak Preschool.",
      evidenceRefs: ["doc:D61#page1"],
    }));
    ok(await daniel.run("decide_adjustment", { adjustmentId: (label.result as { adjustmentId: string }).adjustmentId, decision: "accept" }));
    approvals = await handle.db.select().from(t.clientApprovals).where(eq(t.clientApprovals.workspaceId, wsId));
    expect(approvals[0].status).toBe("invalidated");
    expect(approvals[0].invalidationReason).toMatch(/presentation changed/);
    expect((await priya.refresh()).workspace.workflowState).toBe("preparing");
    const late = await erik.run("approve_return", { snapshotId, acknowledgement: true });
    expect(late.ok).toBe(false);
  });

  it("re-sign, re-present, both approve, submit: federal transmitted, California held, workpaper frozen", async () => {
    ok(await daniel.run("sign_off", { scopeType: "return", scopeId: "*", level: "reviewer" }));
    ok(await helen.run("sign_off", { scopeType: "return", scopeId: "*", level: "partner" }));
    ok(await daniel.run("present_to_client", {}));
    const snaps = await handle.db.select().from(t.filingSnapshots).where(and(eq(t.filingSnapshots.workspaceId, wsId), eq(t.filingSnapshots.kind, "client_ready")));
    snapshotId = snaps[snaps.length - 1].id;
    ok(await ngozi.run("approve_return", { snapshotId, acknowledgement: true }));
    const done = ok(await erik.run("approve_return", { snapshotId, acknowledgement: true }));
    expect((done.result as { complete: boolean }).complete).toBe(true);
    expect((await erik.refresh()).workspace.workflowState).toBe("authorized");

    const notPartner = await daniel.run("submit_filing", {});
    expect(notPartner.ok).toBe(false);
    const submitted = ok(await helen.run("submit_filing", {}));
    const subs = (submitted.result as { submissions: { jurisdiction: string; status: string }[] }).submissions;
    expect(subs.find((s) => s.jurisdiction === "federal")?.status).toBe("submitted");
    expect(subs.find((s) => s.jurisdiction === "california")?.status).toBe("not_transmitted");
    const ws = (await helen.refresh()).workspace;
    expect(ws.workflowState).toBe("submitted");
    expect(ws.filingLocked).toBe(true);
    const frozen = await priya.run("add_verification", { subjectRef: "SchC.1", method: "recalculated", conclusion: "agrees" });
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) expect(frozen.error.code).toBe("filing_locked");
  });

  it("the scripted federal rejection unlocks the workpaper; corrections need fresh sign-offs and approvals", async () => {
    const subs = await handle.db.select().from(t.submissions).where(eq(t.submissions.workspaceId, wsId));
    const federal = subs.find((s) => s.jurisdiction === "federal")!;
    ok(await helen.run("record_submission_outcome", { submissionId: federal.id, outcome: "rejected", fromPacketEfileIndex: 0 }));
    const after = await handle.db.select().from(t.submissions).where(eq(t.submissions.id, federal.id));
    expect(after[0].errors[0].code).toBe("R0000-504-02");
    const ws = (await helen.refresh()).workspace;
    expect(ws.workflowState).toBe("rejected");
    expect(ws.filingLocked).toBe(false);

    ok(await priya.run("advance_time", { to: "2026-07-13T20:00:00Z" }));
    ok(await priya.run("record_judgment", {
      kind: "judgment",
      subjectRef: "household:theo",
      title: "Theo's identifier: organizer typo corrected from the Social Security card",
      authority: "Form 1040 instructions, dependent TIN must match SSA records; e-file rule R0000-504-02",
      applicability: "Dependent 2 on the 2025 return.",
      conclusion: "The organizer digits were transposed; the SSA card (D71) and the prior return (D06) agree on the correct number.",
      evidenceRefs: ["D71", "msg-10", "D06"],
    }));
    // D71 only became available when the clock moved; completeness is re-evaluated at the new date.
    ok(await priya.run("record_disposition", { subjectRef: "D71", disposition: "used", note: "Supports the identifier correction judgment." }));
    const stale = await handle.db.select().from(t.signoffs).where(and(eq(t.signoffs.workspaceId, wsId), eq(t.signoffs.scopeType, "return")));
    expect(stale.filter((s) => s.status === "active")).toHaveLength(0);
    ok(await daniel.run("sign_off", { scopeType: "return", scopeId: "*", level: "reviewer" }));
    ok(await helen.run("sign_off", { scopeType: "return", scopeId: "*", level: "partner" }));
    ok(await daniel.run("present_to_client", {}));
    const snaps = await handle.db.select().from(t.filingSnapshots).where(and(eq(t.filingSnapshots.workspaceId, wsId), eq(t.filingSnapshots.kind, "client_ready")));
    snapshotId = snaps[snaps.length - 1].id;
    ok(await ngozi.run("approve_return", { snapshotId, acknowledgement: true }));
    ok(await erik.run("approve_return", { snapshotId, acknowledgement: true }));
    ok(await helen.run("submit_filing", {}));
  });

  it("acceptance of both returns freezes the file; later work goes to an amendment and next year", async () => {
    const subs = await handle.db.select().from(t.submissions).where(eq(t.submissions.workspaceId, wsId));
    const federal2 = subs.find((s) => s.jurisdiction === "federal" && s.attempt === 2)!;
    ok(await helen.run("record_submission_outcome", { submissionId: federal2.id, outcome: "accepted" }));
    const afterFed = await handle.db.select().from(t.submissions).where(eq(t.submissions.workspaceId, wsId));
    const ca2 = afterFed.find((s) => s.jurisdiction === "california" && s.attempt === 2)!;
    expect(ca2.status).toBe("submitted");
    ok(await helen.run("record_submission_outcome", { submissionId: ca2.id, outcome: "accepted" }));
    const ws = (await helen.refresh()).workspace;
    expect(ws.workflowState).toBe("accepted");
    expect(ws.filingLocked).toBe(true);
    const accepted = await handle.db.select().from(t.filingSnapshots).where(and(eq(t.filingSnapshots.workspaceId, wsId), eq(t.filingSnapshots.kind, "accepted")));
    expect(accepted).toHaveLength(1);
    const first = afterFed.find((s) => s.attempt === 1 && s.jurisdiction === "federal")!;
    expect(first.status).toBe("rejected");

    const edit = await priya.run("propose_adjustment", { targetRef: "SchC.1", kind: "value", proposedValue: 151300, reason: "late correction", evidenceRefs: ["doc:D14#page1"], category: "schc_profit" });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.error.code).toBe("filing_locked");

    const amend = ok(await helen.run("start_amendment", { reason: "Correct Schedule C receipts after the client's books review." }));
    const newWs = (amend.result as { amendmentWorkspaceId: string }).amendmentWorkspaceId;
    const [branch] = await handle.db.select().from(t.workspaces).where(eq(t.workspaces.id, newWs));
    expect(branch.parentWorkspaceId).toBe(wsId);
    expect(branch.workflowState).toBe("amending");
    expect(branch.filingLocked).toBe(false);
    const next = ok(await priya.run("start_next_year", {}));
    expect((next.result as { planningTaskId: string }).planningTaskId).toMatch(/^tsk_/);
  });
});
