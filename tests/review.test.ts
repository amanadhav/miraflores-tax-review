import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db/client";
import type { LoadedPacket } from "@/packet/load";
import { looksSensitive } from "@/domain/redaction";
import { areaView, assetsView, holdingFor, lineView } from "@/server/queries/review";
import { importedDb } from "./helpers/db";
import { newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * The review workspace reads: every number traces to resolved evidence, the
 * calculation panel only claims a formula it can reproduce, and the area view
 * reflects accepted changes, recomputed subtotals, grouped Form 8949 lots and
 * reopened sign-offs with their stated reason.
 */
describe("review views", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let wsId: string;
  let priya: Persona;
  let daniel: Persona;
  let helen: Persona;

  beforeAll(async () => {
    const db = await importedDb();
    handle = db.handle;
    loaded = db.loaded;
    const ws = await newWorkspace(handle, loaded);
    wsId = ws.id;
    priya = await persona(handle, loaded, wsId, "st-01");
    daniel = await persona(handle, loaded, wsId, "st-02");
    helen = await persona(handle, loaded, wsId, "st-03");
  });
  afterAll(async () => {
    await handle.close();
  });

  it("lineView(SchC.1) lists seven resolved sources with availability at the replay clock", async () => {
    const v = await lineView(priya.ctx, "SchC.1");
    expect(v).not.toBeNull();
    if (!v) return;
    expect(v.label).toBe("Gross receipts");
    expect(v.area.id).toBe("business");
    expect(v.rule.id).toBe("R-SCHC-GROSS");
    expect(v.rule.description).toMatch(/Books revenue/);
    expect(v.evidence.sources).toHaveLength(7);
    expect(v.evidence.sources.every((s) => s.found)).toBe(true);
    expect(v.evidence.sources.every((s) => s.kind === "extracted_value")).toBe(true);
    expect(v.evidence.sources.every((s) => s.available)).toBe(true);
    expect(v.evidence.sources[0].label).toMatch(/page \d+\)$/);
    expect(v.evidence.verificationTypes).toContain("agreed_to_source_document");
    expect(v.value.baseline).toBe(163700);
    expect(v.value.status).toBe("baseline");
    expect(v.calculation.kind).toBe("opaque");
    expect(v.propose.defaults.category).toBe("schc_profit");
    expect(v.propose.defaults.schcExpense).toBe(false);
    expect(v.dependents.map((d) => d.key)).toContain("SchC.5");
  });

  it("lineView(F1040.11) is a verified subtractive sum: total income minus adjustments", async () => {
    const v = await lineView(priya.ctx, "F1040.11");
    expect(v).not.toBeNull();
    if (!v) return;
    expect(v.calculation.kind).toBe("sum");
    expect(v.calculation.reproducible).toBe(true);
    expect(v.calculation.inputs.map((i) => [i.key, i.sign])).toEqual([
      ["F1040.9", 1],
      ["F1040.10", -1],
    ]);
    expect(v.calculation.inputs.every((i) => i.signVerified)).toBe(true);
    expect(v.calculation.formula).toBe("Total income (F1040.9) - Adjustments to income (F1040.10)");
    expect(v.calculation.inputs[0].effective).toBe(480987);
    expect(v.calculation.inputs[1].effective).toBe(35397);
    expect(v.value.baseline).toBe(445590);
  });

  it("lineView(F4797.24) is opaque, names the engine rule and says it cannot be reproduced", async () => {
    const v = await lineView(priya.ctx, "F4797.24");
    expect(v).not.toBeNull();
    if (!v) return;
    expect(v.calculation.kind).toBe("opaque");
    expect(v.calculation.reproducible).toBe(false);
    expect(v.calculation.rule.id).toBe("R-4797");
    expect(v.calculation.formula).toMatch(/^Engine rule R-4797: Sale of business property/);
    expect(v.calculation.inputs.map((i) => i.key)).toEqual(["F4797.22", "F4797.23"]);
    expect(v.calculation.statement).toMatch(/cannot be reproduced here/);
    expect(v.calculation.statement).toMatch(/goes stale/);
  });

  it("lineView returns null for a key that is not a line", async () => {
    expect(await lineView(priya.ctx, "SchC.999")).toBeNull();
  });

  it("the default area is the first with open blockers and the left column counts every area", async () => {
    const v = await areaView(priya.ctx, undefined);
    expect(v.area.id).toBe("wages_and_stock_compensation");
    expect(v.areas).toHaveLength(10);
    const business = v.areas.find((a) => a.id === "business")!;
    expect(business.lines).toBeGreaterThan(20);
    expect(business.openFindings).toBeGreaterThan(0);
    expect(business.accepted).toBe(0);
    expect(business.proposed).toBe(0);
    expect(business.stale).toBe(0);
    expect(v.signoffs.capabilities.map((c) => c.level)).toEqual(["preparer", "reviewer", "partner"]);
    // Priya is the assigned preparer: reviewer and partner sign-off would be refused as self-review.
    expect(v.signoffs.capabilities.find((c) => c.level === "preparer")!.warning).toBeNull();
    expect(v.signoffs.capabilities.find((c) => c.level === "reviewer")!.warning).toMatch(/does not hold reviewer-level/);
  });

  it("after Priya proposes and Helen accepts SchC.1, business shows one accepted change and SchC.31 recomputed", async () => {
    const proposed = await priya.run("propose_adjustment", {
      targetRef: "SchC.1",
      kind: "value",
      proposedValue: 151300,
      reason: "Books total income 151,300 already includes the 12,400 Paywell receipts; the engine added the 1099-K again.",
      evidenceRefs: ["doc:D14#page1", "doc:D15#page3", "doc:D21#page1", "ev-0103"],
      category: "schc_profit",
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const adjustmentId = (proposed.result as { adjustmentId: string }).adjustmentId;

    const pending = await areaView(priya.ctx, "business");
    expect(pending.lines.find((l) => l.key === "SchC.1")!.pendingProposals).toBe(1);
    expect(pending.areas.find((a) => a.id === "business")!.proposed).toBe(1);

    const accepted = await helen.run("decide_adjustment", { adjustmentId, decision: "accept", note: "Agreed to the books and the 1099-K." });
    expect(accepted.ok).toBe(true);

    const v = await areaView(helen.ctx, "business", {});
    const summary = v.areas.find((a) => a.id === "business")!;
    expect(summary.accepted).toBe(1);
    expect(summary.proposed).toBe(0);
    expect(summary.stale).toBeGreaterThan(0);
    const gross = v.lines.find((l) => l.key === "SchC.1")!;
    expect(gross.status).toBe("adjusted");
    expect(gross.baseline).toBe(163700);
    expect(gross.effective).toBe(151300);
    expect(gross.adjustmentId).toBe(adjustmentId);
    const net = v.lines.find((l) => l.key === "SchC.31")!;
    expect(net.status).toBe("recomputed");
    expect(net.effective).toBe(81854 - 12400);
    expect(net.changedInputs.map((c) => c.key)).toEqual(["SchC.29"]);
    expect(net.statusReason).toMatch(/Recomputed with the verified formula/);
    const se = v.lines.find((l) => l.key === "SchSE.12")!;
    expect(se.status).toBe("stale");
    expect(se.statusReason).toMatch(/cannot be reproduced here|itself stale/);

    const line = await lineView(helen.ctx, "SchC.1");
    expect(line!.history).toHaveLength(1);
    expect(line!.history[0].status).toBe("accepted");
    expect(line!.history[0].effectFederal).toBeCloseTo(-4402, 2);
    expect(line!.history[0].requiresPartner).toBe(true);
    expect(line!.history[0].decidedBy?.name).toBe("Helen Strand");
    expect(line!.history[0].decisionNote).toBe("Agreed to the books and the 1099-K.");
    expect(line!.history[0].evidenceRefs.every((r) => r.found)).toBe(true);
    expect(line!.history[0].limitations.length).toBeGreaterThan(0);
    expect(line!.value.status).toBe("adjusted");
  });

  it("the search box filters lines by key and label", async () => {
    const v = await areaView(priya.ctx, "business", { q: "mileage" });
    expect(v.lines.length).toBeGreaterThan(0);
    expect(v.lines.every((l) => /mileage/i.test(l.label) || /mileage/i.test(l.key))).toBe(true);
    const byKey = await areaView(priya.ctx, "business", "SchC.31");
    expect(byKey.lines.map((l) => l.key)).toEqual(["SchC.31"]);
    expect(byKey.lineCount).toBeGreaterThan(1);
  });

  it("the wages area groups Form 8949 N-lots by box with the box totals linked", async () => {
    const v = await areaView(priya.ctx, "wages_and_stock_compensation");
    expect(v.lots).not.toBeNull();
    const lots = v.lots!;
    expect(lots.lotCount).toBe(5);
    expect(lots.groups.map((g) => g.box)).toEqual(["A", "B", "D", "E"]);
    const boxB = lots.groups.find((g) => g.box === "B")!;
    expect(boxB.lots.map((l) => l.key)).toEqual(["F8949.B.N1", "F8949.B.N3"]);
    expect(boxB.holding).toBe("short");
    expect(boxB.total).toBeNull(); // the box total lives in investments
    expect(boxB.totalKey).toBe("F8949.B.total");
    expect(lots.groups.find((g) => g.box === "D")!.holding).toBe("long");
    // Wage lines stay in the plain table.
    expect(v.lines.some((l) => l.key === "F1040.1a")).toBe(true);
    expect(v.lines.some((l) => l.form === "F8949")).toBe(false);
  });

  it("the investments area shows totals first and paginates lots fifty at a time", async () => {
    const first = await areaView(priya.ctx, "investments_and_digital_assets");
    const lots = first.lots!;
    expect(lots.totals.map((t) => t.box)).toEqual(["A", "B", "D", "E", "F", "H", "K"]);
    expect(lots.totals.find((t) => t.box === "A")!.effective).toBe(212);
    expect(lots.lotCount).toBe(302 - 7 - 5);
    expect(lots.pageSize).toBe(50);
    expect(lots.pageCount).toBe(6);
    expect(lots.page).toBe(1);
    expect(lots.groups.reduce((n, g) => n + g.lots.length, 0)).toBe(50);
    expect(lots.groups[0].box).toBe("A");
    const last = await areaView(priya.ctx, "investments_and_digital_assets", { page: 99 });
    expect(last.lots!.page).toBe(6);
    expect(last.lots!.groups.reduce((n, g) => n + g.lots.length, 0)).toBe(290 - 250);
    expect(last.lots!.groups.map((g) => g.box)).toContain("K");
    expect(holdingFor("F8949.K.C1", "BTC (acquired 2023-02-11, sold 2025-01-09)")).toBe("long");
    expect(holdingFor("F8949.Z.C1", "X (acquired 2025-01-01, sold 2025-06-01)")).toBe("short");
  });

  it("a reopened sign-off carries its reason into the area view", async () => {
    const sign = await daniel.run("sign_off", { scopeType: "area", scopeId: "business", level: "reviewer" });
    expect(sign.ok).toBe(true);
    const active = await areaView(daniel.ctx, "business");
    const mine = active.signoffs.signoffs.find((s) => s.level === "reviewer")!;
    expect(mine.status).toBe("active");
    expect(mine.mine).toBe(true);
    expect(mine.canWithdraw).toBe(true);
    expect(active.areas.find((a) => a.id === "business")!.signoffs.reviewer).toBe("active");

    const anchor = await priya.run("add_anchor", { subjectRef: "SchC.1", documentId: "D15", page: 3, textSpan: "12,400.00 arrived through Paywell" });
    expect(anchor.ok).toBe(true);

    const reopened = await areaView(priya.ctx, "business");
    const stale = reopened.signoffs.signoffs.find((s) => s.id === mine.id)!;
    expect(stale.status).toBe("stale");
    expect(stale.invalidationReason).toMatch(/evidence link, verification or anchor/);
    expect(stale.actor.name).toBe("Daniel Ortiz");
    expect(stale.mine).toBe(false);
    expect(reopened.areas.find((a) => a.id === "business")!.signoffs.reviewer).toBe("stale");

    const line = await lineView(priya.ctx, "SchC.1");
    expect(line!.evidence.anchors).toHaveLength(1);
    expect(line!.evidence.anchors[0].textSpan).toBe("12,400.00 arrived through Paywell");
    expect(line!.reviews.area.signoffs.find((s) => s.id === mine.id)!.status).toBe("stale");
  });

  it("findings show origin, refs and resolution; a finding id selects its area", async () => {
    const raised = await daniel.run("raise_finding", {
      title: "Confirm phone business share",
      detail: "call-01 says 70% business use; the books claim 100%.",
      severity: "warning",
      refs: ["SchC.25", "call-01"],
    });
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;
    const findingId = (raised.result as { findingId: string }).findingId;
    const v = await areaView(daniel.ctx, undefined, { finding: findingId });
    expect(v.area.id).toBe("business");
    const f = v.findings.find((x) => x.id === findingId)!;
    expect(f.origin).toBe("reviewer");
    expect(f.status).toBe("open");
    expect(f.blocksFiling).toBe(true);
    expect(f.refs.map((r) => r.kind)).toEqual(["line", "call_note"]);
    expect(f.refs[1].label).toMatch(/^Call on/);
    expect(f.raisedBy?.name).toBe("Daniel Ortiz");
    expect(f.owner?.id).toBe("st-01");
    const engine = v.findings.find((x) => x.origin === "engine_diagnostic")!;
    expect(engine.originLabel).toBe("Engine diagnostic");
    expect(v.findings.findIndex((x) => x.status === "open")).toBe(0);

    const resolved = await daniel.run("resolve_finding", { findingId, outcome: "resolved", resolution: "Share confirmed on the call.", evidenceRefs: ["call-01"] });
    expect(resolved.ok).toBe(true);
    const after = await areaView(daniel.ctx, "business");
    const done = after.findings.find((x) => x.id === findingId)!;
    expect(done.status).toBe("resolved");
    expect(done.resolution).toMatch(/Share confirmed/);
    expect(done.resolvedBy?.name).toBe("Daniel Ortiz");
    // Resolved findings sort after open ones.
    expect(after.findings.indexOf(done)).toBeGreaterThan(after.findings.findIndex((x) => x.status === "open"));
  });

  it("assets view lists all nine assets with prior-year history and disposition details", async () => {
    const v = await assetsView(priya.ctx);
    expect(v.version).toBe("v3");
    expect(v.assets).toHaveLength(9);
    const bldg = v.assets.find((a) => a.id === "AUS-BLDG")!;
    expect(bldg.disposed).toBe("2025-10-15");
    expect(bldg.disposition.some((d) => /Unrecaptured 1250/.test(d.label))).toBe(true);
    expect(bldg.sources.map((s) => s.ref)).toContain("py:/asset_records");
    expect(bldg.sources.every((s) => s.found)).toBe(true);
    expect(bldg.prior?.years.map((y) => y.year)).toEqual(["2020", "2021", "2022", "2023", "2024"]);
    const printer = v.assets.find((a) => a.id === "STU-PRINTER")!;
    expect(printer.prior).toBeNull();
    expect(printer.sources.map((s) => s.kind)).toEqual(["extracted_value", "extracted_value"]);
  });

  it("no view leaks a sensitive literal", async () => {
    const packet = loaded.packet;
    const views = [
      JSON.stringify(await areaView(priya.ctx, "intake_and_engagement")),
      JSON.stringify(await areaView(priya.ctx, "deductions_and_credits")),
      JSON.stringify(await lineView(priya.ctx, "F2441.1b")),
      JSON.stringify(await assetsView(priya.ctx)),
    ];
    for (const text of views) expect(looksSensitive(text, packet)).toBe(false);
  });
});
