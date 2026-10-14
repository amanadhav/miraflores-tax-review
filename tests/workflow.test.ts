import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import * as t from "@/db/schema";
import type { LoadedPacket } from "@/packet/load";
import { loadWorkspaceState } from "@/server/state";
import { importedDb } from "./helpers/db";
import { key, newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * The first complete workflow: E03 (payment-card receipts counted twice).
 * Priya (preparer) proposes SchC.1 163,700 -> 151,300 citing the books and the
 * 1099-K; the estimated effect is over the partner threshold, so Daniel
 * (reviewer) cannot accept it and Helen (partner) can. Priya can never approve
 * her own work. Dependent subtotals with verified formulas recompute; the
 * rest goes stale. Sign-offs reopen when evidence changes.
 */
describe("evidence to adjustment to review", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let wsId: string;
  let priya: Persona;
  let daniel: Persona;
  let helen: Persona;
  let marcus: Persona;

  beforeAll(async () => {
    const db = await importedDb();
    handle = db.handle;
    loaded = db.loaded;
    const ws = await newWorkspace(handle, loaded);
    wsId = ws.id;
    priya = await persona(handle, loaded, wsId, "st-01");
    daniel = await persona(handle, loaded, wsId, "st-02");
    helen = await persona(handle, loaded, wsId, "st-03");
    marcus = await persona(handle, loaded, wsId, "st-04");
  });
  afterAll(async () => {
    await handle.close();
  });

  it("starts at v3 with engine diagnostics as findings and Priya as preparer", async () => {
    expect(priya.ctx.workspace.activeVersion).toBe("v3");
    expect(new Date(priya.ctx.workspace.asOf).toISOString()).toBe("2026-06-23T06:05:00.000Z");
    const state = await loadWorkspaceState(handle.db, priya.ctx);
    expect(state.findings.filter((f) => f.origin === "engine_diagnostic")).toHaveLength(11);
    expect(state.findings.some((f) => f.code === "K1_EXPECTED_NOT_RECEIVED")).toBe(false);
  });

  it("rejects evidence that is not yet available at the replay clock", async () => {
    const r = await priya.run("propose_adjustment", {
      targetRef: "F8949.H.C6",
      kind: "value",
      proposedValue: 0,
      reason: "Client says basis is about 3,050",
      evidenceRefs: ["msg-07"],
      category: "none",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/Not yet available at 2026-06-23/);
  });

  let adjustmentId: string;

  it("Priya proposes the SchC receipts correction with an estimated effect", async () => {
    const r = await priya.run("propose_adjustment", {
      targetRef: "SchC.1",
      kind: "value",
      proposedValue: 151300,
      reason: "Books total income 151,300 already includes the 12,400 Paywell receipts; the engine added the 1099-K again.",
      evidenceRefs: ["doc:D14#page1", "doc:D15#page3", "doc:D21#page1", "ev-0103"],
      category: "schc_profit",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = r.result as { adjustmentId: string; effect: { federal: number; california: number; status: string }; requiresPartner: boolean };
    adjustmentId = result.adjustmentId;
    expect(result.effect.federal).toBeCloseTo(-4402, 2);
    expect(result.effect.california).toBeCloseTo(-384.4, 2);
    expect(result.effect.status).toBe("estimated");
    expect(result.requiresPartner).toBe(true);
    expect(r.revision).toBe(1);
  });

  it("the proposal does not change effective facts until accepted", async () => {
    const state = await loadWorkspaceState(handle.db, priya.ctx);
    expect(state.effective.lines.get("SchC.1")!.effective).toBe(163700);
    expect(state.effective.lines.get("SchC.1")!.status).toBe("baseline");
  });

  it("Priya cannot accept her own work even though the command exists", async () => {
    const r = await priya.run("decide_adjustment", { adjustmentId, decision: "accept" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("forbidden");
  });

  it("Daniel (reviewer) is blocked by the partner threshold", async () => {
    const r = await daniel.run("decide_adjustment", { adjustmentId, decision: "accept" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("partner_required");
  });

  it("Marcus is not available on June 23 only in replay before March 24; today he can act but cannot decide", async () => {
    const r = await marcus.run("decide_adjustment", { adjustmentId, decision: "accept" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("forbidden");
  });

  it("a stale expected revision conflicts and reports what changed", async () => {
    const r = await helen.run("decide_adjustment", { adjustmentId, decision: "accept" }, { expectedRevision: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("conflict");
      expect(r.error.currentRevision).toBe(1);
      expect(r.error.changesSince?.map((e) => e.action)).toEqual(["adjustment_proposed"]);
    }
  });

  it("Helen (partner) accepts; supported subtotals recompute and opaque lines go stale", async () => {
    const idem = key("accept");
    const r = await helen.run("decide_adjustment", { adjustmentId, decision: "accept" }, { idempotencyKey: idem });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.revision).toBe(2);
    const state = await loadWorkspaceState(handle.db, helen.ctx);
    const l = state.effective.lines;
    expect(l.get("SchC.1")!.effective).toBe(151300);
    expect(l.get("SchC.1")!.status).toBe("adjusted");
    // Gross profit / gross income / net profit are verified sums in v3.
    expect(l.get("SchC.31")!.status).toBe("recomputed");
    expect(l.get("SchC.31")!.effective).toBe(81854 - 12400);
    // SE tax has no verified formula: it must show as stale, not as current.
    expect(l.get("SchSE.12")?.status ?? "stale").toBe("stale");
    expect(state.effective.staleKeys.length).toBeGreaterThan(0);

    // Replaying the same idempotency key applies nothing and bumps nothing.
    const again = await helen.run("decide_adjustment", { adjustmentId, decision: "accept" }, { idempotencyKey: idem, expectedRevision: 99 });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.replayed).toBe(true);
      expect(again.revision).toBe(2);
    }
    const [ws] = await handle.db.select().from(t.workspaces).where(eq(t.workspaces.id, wsId));
    expect(ws.revision).toBe(2);
  });

  it("the audit trail records who, what and the estimated effect", async () => {
    const events = await handle.db.select().from(t.auditEvents).where(eq(t.auditEvents.workspaceId, wsId));
    const accepted = events.find((e) => e.action === "adjustment_accepted");
    expect(accepted?.actorId).toBe("st-03");
    expect(accepted?.revision).toBe(2);
    expect((accepted?.after as { effectFederal: string }).effectFederal).toBe("-4402.00");
  });

  it("Daniel signs off the business area; an evidence-only change reopens it", async () => {
    const sign = await daniel.run("sign_off", { scopeType: "area", scopeId: "business", level: "reviewer" });
    expect(sign.ok).toBe(true);
    const unrelated = await daniel.run("sign_off", { scopeType: "area", scopeId: "california", level: "reviewer" });
    expect(unrelated.ok).toBe(true);

    // Same number, different evidence: Priya anchors SchC.1 to the exact books passage.
    const anchor = await priya.run("add_anchor", {
      subjectRef: "SchC.1",
      documentId: "D15",
      page: 3,
      textSpan: "12,400.00 arrived through Paywell",
    });
    expect(anchor.ok).toBe(true);

    const rows = await handle.db.select().from(t.signoffs).where(eq(t.signoffs.workspaceId, wsId));
    const business = rows.find((s) => s.scopeId === "business")!;
    const california = rows.find((s) => s.scopeId === "california")!;
    expect(business.status).toBe("stale");
    expect(business.invalidationReason).toMatch(/evidence link, verification or anchor/);
    expect(california.status).toBe("active");
  });

  it("Daniel cannot sign off a line he himself prepared", async () => {
    const r = await daniel.run("propose_adjustment", {
      targetRef: "SchC.25",
      kind: "value",
      proposedValue: 2172,
      reason: "Phone 70% and internet 50% business share per call-01",
      evidenceRefs: ["call-01", "ev-0101", "ev-0095"],
      category: "schc_profit",
    });
    expect(r.ok).toBe(true);
    const sign = await daniel.run("sign_off", { scopeType: "line", scopeId: "SchC.25", level: "reviewer" });
    expect(sign.ok).toBe(false);
    if (!sign.ok) expect(sign.error.code).toBe("self_review");
    const helenSign = await helen.run("sign_off", { scopeType: "line", scopeId: "SchC.25", level: "reviewer" });
    expect(helenSign.ok).toBe(true);
  });

  it("undo appends a compensating entry and restores the former value", async () => {
    const r = await helen.run("undo_adjustment", { adjustmentId });
    expect(r.ok).toBe(true);
    const state = await loadWorkspaceState(handle.db, helen.ctx);
    expect(state.effective.lines.get("SchC.1")!.effective).toBe(163700);
    const [original] = await handle.db.select().from(t.adjustments).where(and(eq(t.adjustments.id, adjustmentId), eq(t.adjustments.workspaceId, wsId)));
    expect(original.status).toBe("reverted");
    const compensating = state.adjustments.find((a) => a.revertsId === adjustmentId)!;
    expect(compensating.status).toBe("accepted");
    expect(compensating.effectFederal).toBe("4402.00");
  });

  it("an exact text anchor must quote the page; approximations are refused", async () => {
    const r = await priya.run("add_anchor", { subjectRef: "F2441.1b", documentId: "D62", page: 1, textSpan: "Tax ID 74-3829516" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/not printed/);
    const ok = await priya.run("add_anchor", { subjectRef: "F2441.1b", documentId: "D62", page: 1, textSpan: "Tax ID 74-3829156" });
    expect(ok.ok).toBe(true);
  });

  it("advancing the clock makes July evidence available and Marcus is unavailable before March 24", async () => {
    const back = await priya.run("advance_time", { to: "2026-03-20T12:00:00Z" });
    expect(back.ok).toBe(true);
    const asMarcus = await marcus.run("raise_finding", { title: "test", detail: "test detail", severity: "info" });
    expect(asMarcus.ok).toBe(false);
    if (!asMarcus.ok) expect(asMarcus.error.code).toBe("unavailable");
    const forward = await priya.run("advance_time", { to: "2026-07-01T00:00:00Z" });
    expect(forward.ok).toBe(true);
    const r = await priya.run("raise_finding", {
      title: "C6 basis per client message",
      detail: "msg-07 says the lot was bought March 2021 for about 3,050; needs substantiation.",
      severity: "warning",
      refs: ["msg-07", "F8949.H.C6"],
    });
    expect(r.ok).toBe(true);
  });
});
