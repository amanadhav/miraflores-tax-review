import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db/client";
import type { LoadedPacket } from "@/packet/load";
import { looksSensitive } from "@/domain/redaction";
import { inboxView, isRefusal, requestDetail, requestsView, tasksView, timeView, unreadCount, type RequestsView, type TasksView, type TimeView } from "@/server/queries/people";
import { judgmentsView } from "@/server/queries/judgments";
import { importedDb } from "./helpers/db";
import { newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * People: a question becomes evidence through its reply and attachment,
 * due dates are judged at the replay clock, the inbox count moves when
 * notifications are read, and hours are measured against the firm budget.
 */
describe("people screens", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let wsId: string;
  let priya: Persona;
  let daniel: Persona;
  let ngozi: Persona;

  beforeAll(async () => {
    const db = await importedDb();
    handle = db.handle;
    loaded = db.loaded;
    const ws = await newWorkspace(handle, loaded);
    wsId = ws.id;
    priya = await persona(handle, loaded, wsId, "st-01");
    daniel = await persona(handle, loaded, wsId, "st-02");
    ngozi = await persona(handle, loaded, wsId, "cu-01");
  });
  afterAll(async () => {
    await handle.close();
  });

  const ok = (r: { ok: boolean; error?: { message: string; code: string } }) => {
    if (!r.ok) throw new Error(`${r.error?.code}: ${r.error?.message}`);
    return r as { ok: true; result: unknown; revision: number };
  };
  const view = <T>(v: T | { refused: true; message: string }): T => {
    if (isRefusal(v)) throw new Error(`refused: ${v.message}`);
    return v;
  };
  const sensitive = (value: unknown) => looksSensitive(JSON.stringify(value), loaded.packet);

  let overdueId: string;
  let requestId: string;
  let replyRef: string;
  let attachmentRef: string;

  it("staff screens refuse a client actor and return no data", async () => {
    const r = await requestsView(ngozi.ctx);
    expect(isRefusal(r)).toBe(true);
    expect(isRefusal(await tasksView(ngozi.ctx))).toBe(true);
    expect(isRefusal(await inboxView(ngozi.ctx))).toBe(true);
    expect(isRefusal(await timeView(ngozi.ctx))).toBe(true);
    expect(isRefusal(await judgmentsView(ngozi.ctx))).toBe(true);
    expect(Object.keys(r).sort()).toEqual(["message", "refused"]);
  });

  it("requests list with status, kind and overdue judged at the replay clock", async () => {
    expect(new Date(priya.ctx.workspace.asOf).toISOString().slice(0, 10)).toBe("2026-06-23");
    const late = ok(await priya.run("create_request", {
      kind: "document_request",
      title: "Closed-exchange confirmation for the BTC lot",
      body: "Please send the purchase confirmation for the 0.05 BTC bought in March 2021.",
      toActorId: "cu-01",
      refs: ["F8949.H.C6"],
      dueAt: "2026-06-20T23:59:59Z",
    }));
    overdueId = (late.result as { requestId: string }).requestId;
    const created = ok(await priya.run("create_request", {
      kind: "client_question",
      title: "Cost basis of the BTC lot moved to Coinhaven",
      body: "Where and when was the 0.05 BTC in lot C6 bought, and for how much?",
      toActorId: "cu-01",
      refs: ["F8949.H.C6"],
      dueAt: "2026-06-30T23:59:59Z",
    }));
    requestId = (created.result as { requestId: string }).requestId;

    const all = view<RequestsView>(await requestsView(priya.ctx));
    expect(all.total).toBe(2);
    expect(all.counts).toEqual({ open: 2, answered: 0, resolved: 0, withdrawn: 0 });
    expect(all.overdue).toBe(1);
    const overdue = all.requests.find((r) => r.id === overdueId)!;
    expect(overdue.overdue).toBe(true);
    expect(overdue.dueAt).toBe("2026-06-20T23:59:59.000Z");
    const open = all.requests.find((r) => r.id === requestId)!;
    expect(open.overdue).toBe(false);
    expect(open.from.name).toBe("Priya Raman");
    expect(open.to.name).toBe("Ngozi Okafor");
    expect(open.to.role).toBe("client");
    expect(open.area).toBe("investments_and_digital_assets");
    expect(open.refs[0]).toMatchObject({ ref: "F8949.H.C6", found: true, available: true });
    expect(all.recipients.clients.map((c) => c.id)).toEqual(["cu-01", "cu-02"]);
    expect(all.recipients.staff.some((s) => s.id === "st-01")).toBe(false);
    expect(all.recipients.staff.find((s) => s.id === "st-06")?.available).toBe(false);

    const byKind = view<RequestsView>(await requestsView(priya.ctx, { kind: "document_request" }));
    expect(byKind.requests.map((r) => r.id)).toEqual([overdueId]);
    const byStatus = view<RequestsView>(await requestsView(priya.ctx, { status: "resolved" }));
    expect(byStatus.requests).toHaveLength(0);
    expect(byStatus.filters).toEqual({ status: "resolved", kind: null });
    expect(sensitive(all)).toBe(false);
  });

  it("the client's reply with an attachment becomes citable evidence on the detail screen", async () => {
    const att = ok(await ngozi.run("add_attachment", {
      kind: "file",
      filename: "old-exchange-confirmation.txt",
      contentType: "text/plain",
      content: "Purchase 0.05 BTC on 2021-03-12 for 3,050.00 USD at DeltaCoin (closed 2024).",
      requestId,
    }));
    attachmentRef = (att.result as { evidenceRef: string }).evidenceRef;
    const reply = ok(await ngozi.run("reply_request", {
      requestId,
      body: "Bought March 2021 for about 3,050 on an exchange that has since closed; confirmation attached.",
      attachmentIds: [attachmentRef.split(":")[1]],
    }));
    replyRef = (reply.result as { evidenceRef: string }).evidenceRef;

    const d = view(await requestDetail(priya.ctx, requestId))!;
    expect(d.request.status).toBe("answered");
    expect(d.thread).toHaveLength(1);
    expect(d.thread[0].author.name).toBe("Ngozi Okafor");
    expect(d.thread[0].ref).toBe(replyRef);
    expect(d.thread[0].businessTime.slice(0, 10)).toBe("2026-06-23");
    const a = d.thread[0].attachments[0];
    expect(a.filename).toBe("old-exchange-confirmation.txt");
    expect(a.byteLength).toBeGreaterThan(50);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.href).toBe(`/api/attachments/${a.id}`);
    expect(a.provenance).toBe("client upload");
    expect(d.pendingAttachments).toHaveLength(0);
    expect(d.evidence.map((e) => e.ref).sort()).toEqual([attachmentRef, replyRef].sort());
    expect(d.evidence.every((e) => e.citedBy.length === 0)).toBe(true);
    expect(d.actor.canReply).toBe(true);
    expect(d.actor.canResolve).toBe(true);
    expect(await requestDetail(priya.ctx, "req_missing")).toBeNull();

    ok(await priya.run("propose_adjustment", {
      targetRef: "F8949.H.C6",
      kind: "value",
      proposedValue: 2275,
      reason: "Client states a March 2021 purchase for about 3,050; confirmation attached to the request.",
      evidenceRefs: [replyRef, attachmentRef],
      category: "stcg",
    }));
    const cited = view(await requestDetail(priya.ctx, requestId))!;
    const replyEvidence = cited.evidence.find((e) => e.ref === replyRef)!;
    expect(replyEvidence.citedBy).toHaveLength(1);
    expect(replyEvidence.citedBy[0]).toMatchObject({ table: "adjustment", status: "proposed" });
    expect(replyEvidence.citedBy[0].actor.name).toBe("Priya Raman");
    expect(sensitive(cited)).toBe(false);
  });

  it("resolving closes the thread and the list reflects it", async () => {
    ok(await priya.run("resolve_request", { requestId, resolution: "Answered; basis treatment to be recorded as a judgment." }));
    const d = view(await requestDetail(priya.ctx, requestId))!;
    expect(d.request.status).toBe("resolved");
    expect(d.request.resolvedBy?.name).toBe("Priya Raman");
    expect(d.request.resolution).toMatch(/recorded as a judgment/);
    expect(d.actor.canReply).toBe(false);
    expect(d.actor.canResolve).toBe(false);
    const all = view<RequestsView>(await requestsView(priya.ctx));
    expect(all.counts).toEqual({ open: 1, answered: 0, resolved: 1, withdrawn: 0 });
    expect(all.overdue).toBe(1);
  });

  it("unread count and the inbox move when notifications are marked read", async () => {
    // The client was asked twice; the preparer received one reply.
    expect(await unreadCount(ngozi.ctx)).toBe(2);
    expect(await unreadCount(priya.ctx)).toBe(1);
    expect(await unreadCount(daniel.ctx)).toBe(0);

    const inbox = view(await inboxView(priya.ctx));
    expect(inbox.unread).toBe(1);
    expect(inbox.total).toBe(1);
    expect(inbox.notifications[0]).toMatchObject({ kind: "reply", unread: true });
    expect(inbox.notifications[0].refs.map((r) => r.ref)).toEqual([`request:${requestId}`, replyRef]);

    ok(await priya.run("mark_notifications_read", { notificationIds: [inbox.notifications[0].id] }));
    expect(await unreadCount(priya.ctx)).toBe(0);
    const after = view(await inboxView(priya.ctx));
    expect(after.unread).toBe(0);
    expect(after.notifications[0].readAt).not.toBeNull();
    // Marking someone else's notification does nothing to it.
    const ngoziInbox = await handle.db.query.notifications.findMany({ where: (n, { eq, and }) => and(eq(n.workspaceId, wsId), eq(n.recipientId, "cu-01")) });
    ok(await priya.run("mark_notifications_read", { notificationIds: ngoziInbox.map((n) => n.id) }));
    expect(await unreadCount(ngozi.ctx)).toBe(2);
    expect(sensitive(after)).toBe(false);
  });

  it("tasks: outside filings in their own group, overdue at the clock, evidence required to close", async () => {
    const created = ok(await daniel.run("create_task", {
      kind: "outside_filing",
      title: "Forms 1099-NEC for two contractors (late)",
      detail: "Client paid two contractors over 600 by ACH and filed nothing; refer and track.",
      ownerId: "st-01",
      dueAt: "2026-02-02T23:59:59Z",
      refs: ["D27", "call-01"],
    }));
    const taskId = (created.result as { taskId: string }).taskId;
    ok(await daniel.run("create_task", {
      kind: "review",
      title: "Review the SEP limit computation",
      detail: "Compare the contribution to the 20 percent limit.",
      ownerId: "st-02",
      dueAt: "2026-07-15T23:59:59Z",
      refs: ["Sch1.16"],
    }));

    const all = view<TasksView>(await tasksView(priya.ctx));
    expect(all.counts).toMatchObject({ open: 2, done: 0, cancelled: 0, overdue: 1, mine: 1, total: 2 });
    expect(all.tasks.map((x) => x.kind)).toEqual(["review"]);
    expect(all.outsideFilings).toHaveLength(1);
    const outside = all.outsideFilings[0];
    expect(outside).toMatchObject({ id: taskId, overdue: true, mine: true, canComplete: true, area: "business" });
    expect(outside.owner.name).toBe("Priya Raman");
    expect(outside.refs.map((r) => r.ref)).toEqual(["D27", "call-01"]);
    expect(all.tasks[0].canComplete).toBe(false);
    expect(all.packetContext.deadlines.some((d) => /FBAR/.test(d.what) && d.date === "2026-10-15")).toBe(true);
    expect(all.packetContext.deadlines.some((d) => /1099-NEC/.test(d.what) && d.daysFromClock < 0)).toBe(true);
    expect(all.packetContext.refs.map((r) => r.ref)).toContain("call-01");

    const mine = view<TasksView>(await tasksView(priya.ctx, { mine: true }));
    expect(mine.tasks).toHaveLength(0);
    expect(mine.outsideFilings).toHaveLength(1);
    const overdue = view<TasksView>(await tasksView(daniel.ctx, { overdue: true }));
    expect(overdue.outsideFilings.map((x) => x.id)).toEqual([taskId]);
    expect(overdue.tasks).toHaveLength(0);

    const noEvidence = await priya.run("complete_task", { taskId, note: "Told the client to file." });
    expect(noEvidence.ok).toBe(false);
    const ack = ok(await priya.run("add_attachment", {
      kind: "note",
      filename: "client-ack.txt",
      contentType: "text/plain",
      content: "Erik confirmed by phone that the 1099-NEC forms were filed through a payroll service.",
      linkedRefs: [`task:${taskId}`],
    }));
    ok(await priya.run("complete_task", { taskId, note: "Client acknowledgment on file.", evidenceRefs: [(ack.result as { evidenceRef: string }).evidenceRef] }));
    const done = view<TasksView>(await tasksView(priya.ctx, { status: "done" }));
    expect(done.outsideFilings[0]).toMatchObject({ status: "done", overdue: false, canComplete: false });
    expect(done.outsideFilings[0].completionRefs[0].ref).toMatch(/^attachment:/);
    expect(sensitive(done)).toBe(false);
  });

  it("time: hours by area against the firm budget, with the engagement status line", async () => {
    ok(await priya.run("log_time", { area: "business", hours: 1.5, workDate: "2026-06-23", note: "Contractor follow-up" }));
    ok(await daniel.run("log_time", { area: "business", hours: 2, workDate: "2026-06-22" }));
    ok(await priya.run("log_time", { area: "tax_computation_and_payments", hours: 0.5, workDate: "2026-06-23" }));

    let t = view<TimeView>(await timeView(priya.ctx));
    expect(t.defaultDate).toBe("2026-06-23");
    const business = t.budget.rows.find((r) => r.areaId === "business")!;
    expect(business).toMatchObject({ budget: 3.5, logged: 3.5, remaining: 0, percent: 100, over: false });
    const comp = t.budget.rows.find((r) => r.areaId === "tax_computation_and_payments")!;
    expect(comp).toMatchObject({ budget: null, logged: 0.5, remaining: null, percent: null, over: false });
    expect(t.budget.totalBudget).toBe(22);
    expect(t.budget.totalLogged).toBe(4);
    expect(t.entries).toHaveLength(3);
    expect(t.entries[0].workDate).toBe("2026-06-23");
    expect(t.entries.find((e) => e.actor.name === "Daniel Ortiz")?.hours).toBe(2);
    expect(t.status).toMatchObject({ workflowState: "preparing", openRequests: 1, overdueRequests: 1, openTasks: 1, overdueTasks: 0 });
    expect(t.status.openFindings).toBeGreaterThan(0);

    ok(await priya.run("log_time", { area: "business", hours: 1, workDate: "2026-06-23" }));
    t = view<TimeView>(await timeView(priya.ctx));
    const over = t.budget.rows.find((r) => r.areaId === "business")!;
    expect(over).toMatchObject({ logged: 4.5, remaining: -1, percent: 129, over: true });
    expect(sensitive(t)).toBe(false);
  });

  it("judgments view lists the record, resolves suggested subjects and checks evidence availability", async () => {
    ok(await priya.run("record_judgment", {
      kind: "judgment",
      subjectRef: "F8949.H.C6",
      title: "Basis of the transferred BTC lot",
      authority: "IRC 1012; Rev. Rul. 2019-24 on digital asset basis",
      applicability: "Lot C6 was transferred in with no basis reported by the receiving exchange.",
      conclusion: "Basis substantiated at 3,050 by the client's reply and the closed-exchange confirmation.",
      evidenceRefs: [replyRef, attachmentRef],
    }));
    const j = view(await judgmentsView(priya.ctx));
    expect(j.total).toBe(1);
    expect(j.judgments[0]).toMatchObject({ kind: "judgment", area: "investments_and_digital_assets", status: "recorded", mine: true });
    expect(j.judgments[0].subject).toMatchObject({ ref: "F8949.H.C6", found: true });
    expect(j.judgments[0].evidenceRefs.map((r) => r.ref)).toEqual([replyRef, attachmentRef]);
    const c6 = j.suggestions.find((s) => s.id === "c6_basis")!;
    expect(c6.recorded.map((r) => r.id)).toEqual([j.judgments[0].id]);
    // msg-07 arrives on 2026-06-30, after the clock: shown, found, not available.
    expect(c6.evidence.find((e) => e.ref === "msg-07")).toMatchObject({ found: true, available: false });
    expect(c6.question).not.toMatch(/conclusion:/i);
    const hvac = j.suggestions.find((s) => s.id === "hvac_repair_vs_improvement")!;
    expect(hvac.links[0].href).toBe("/changes/whatif?alt=hvac_improvement");
    expect(hvac.evidence.every((e) => e.found)).toBe(true);
    expect(j.suggestions.every((s) => s.subject.found)).toBe(true);
    expect(j.suggestions.every((s) => s.evidence.every((e) => e.found))).toBe(true);
    const diligence = j.suggestions.find((s) => s.id === "form_8867_due_diligence")!;
    expect(diligence.suggestedKind).toBe("due_diligence");
    const filtered = view(await judgmentsView(priya.ctx, { area: "business" }));
    expect(filtered.judgments).toHaveLength(0);
    expect(filtered.suggestions.every((s) => s.area === "business")).toBe(true);
    expect(sensitive(j)).toBe(false);
  });
});
