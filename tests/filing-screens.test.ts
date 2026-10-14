import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import * as t from "@/db/schema";
import type { LoadedPacket } from "@/packet/load";
import { attachmentForViewer } from "@/server/export";
import { filingReadiness } from "@/server/filing";
import { clientView } from "@/server/queries/client";
import { filingView } from "@/server/queries/filing";
import { loadWorkspaceState } from "@/server/state";
import { importedDb } from "./helpers/db";
import { newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * The Filing screen and the client portal read models, driven through the
 * same lifecycle as tests/lifecycle.test.ts: the view offers exactly the
 * actions each state allows, the readiness list is evaluated from records,
 * and the client view never carries findings, sign-offs or audit history.
 */
describe("filing and client screens", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let wsId: string;
  let priya: Persona;
  let daniel: Persona;
  let helen: Persona;
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

  const INTERNAL = /finding|signoff|sign-off|audit|judgment|scope_contribution|verification/i;

  it("preparing: banner, readiness evaluated from records with resolvable refs, and only the present action", async () => {
    const v = await filingView((await priya.refresh()));
    expect(v.banner.state).toBe("preparing");
    expect(v.banner.frozen).toBe(false);
    expect(v.actions.present.available).toBe(true);
    expect(v.actions.present.allowed).toBe(false); // a preparer cannot present
    expect((await filingView((await daniel.refresh()))).actions.present.allowed).toBe(true);
    expect(v.actions.submit.available).toBe(false);
    expect(v.actions.outcome.available).toBe(false);
    expect(v.actions.amend.available).toBe(false);
    expect(v.readiness.ok).toBe(false);
    expect(v.readiness.items.map((i) => i.step)).toEqual(expect.arrayContaining(["Identity verified", "Reviewer sign-off", "Partner sign-off", "Client approval and e-file authorization"]));
    const identity = v.readiness.items.find((i) => i.step === "Identity verified")!;
    expect(identity.ok).toBe(false);
    expect(identity.blocking).toBe(true);
    expect(identity.refs.find((r) => r.ref === "household:ngozi")).toMatchObject({ found: true, kind: "household" });
    const diagnostics = v.readiness.items.find((i) => i.step === "Diagnostics resolved")!;
    expect(diagnostics.refs.every((r) => r.ref.startsWith("finding:") && r.found)).toBe(true);
    const outside = v.readiness.items.find((i) => i.step === "Outside filings identified")!;
    expect(outside.blocking).toBe(false);
    expect(v.submissions).toHaveLength(0);
    expect(v.snapshots).toHaveLength(0);

    // Extension record and notices come from the packet, filtered by the clock.
    expect(v.extension.basedOnVersion).toBe("v2");
    expect(v.extension.federal.paidWithForm4868).toBe(36000);
    expect(v.extension.california.paidWithFtb3519).toBe(0);
    expect(v.extension.federal.rule).toMatch(/rounded up/);
    expect(v.extension.payNote).toMatch(/not an extension of time to pay/);
    const letter = v.notices.find((n) => n.id === "N-2025-L566")!;
    expect(letter.available).toBe(false);
    expect(letter.availabilityLabel).toMatch(/future, replay preview/);
    expect(letter.exports).toHaveLength(0);
    const cp2000 = v.notices.find((n) => n.id === "N-2023-CP2000")!;
    expect(cp2000.available).toBe(true);
    expect(cp2000.exports.map((e) => e.href)).toContain("/api/export/notice?notice=N-2023-CP2000&format=html");

    // The filing view is for firm staff.
    await expect(filingView((await ngozi.refresh()))).rejects.toThrow(/client portal/);
  });

  let requestId: string;
  let attachmentId: string;

  it("a client question with an attachment reaches only its recipient, and attachments follow the same rule", async () => {
    const created = ok(await priya.run("create_request", {
      kind: "client_question",
      title: "Cost basis of the BTC lot moved to Coinhaven",
      body: "Where and when was the 0.05 BTC in lot C6 bought, and for how much?",
      toActorId: "cu-01",
      refs: ["F8949.H.C6"],
      dueAt: "2026-06-30T00:00:00Z",
    }));
    requestId = (created.result as { requestId: string }).requestId;

    let mine = await clientView((await ngozi.refresh()));
    expect(mine.inbox).toHaveLength(1);
    expect(mine.unreadCount).toBe(1);
    expect(mine.inbox[0].requestIds).toEqual([requestId]);
    expect(mine.requests).toHaveLength(1);
    expect(mine.requests[0].open).toBe(true);
    expect(mine.requests[0].about[0]).toMatch(/F8949 line H\.C6/);
    expect(mine.presentation).toBeNull();
    const other = await clientView((await erik.refresh()));
    expect(other.requests).toHaveLength(0);
    expect(other.inbox).toHaveLength(0);

    const att = ok(await ngozi.run("add_attachment", {
      kind: "file",
      filename: "old-exchange-confirmation.txt",
      contentType: "text/plain",
      content: "Purchase 0.05 BTC on 2021-03-12 for 3,050.00 USD at DeltaCoin (closed 2024).",
      requestId,
    }));
    attachmentId = (att.result as { attachmentId: string }).attachmentId;
    ok(await ngozi.run("reply_request", { requestId, body: "Bought March 2021 for about 3,050; confirmation attached.", attachmentIds: [attachmentId] }));
    mine = await clientView((await ngozi.refresh()));
    const thread = mine.requests[0];
    expect(thread.status).toBe("answered");
    expect(thread.replies).toHaveLength(1);
    expect(thread.replies[0].mine).toBe(true);
    expect(thread.replies[0].attachments[0]).toMatchObject({ id: attachmentId, filename: "old-exchange-confirmation.txt", href: `/api/attachments/${attachmentId}` });
    expect(thread.pendingAttachments).toHaveLength(0);

    const content = await attachmentForViewer((await ngozi.refresh()), attachmentId);
    expect(content.contentType).toBe("text/plain");
    expect(content.bytes.toString("utf8")).toMatch(/Purchase 0\.05 BTC/);
    await expect(attachmentForViewer((await erik.refresh()), attachmentId)).rejects.toThrow(/not part of your requests/);
    const staff = await attachmentForViewer((await daniel.refresh()), attachmentId);
    expect(staff.bytes.length).toBe(content.bytes.length);
    await expect(attachmentForViewer((await daniel.refresh()), "att_missing")).rejects.toThrow(/No such attachment/);

    ok(await ngozi.run("mark_notifications_read", { notificationIds: [mine.inbox[0].id] }));
    expect((await clientView((await ngozi.refresh()))).unreadCount).toBe(0);
    ok(await priya.run("resolve_request", { requestId, resolution: "Answered; basis treatment recorded as an open item." }));
    expect((await clientView((await ngozi.refresh()))).requests[0].open).toBe(false);
  });

  let snapshotId: string;

  it("working through the required steps turns the checklist green; presenting offers approval to the clients only", async () => {
    const state = await loadWorkspaceState(handle.db, (await priya.refresh()));
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
    let readiness = await filingReadiness(handle.db, await priya.refresh());
    const docs = readiness.items.find((i) => i.step === "All documents accounted for")!;
    if (!docs.ok) ok(await priya.run("batch_disposition", { subjectRefs: docs.refs, disposition: "reviewed_no_use", note: "Reviewed; not an input to the computed return." }));
    const swings = readiness.items.find((i) => i.step === "Prior-year variances explained")!;
    if (!swings.ok) ok(await priya.run("batch_verify", { subjectRefs: swings.refs, method: "agreed_to_prior_year", conclusion: "agrees", note: "Swing explained by the move, the sale and the job change." }));
    const carry = readiness.items.find((i) => i.step === "Carryovers agreed to prior year")!;
    if (!carry.ok) ok(await priya.run("batch_verify", { subjectRefs: carry.refs, method: "agreed_to_prior_year", conclusion: "agrees", evidenceRefs: ["py:/carryovers_into_2025"] }));
    readiness = await filingReadiness(handle.db, await priya.refresh());
    expect(readiness.blocking.map((b) => b.step)).toEqual(["Reviewer sign-off", "Partner sign-off"]);

    let v = await filingView((await priya.refresh()));
    expect(v.readiness.blockingCount).toBe(2);
    expect(v.readiness.items.filter((i) => i.blocking && !i.ok).map((i) => i.step)).toEqual(["Reviewer sign-off", "Partner sign-off"]);

    ok(await daniel.run("sign_off", { scopeType: "return", scopeId: "*", level: "reviewer" }));
    ok(await helen.run("sign_off", { scopeType: "return", scopeId: "*", level: "partner" }));
    v = await filingView((await priya.refresh()));
    expect(v.readiness.ok).toBe(true);
    ok(await daniel.run("present_to_client", { note: "Demo presentation" }));

    v = await filingView((await priya.refresh()));
    expect(v.banner.state).toBe("ready_for_client");
    expect(v.actions.present.available).toBe(false);
    expect(v.actions.submit.available).toBe(false);
    expect(v.snapshots).toHaveLength(1);
    expect(v.snapshots[0].kind).toBe("client_ready");
    expect(v.snapshots[0].exports.map((e) => e.label)).toEqual(["Client copy (HTML)", "Client copy (JSON)"]);
    snapshotId = v.snapshots[0].id;
    expect(v.snapshots[0].contentHash).toBe(v.readiness.presentationHash);

    const cv = await clientView((await ngozi.refresh()));
    expect(cv.workspace.state).toBe("ready_for_client");
    expect(cv.inbox.some((n) => n.kind === "approval_request")).toBe(true);
    expect(cv.presentation).not.toBeNull();
    expect(cv.presentation!.snapshotId).toBe(snapshotId);
    expect(cv.presentation!.canApprove).toBe(true);
    expect(cv.presentation!.approvals.map((a) => a.status)).toEqual(["pending", "pending"]);
    expect(cv.presentation!.baseline.federal.total_tax).toBe(81962);
    expect(cv.presentation!.note).toMatch(/no recomputed final tax/);
    expect(cv.clientCopy?.htmlHref).toBe(`/api/export/client-copy?snapshot=${snapshotId}&format=html`);
    // Nothing internal: no findings, sign-offs, judgments or audit history in the client view.
    expect(JSON.stringify(cv)).not.toMatch(INTERNAL);
    expect(JSON.stringify(await clientView((await erik.refresh())))).not.toMatch(INTERNAL);
  });

  it("both approvals authorize the return; submit is offered to a partner; submission freezes and shows the attempts", async () => {
    ok(await ngozi.run("approve_return", { snapshotId, acknowledgement: true }));
    let cv = await clientView((await ngozi.refresh()));
    expect(cv.presentation!.canApprove).toBe(false);
    expect(cv.presentation!.approveBlockedReason).toMatch(/already approved/);
    expect(cv.presentation!.approvals.find((a) => a.mine)!.status).toBe("approved");
    cv = await clientView((await erik.refresh()));
    expect(cv.presentation!.canApprove).toBe(true);
    ok(await erik.run("approve_return", { snapshotId, acknowledgement: true }));

    let v = await filingView((await daniel.refresh()));
    expect(v.banner.state).toBe("authorized");
    expect(v.actions.submit.available).toBe(true);
    expect(v.actions.submit.allowed).toBe(false);
    expect((await filingView((await helen.refresh()))).actions.submit.allowed).toBe(true);
    expect(v.approvals).toHaveLength(2);
    expect(v.approvals.every((a) => a.status === "approved" && a.simulated && a.presentationHash === v.snapshots[0].contentHash)).toBe(true);
    const names = v.approvals.map((a) => a.personName).sort();
    expect(names).toEqual(["Erik Lindqvist", "Ngozi Okafor"]);

    ok(await helen.run("submit_filing", {}));
    v = await filingView((await helen.refresh()));
    expect(v.banner.state).toBe("submitted");
    expect(v.banner.frozen).toBe(true);
    expect(v.actions.submit.available).toBe(false);
    expect(v.actions.outcome.available).toBe(true);
    expect(v.submissions).toHaveLength(2);
    const federal = v.submissions.find((s) => s.jurisdiction === "federal")!;
    const california = v.submissions.find((s) => s.jurisdiction === "california")!;
    expect(federal).toMatchObject({ attempt: 1, status: "submitted", simulated: true, awaitingOutcome: true });
    expect(federal.submissionRef).toMatch(/^SIM-/);
    expect(federal.scripts.map((s) => [s.index, s.outcome])).toEqual([
      [0, "rejected"],
      [2, "accepted"],
    ]);
    expect(federal.scripts[0].errors[0].code).toBe("R0000-504-02");
    expect(california).toMatchObject({ status: "not_transmitted", awaitingOutcome: false });
    expect(california.errors[0].code).toBe("STATE-HOLD");
    expect(v.snapshots.map((s) => s.kind)).toEqual(["submission", "client_ready"]);
    expect(federal.snapshotHash).toBe(v.snapshots[0].contentHash);

    cv = await clientView((await ngozi.refresh()));
    expect(cv.filings.map((f) => [f.jurisdiction, f.status])).toEqual([
      ["federal", "submitted"],
      ["california", "not_transmitted"],
    ]);
    expect(cv.clientCopy?.kind).toBe("submission");
    expect(JSON.stringify(cv)).not.toMatch(INTERNAL);
  });

  it("the packet's scripted rejection unlocks the workpaper and re-offers presentation", async () => {
    let v = await filingView((await helen.refresh()));
    const federal = v.submissions.find((s) => s.jurisdiction === "federal" && s.awaitingOutcome)!;
    ok(await helen.run("record_submission_outcome", { submissionId: federal.id, outcome: "rejected", fromPacketEfileIndex: 0 }));
    v = await filingView((await helen.refresh()));
    expect(v.banner.state).toBe("rejected");
    expect(v.banner.frozen).toBe(false);
    expect(v.actions.present.available).toBe(true);
    expect(v.actions.outcome.available).toBe(false);
    const rejected = v.submissions.find((s) => s.id === federal.id)!;
    expect(rejected.status).toBe("rejected");
    expect(rejected.errors[0]).toMatchObject({ code: "R0000-504-02" });
    expect(rejected.decidedAt).not.toBeNull();

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
    ok(await priya.run("record_disposition", { subjectRef: "D71", disposition: "used", note: "Supports the identifier correction judgment." }));
    v = await filingView((await helen.refresh()));
    // The presentation changed, so the approvals reopened with a stated reason.
    expect(v.approvals.every((a) => a.status === "invalidated" && /presentation changed/.test(a.invalidationReason ?? ""))).toBe(true);
    const cv = await clientView((await erik.refresh()));
    expect(cv.presentation!.approvals.every((a) => a.status === "invalidated")).toBe(true);

    ok(await daniel.run("sign_off", { scopeType: "return", scopeId: "*", level: "reviewer" }));
    ok(await helen.run("sign_off", { scopeType: "return", scopeId: "*", level: "partner" }));
    ok(await daniel.run("present_to_client", {}));
    const snaps = await handle.db.select().from(t.filingSnapshots).where(and(eq(t.filingSnapshots.workspaceId, wsId), eq(t.filingSnapshots.kind, "client_ready")));
    snapshotId = snaps[snaps.length - 1].id;
    expect((await clientView((await ngozi.refresh()))).presentation!.snapshotId).toBe(snapshotId);
    ok(await ngozi.run("approve_return", { snapshotId, acknowledgement: true }));
    ok(await erik.run("approve_return", { snapshotId, acknowledgement: true }));
    ok(await helen.run("submit_filing", {}));
  });

  it("acceptance of both returns freezes the file and offers amendment and next year; the client sees the filings and a copy", async () => {
    let v = await filingView((await helen.refresh()));
    const federal2 = v.submissions.find((s) => s.jurisdiction === "federal" && s.attempt === 2)!;
    expect(federal2.scripts.find((s) => s.index === 2)?.outcome).toBe("accepted");
    ok(await helen.run("record_submission_outcome", { submissionId: federal2.id, outcome: "accepted", fromPacketEfileIndex: 2 }));
    v = await filingView((await helen.refresh()));
    const ca2 = v.submissions.find((s) => s.jurisdiction === "california" && s.attempt === 2)!;
    expect(ca2.awaitingOutcome).toBe(true);
    expect(ca2.scripts.map((s) => s.index)).toEqual([3]);
    ok(await helen.run("record_submission_outcome", { submissionId: ca2.id, outcome: "accepted", fromPacketEfileIndex: 3 }));

    v = await filingView((await helen.refresh()));
    expect(v.banner.state).toBe("accepted");
    expect(v.banner.frozen).toBe(true);
    expect(v.actions.amend).toMatchObject({ available: true, allowed: true });
    expect((await filingView((await daniel.refresh()))).actions.amend.allowed).toBe(false);
    expect(v.actions.nextYear.available).toBe(true);
    expect(v.actions.outcome.available).toBe(false);
    expect(v.actions.present.available).toBe(false);
    expect(v.snapshots[0].kind).toBe("accepted");
    expect(v.submissions.filter((s) => s.status === "accepted")).toHaveLength(2);
    expect(v.submissions.filter((s) => s.status === "rejected")).toHaveLength(1);

    const amend = ok(await helen.run("start_amendment", { reason: "Correct Schedule C receipts after the client's books review." }));
    const newWs = (amend.result as { amendmentWorkspaceId: string }).amendmentWorkspaceId;
    const next = ok(await priya.run("start_next_year", {}));
    v = await filingView((await helen.refresh()));
    expect(v.amendments.map((a) => a.id)).toEqual([newWs]);
    expect(v.amendments[0].workflowState).toBe("amending");
    const carry = v.snapshots.find((s) => s.kind === "carryforward")!;
    expect(carry.id).toBe((next.result as { carryforwardId: string }).carryforwardId);
    expect(carry.exports).toEqual([{ label: "Carryforward JSON", href: `/api/export/carryforward?snapshot=${carry.id}` }]);

    const branch = await persona(handle, loaded, newWs, "st-02");
    const bv = await filingView((await branch.refresh()));
    expect(bv.banner.state).toBe("amending");
    expect(bv.workspace.parentWorkspaceId).toBe(wsId);
    expect(bv.banner.frozen).toBe(false);

    const cv = await clientView((await ngozi.refresh()));
    expect(cv.workspace.state).toBe("accepted");
    expect(cv.filings.filter((f) => f.status === "accepted")).toHaveLength(2);
    expect(cv.filings.every((f) => f.simulated)).toBe(true);
    expect(cv.clientCopy?.kind).toBe("accepted");
    expect(cv.presentation!.canApprove).toBe(false);
    expect(JSON.stringify(cv)).not.toMatch(INTERNAL);
  });
});
