import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db/client";
import type { LoadedPacket } from "@/packet/load";
import { looksSensitive } from "@/domain/redaction";
import { bridgeView, californiaView, carryoversView, paymentsView, summaryView, varianceView } from "@/server/queries/records-a";
import { importedDb } from "./helpers/db";
import { newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * The CPA record views: the summary versus last year, variance with batch
 * explanations, the books-to-tax bridge before and after a correction, the
 * California columns and AMT gap, the payments reconciliation at the replay
 * clock, and carryovers paired with the prior preparer's open items.
 */
describe("record views (summary, variance, bridge, california, payments, carryovers)", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let wsId: string;
  let priya: Persona;
  let helen: Persona;

  beforeAll(async () => {
    const db = await importedDb();
    handle = db.handle;
    loaded = db.loaded;
    const ws = await newWorkspace(handle, loaded);
    wsId = ws.id;
    priya = await persona(handle, loaded, wsId, "st-01");
    helen = await persona(handle, loaded, wsId, "st-03");
  });
  afterAll(async () => {
    await handle.close();
  });

  it("summary: F1040.1a shows the 2024 value 156,039, is flagged, and the engine totals stand apart from accepted changes", async () => {
    const v = await summaryView(priya.ctx);
    const wages = v.federalHeadline.find((r) => r.key === "F1040.1a")!;
    expect(wages.prior?.value).toBe(156039);
    expect(wages.prior?.source?.ref).toBe("ev-2909");
    expect(wages.prior?.source?.found).toBe(true);
    expect(wages.baseline).toBe(212400);
    expect(wages.change?.flagged).toBe(true);
    expect(wages.explained).toBe(false);
    expect(v.federalHeadline.map((r) => r.key)).toContain("F1040.37");
    expect(v.federalHeadline.find((r) => r.key === "F1040.37")!.change).toBeNull();
    expect(v.federalHeadline.find((r) => r.key === "F1040.25d")!.prior?.key).toBe("F1040.25a");
    const caAgi = v.californiaHeadline.find((r) => r.key === "F540NR.13")!;
    expect(caAgi.prior?.key).toBe("CA540.13");
    expect(caAgi.prior?.value).toBe(228409);
    expect(v.engine.federal.total_tax).toBe(81962);
    expect(v.engine.california.balance_due).toBe(-8256);
    expect(v.engine.statement).toMatch(/never as a recomputed total/);
    expect(v.accepted).toHaveLength(0);
    expect(v.forms[0].form).toBe("F1040");
    const f8949 = v.forms.find((f) => f.form === "F8949")!;
    expect(f8949.lotsSkipped).toBeGreaterThan(200);
    expect(f8949.lines.every((l) => l.key.endsWith(".total"))).toBe(true);
    const agi = v.forms[0].lines.find((l) => l.key === "F1040.11")!;
    expect(agi.reproducible).toBe(true);
    expect(agi.formula).toBe("Total income (F1040.9) - Adjustments to income (F1040.10)");
    expect(v.forms[0].lines.find((l) => l.key === "F1040.16")!.formula).toBe("opaque");
  });

  it("variance: the explained flag flips after a batch_verify agreed to the prior year", async () => {
    const before = await varianceView(priya.ctx);
    expect(before.thresholds.percent).toBe(10);
    expect(before.thresholds.amount).toBe(1000);
    expect(before.rows[0].flagged).toBe(true);
    const wages = before.rows.find((r) => r.key === "F1040.1a")!;
    expect(wages.prior).toBe(156039);
    expect(wages.current).toBe(212400);
    expect(wages.explained).toBe(false);
    expect(wages.priorSource?.ref).toBe("ev-2909");
    expect(before.onlyPrior.some((r) => r.key.startsWith("CA540."))).toBe(true);
    expect(before.onlyPrior.find((r) => r.key === "CA540.13")!.equivalent?.key).toBe("F540NR.13");
    expect(before.onlyPrior.find((r) => r.key === "CA540.13")!.note).toMatch(/Form 540NR/);
    expect(before.rows.filter((r) => r.prior === 0 && r.flagged).every((r) => r.percent === null)).toBe(true);

    const batch = await priya.run("batch_verify", {
      subjectRefs: ["F1040.1a", "F1040.9"],
      method: before.method,
      conclusion: "agrees",
      evidenceRefs: [before.priorDocument.ref],
      note: "Second employer from June; two W-2s in 2025.",
    });
    expect(batch.ok).toBe(true);

    const after = await varianceView(priya.ctx);
    const explained = after.rows.find((r) => r.key === "F1040.1a")!;
    expect(explained.explained).toBe(true);
    expect(explained.explanations).toHaveLength(1);
    expect(explained.explanations[0].actor.name).toBe("Priya Raman");
    expect(explained.explanations[0].batchId).toMatch(/^bat/);
    expect(after.explainedCount).toBe(before.explainedCount + 2);
    expect(after.rows.findIndex((r) => r.key === "F1040.1a")).toBeLessThan(after.rows.findIndex((r) => !r.flagged));
  });

  it("bridge: agrees at baseline and still agrees after Priya proposes and Helen accepts the SchC.1 correction", async () => {
    const baseline = await bridgeView(priya.ctx);
    expect(baseline.agrees).toBe(true);
    expect(baseline.computedProfit).toBe(81854);
    expect(baseline.effectiveProfit).toBe(81854);
    expect(baseline.books.ref).toBe("D14");
    expect(baseline.transactions.ref).toBe("D15");
    expect(baseline.rows[0].kind).toBe("start");
    expect(baseline.rows[baseline.rows.length - 1].kind).toBe("result");
    expect(baseline.rows.find((r) => r.kind === "income")?.amount).toBe(12400);
    expect(baseline.corrections.accepted).toHaveLength(0);
    expect(baseline.corrections.statement).toMatch(/No Schedule C corrections/);

    const proposed = await priya.run("propose_adjustment", {
      targetRef: "SchC.1",
      kind: "value",
      proposedValue: 151300,
      reason: "Books total income 151,300 already includes the 12,400 Paywell receipts; the engine added the 1099-K again.",
      evidenceRefs: ["doc:D14#page1", "doc:D15#page3", "ev-0103"],
      category: "schc_profit",
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const adjustmentId = (proposed.result as { adjustmentId: string }).adjustmentId;
    const pending = await bridgeView(priya.ctx);
    expect(pending.corrections.proposed.map((a) => a.id)).toEqual([adjustmentId]);
    expect(pending.agrees).toBe(true);

    const accepted = await helen.run("decide_adjustment", { adjustmentId, decision: "accept", note: "Agreed to the books." });
    expect(accepted.ok).toBe(true);
    const after = await bridgeView(helen.ctx);
    expect(after.agrees).toBe(true);
    expect(after.effectiveProfit).toBe(81854 - 12400);
    expect(after.computedProfit).toBe(81854 - 12400);
    expect(after.rows.find((r) => r.kind === "income")?.amount).toBe(0);
    expect(after.rows.find((r) => r.kind === "income")?.status).toBe("adjusted");
    expect(after.rows.find((r) => r.kind === "result")?.status).toBe("recomputed");
    expect(after.corrections.accepted.map((a) => a.id)).toEqual([adjustmentId]);
    expect(after.corrections.accepted[0].decidedBy?.name).toBe("Helen Strand");
    expect(after.agreement).toMatch(/agrees/i);
  });

  it("california: columns A to E parse for line 1, residency is 195 of 365 days, and F540NR.61 is not computed", async () => {
    const v = await californiaView(priya.ctx);
    expect(v.scheduleCA.columns.map((c) => c.id)).toEqual(["A", "B", "C", "D", "E"]);
    const line1 = v.scheduleCA.rows.find((r) => r.line === "1")!;
    expect(line1.cells.A?.key).toBe("SchCA540NR.1.A");
    expect(line1.cells.B).toBeNull();
    expect(line1.cells.C?.effective).toBe(6000);
    expect(line1.cells.D?.effective).toBe(218400);
    expect(line1.cells.E?.key).toBe("SchCA540NR.1.E");
    expect(line1.cells.E?.rule).toBe("R-CA-WAGES-SOURCE");
    expect(line1.cells.E?.sources.map((s) => s.ref)).toContain("ev-0030");
    expect(v.scheduleCA.rows.find((r) => r.line === "2")!.cells.B?.effective).toBe(410);
    expect(v.scheduleCA.other.map((c) => c.key)).toEqual(["SchCA540NR.A.itemized"]);
    expect(v.scheduleCA.rules.some((r) => r.id === "R-CA-WAGES-SOURCE")).toBe(true);
    expect(v.residency.caDays).toBe(195);
    expect(v.residency.yearDays).toBe(365);
    expect(v.residency.periods.find((p) => p.state === "CA")!.days).toBe(195);
    expect(v.residency.periods.find((p) => p.state === "CA")!.to).toBe("2025-07-14");
    expect(v.residency.periods.find((p) => p.state === "TX")!.from).toBe("2025-07-15");
    expect(v.amt.line?.key).toBe("F540NR.61");
    expect(v.amt.line?.rule).toBe("R-CA-AMT-NOT-COMPUTED");
    expect(v.amt.statement).toMatch(/not computed, review required/);
    expect(v.amt.statement).not.toMatch(/verified zero/);
    expect(v.amt.findings.some((f) => f.code === "CA_AMT_NOT_COMPUTED")).toBe(true);
    expect(v.wageSourcing.engine?.effective).toBe(218400);
    expect(v.wageSourcing.w2).toHaveLength(2);
    expect(v.wageSourcing.w2.map((w) => w.document.ref).sort()).toEqual(["D08", "D09"]);
    expect(v.wageSourcing.w2.find((w) => w.document.ref === "D09")!.box16?.value).toBe(111300);
    expect(v.wageSourcing.paystub?.values.map((x) => x.value)).toEqual([22469, 25969]);
    expect(v.wageSourcing.questionnaire?.id).toBe("qa-45");
    expect(v.wageSourcing.withholding?.key).toBe("F540NR.71");
    expect(v.wageSourcing.statements.join(" ")).toMatch(/judgment item/);
    expect(v.f540nr.length).toBeGreaterThan(10);
    expect(v.scheduleS[0]?.key).toBe("ScheduleS.credit");
    expect(v.ftb3885a).toHaveLength(4);
    expect(v.ftb5805[0]?.key).toBe("FTB5805.penalty");
    expect(v.depreciation.rows.find((d) => d.assetId === "SAC-APPL")?.difference).toBe(241.92);
    expect(v.depreciation.rows.find((d) => d.assetId === "SAC-APPL")?.line?.key).toBe("FTB3885A.SAC-APPL");
  });

  it("payments: the 1,000 federal and 3,500 California differences are called out, and the August IRS snapshot is hidden at the default clock", async () => {
    const v = await paymentsView(priya.ctx);
    expect(v.statement).toMatch(/not the tax/);
    expect(v.federal.line?.key).toBe("F1040.26");
    expect(v.federal.engineEntries).toHaveLength(4);
    expect(v.federal.confirmations).toHaveLength(3);
    expect(v.federal.totals.engine).toBe(13000);
    expect(v.federal.totals.confirmed).toBe(9000);
    expect(v.federal.totals.recorded).toBe(12000);
    expect(v.federal.totals.difference).toBe(1000);
    const fourth = v.federal.matches.find((m) => m.engine.date === "2026-01-14")!;
    expect(fourth.confirmation.kind).toBe("client_answer");
    expect(fourth.confirmation.refs.map((r) => r.ref)).toEqual(["qa-41"]);
    expect(fourth.record.status).toBe("differs");
    expect(fourth.record.amount).toBe(3000);
    expect(fourth.record.difference).toBe(1000);
    expect(v.federal.matches.filter((m) => m.record.status === "agrees")).toHaveLength(3);
    expect(v.federal.transcripts).toHaveLength(2);
    expect(v.federal.transcripts[0].available).toBe(true);
    expect(v.federal.transcripts[0].transactions).toHaveLength(4);
    expect(v.federal.transcripts[1].asOf).toBe("2026-08-03");
    expect(v.federal.transcripts[1].available).toBe(false);
    expect(v.federal.transcripts[1].transactions).toEqual([]);
    expect(v.federal.extension[0]?.key).toBe("Sch3.10");
    expect(v.federal.extensionOnTranscript.status).toBe("missing");
    expect(v.federal.verify.method).toBe("agreed_to_third_party_record");
    expect(v.federal.verify.evidenceRefs.map((r) => r.ref)).toEqual(["agency:/irs_account_transcript_2025/0", "D67"]);

    expect(v.california.line?.key).toBe("F540NR.72");
    expect(v.california.totals.engine).toBe(14000);
    expect(v.california.totals.recorded).toBe(10500);
    expect(v.california.totals.difference).toBe(3500);
    expect(v.california.creditedTo2024).toBe(3500);
    const september = v.california.matches.find((m) => m.engine.date === "2025-09-15")!;
    expect(september.confirmation.entry?.year).toBe("2024");
    expect(september.record.status).toBe("credited_elsewhere");
    expect(v.california.matches.filter((m) => m.record.status === "agrees")).toHaveLength(3);
    expect(v.california.otherYearConfirmations.map((o) => o.date)).toEqual(["2025-01-15", "2025-03-28"]);
    expect(v.california.ftb.available).toBe(true);
    expect(v.california.withholding[0]?.key).toBe("F540NR.71");
    expect(v.california.penalty[0]?.key).toBe("FTB5805.penalty");
    expect(v.california.verify.evidenceRefs.map((r) => r.ref)).toEqual(["agency:/ftb_account", "D68"]);
    expect(v.penaltyMethod.chosen?.key).toBe("F1040.38");
    expect(v.penaltyMethod.whatIf?.penaltyChange).toBe(0);
    expect(v.penaltyMethod.statement).toMatch(/R-2210-METHOD-CHOICE/);

    const original = priya.ctx.workspace.asOf;
    const moved = await priya.run("advance_time", { to: "2026-08-04T00:00:00Z" });
    expect(moved.ok).toBe(true);
    const later = await paymentsView(priya.ctx);
    expect(later.federal.transcripts[1].available).toBe(true);
    expect(later.federal.transcripts[1].transactions.length).toBeGreaterThan(4);
    expect(later.federal.totals.difference).toBe(1000);
    expect(later.federal.extensionOnTranscript.status).toBe("agrees");
    const back = await priya.run("advance_time", { to: new Date(original).toISOString() });
    expect(back.ok).toBe(true);

    const verified = await priya.run("add_verification", {
      subjectRef: "F1040.26",
      method: "agreed_to_third_party_record",
      evidenceRefs: ["agency:/irs_account_transcript_2025/0", "D67"],
      conclusion: "disagrees",
      note: "Transcript shows 3,000 on 2026-01-15, not the 4,000 the client reported.",
    });
    expect(verified.ok).toBe(true);
    const withVerification = await paymentsView(priya.ctx);
    expect(withVerification.federal.verify.existing).toHaveLength(1);
    expect(withVerification.federal.verify.existing[0].conclusion).toBe("disagrees");
  });

  it("carryovers: the 2023 K-1 open item pairs with D40, basis gaps stay unknown, and a verification on F7203.1 shows up against it", async () => {
    const v = await carryoversView(priya.ctx);
    const shortLoss = v.federal.find((r) => r.key === "capital_loss_short")!;
    expect(shortLoss.into).toBe(3200);
    expect(shortLoss.out).toBe(0);
    expect(shortLoss.difference).toBe(-3200);
    expect(shortLoss.usedBy.map((l) => l.key)).toEqual(["SchD.6"]);
    expect(v.federal.find((r) => r.key === "amt_credit")!.out).toBe(3871);
    expect(v.federal.find((r) => r.key === "ridgeline_capital_account_end")!.into).toBeNull();
    expect(v.california.find((r) => r.key === "capital_loss_short")!.out).toBeNull();
    expect(v.depreciationDifferences.map((d) => d.assetId)).toContain("SAC-APPL");
    expect(v.carryLines.map((l) => l.key)).toEqual(["F8606.2", "SchD.6", "SchD.14", "F8582.1c"]);

    const scorp = v.basis.find((g) => g.id === "scorp")!;
    expect(scorp.rows.map((r) => r.period)).toEqual(["2022", "2023", "2024"]);
    expect(scorp.rows[1].fields.find((f) => f.label === "Ending stock basis")!.unknown).toBe(true);
    expect(scorp.rows[1].fields.find((f) => f.label === "Ending stock basis")!.value).toBe("unknown");
    expect(scorp.filledBy?.document.ref).toBe("D40");
    expect(scorp.filledBy?.firstVersion).toBe("v3");
    expect(scorp.engineLines.find((l) => l.key === "F7203.1")?.effective).toBe(2300);
    const partnership = v.basis.find((g) => g.id === "partnership")!;
    expect(partnership.rows[0].fields.find((f) => f.label === "Outside basis")!.unknown).toBe(true);
    expect(partnership.note).toMatch(/Unknown stays unknown/);
    expect(v.basis.find((g) => g.id === "ira")!.engineLines.map((l) => l.key)).toEqual(["F8606.2", "F8606.14"]);
    expect(v.basis.find((g) => g.id === "home")!.rows[0].refs.some((r) => r.ref === "D54")).toBe(true);

    const k1 = v.priorPreparer.items.find((i) => i.kind === "open_item" && /2023 Woodworks K-1/.test(i.text))!;
    expect(k1).toBeDefined();
    expect(k1.documents.map((d) => d.ref)).toContain("D40");
    expect(k1.lines.map((l) => l.key)).toContain("F7203.1");
    expect(k1.status).toBe("not_yet_addressed");
    expect(k1.summary).toMatch(/D40/);
    const f3520 = v.priorPreparer.items.find((i) => /3520/.test(i.text))!;
    expect(f3520.status).toBe("not_yet_addressed");
    expect(v.priorPreparer.document.ref).toBe("D07");
    expect(v.priorPreparer.items.filter((i) => i.kind === "note")).toHaveLength(5);
    expect(v.priorPreparer.items.filter((i) => i.kind === "open_item")).toHaveLength(4);

    const verified = await priya.run("add_verification", {
      subjectRef: "F7203.1",
      method: "agreed_to_source_document",
      evidenceRefs: ["D40", "ev-0983", "ev-0985"],
      conclusion: "agrees",
      note: "2023 K-1 rolls the basis from 21,300 to the engine's 2,300 opening balance.",
    });
    expect(verified.ok).toBe(true);
    const after = await carryoversView(priya.ctx);
    const paired = after.priorPreparer.items.find((i) => i.id === k1.id)!;
    expect(paired.status).toBe("addressed");
    expect(paired.workpaper.map((w) => w.table)).toContain("verification");
    expect(paired.workpaper[0].actor.name).toBe("Priya Raman");
    expect(paired.workpaper[0].via).toContain("F7203.1");
  });

  it("every record view is free of sensitive values", async () => {
    const packet = loaded.packet;
    const views = await Promise.all([summaryView(priya.ctx), varianceView(priya.ctx), bridgeView(priya.ctx), californiaView(priya.ctx), paymentsView(priya.ctx), carryoversView(priya.ctx)]);
    for (const view of views) expect(looksSensitive(JSON.stringify(view), packet)).toBe(false);
    expect(JSON.stringify(views)).not.toMatch(/\b666-\d{2}-\d{4}\b/);
  });
});
