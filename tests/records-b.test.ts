import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db/client";
import type { LoadedPacket } from "@/packet/load";
import { looksSensitive } from "@/domain/redaction";
import { deductionsCreditsView, parseLotLabel, passthroughsView, rentalsView, retirementForeignView, salesView } from "@/server/queries/records-b";
import { importedDb } from "./helpers/db";
import { newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * The second half of the CPA record views: sales lots grouped by broker with
 * paging and the printed-but-missing lot, rentals with the HVAC note and the
 * passive loss lines, pass-through basis, the foreign interest rate choice and
 * the deductions callouts. Everything is redacted and respects the replay clock.
 */
describe("records-b views", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let priya: Persona;
  let helen: Persona;

  beforeAll(async () => {
    const db = await importedDb();
    handle = db.handle;
    loaded = db.loaded;
    const ws = await newWorkspace(handle, loaded);
    priya = await persona(handle, loaded, ws.id, "st-01");
    helen = await persona(handle, loaded, ws.id, "st-03");
  });
  afterAll(async () => {
    await handle.close();
  });

  it("parses a lot label into description, dates, amounts and the adjustment", () => {
    const p = parseLotLabel("Pinecrest Semiconductor Corp (acquired 2025-02-10, sold 2025-03-05; proceeds 3,885.00, basis 4,620.00, adjustment W 512.00)");
    expect(p).toEqual({ description: "Pinecrest Semiconductor Corp", acquired: "2025-02-10", sold: "2025-03-05", proceeds: 3885, basis: 4620, adjustment: { code: "W", amount: 512 } });
    const espp = parseLotLabel("Corvane Systems Inc (ESPP) (acquired 2024-06-28, sold 2025-03-10; proceeds 6,600.00, basis 3,825.00, adjustment B -675.00)");
    expect(espp.description).toBe("Corvane Systems Inc (ESPP)");
    expect(espp.adjustment).toEqual({ code: "B", amount: -675 });
  });

  it("sales view summarizes every box, groups 260 Brightpath lots and paginates them fifty at a time", async () => {
    const v = await salesView(priya.ctx);
    expect(v.version).toBe("v3");
    expect(v.boxes.map((b) => b.box)).toEqual(["A", "B", "D", "E", "F", "H", "K"]);
    const boxA = v.boxes.find((b) => b.box === "A")!;
    expect(boxA.proceeds).toBe(172667.96);
    expect(boxA.basis).toBe(174038.56);
    expect(boxA.adjustments).toBe(1583.05);
    expect(boxA.total.effective).toBe(212);
    expect(boxA.lotCount).toBe(119);
    expect(boxA.carriesTo?.key).toBe("SchD.1b");
    expect(v.groups.map((g) => g.id)).toEqual(["N", "M", "X", "C", "SCORP"]);
    const x = v.groups.find((g) => g.id === "X")!;
    expect(x.broker).toBe("Brightpath Advisors");
    expect(x.accountLabel).toBe("account ending 6620");
    expect(x.label).toBe("Brightpath Advisors, account ending 6620 (X lots)");
    expect(x.lotCount).toBe(260);
    expect(x.pageCount).toBe(6);
    expect(x.page).toBe(1);
    expect(x.lots).toHaveLength(50);
    expect(x.from).toBe(1);
    expect(x.to).toBe(50);
    expect(x.washSale.count).toBeGreaterThan(0);
    expect(x.unmatched).toEqual([]);
    expect(x.documents.map((d) => d.id)).toEqual(["D74"]);
    // Other groups stay on their first page when another group is paged.
    const paged = await salesView(priya.ctx, { group: "x", page: 3 });
    const x3 = paged.groups.find((g) => g.id === "X")!;
    expect(x3.page).toBe(3);
    expect(x3.from).toBe(101);
    expect(x3.to).toBe(150);
    expect(x3.lots).toHaveLength(50);
    expect(paged.groups.find((g) => g.id === "M")!.page).toBe(1);
    const last = await salesView(priya.ctx, { group: "X", page: 99 });
    const x6 = last.groups.find((g) => g.id === "X")!;
    expect(x6.page).toBe(6);
    expect(x6.lots).toHaveLength(10);
    expect(x6.lots.every((l) => l.acquired && l.sold && l.proceeds !== null && l.basis !== null)).toBe(true);
    const wash = x6.lots.find((l) => l.adjustment?.code === "W") ?? x.lots.find((l) => l.adjustment?.code === "W");
    expect(wash?.adjustment?.amount).toBeGreaterThan(0);
  });

  it("sales view finds Meridian M18 printed on the corrected statement but not on the return, with the summary mismatch", async () => {
    const v = await salesView(priya.ctx);
    const m = v.groups.find((g) => g.id === "M")!;
    expect(m.broker).toBe("Meridian Brokerage");
    expect(m.lotCount).toBe(17);
    expect(m.documents.map((d) => d.id)).toEqual(["D31"]);
    expect(m.unmatched).toHaveLength(1);
    const m18 = m.unmatched[0];
    expect(m18.lotId).toBe("M18");
    expect(m18.documentId).toBe("D31");
    expect(m18.page).toBe(32);
    expect(m18.status).toBe("printed on the corrected statement, not extracted, not on the return");
    expect(m18.parsed.proceeds).toBe(250);
    expect(m18.parsed.basis).toBe(310);
    expect(m18.href).toBe("/evidence/D31?page=32");
    expect(m18.anchorHref).toBe("/evidence/D31?page=32#anchor-subject");
    expect(m18.extractionReason).toMatch(/Page 32/);
    expect(m.summaryCheck).not.toBeNull();
    expect(m.summaryCheck!.diagnostic?.code).toBe("BROKER_SUMMARY_DETAIL_MISMATCH");
    expect(m.summaryCheck!.diagnostic?.refs.map((r) => r.ref)).toEqual(["ev-0703"]);
    expect(m.summaryCheck!.summaryAmount).toBe(71965);
    expect(m.summaryCheck!.lotProceeds).toBe(71715);
    expect(m.summaryCheck!.difference).toBe(250);
    expect(m.summaryCheck!.explains).toEqual(["M18"]);
    // Searching by lot id keeps the unmatched lot and drops everything else.
    const q = await salesView(priya.ctx, { q: "M18" });
    expect(q.matched).toBe(0);
    expect(q.groups.find((g) => g.id === "M")!.unmatched.map((u) => u.lotId)).toEqual(["M18"]);
    const byName = await salesView(priya.ctx, { q: "pinecrest" });
    expect(byName.matched).toBe(3);
    expect(byName.groups.find((g) => g.id === "M")!.lots.map((l) => l.lotId)).toEqual(["M3", "M4", "M6"]);
  });

  it("sales view flags RSU lots N1, N3, N4 with the supplemental basis as unmatched evidence and N2 as already adjusted", async () => {
    const v = await salesView(priya.ctx);
    const n = v.groups.find((g) => g.id === "N")!;
    expect(n.broker).toBe("Northlake Securities");
    // The supplement is cited by one lot, so it is listed after the broker statement.
    expect(n.documents.map((d) => d.id)).toEqual(["D28", "D11"]);
    const lot = (id: string) => n.lots.find((l) => l.lotId === id)!;
    for (const [id, evId, basis] of [
      ["N1", "ev-0066", "19,100.00"],
      ["N3", "ev-0068", "19,100.00"],
      ["N4", "ev-0070", "9,420.00"],
    ] as const) {
      const l = lot(id);
      expect(l.basis).toBe(0);
      const flag = l.flags.find((f) => f.kind === "basis_unmatched");
      expect(flag, id).toBeDefined();
      expect(flag!.refs.map((r) => r.ref)).toEqual([evId]);
      expect(flag!.evidence.map((e) => e.id)).toContain(evId);
      expect(flag!.evidence.find((e) => e.id === evId)!.display).toBe(basis);
      expect(flag!.evidence.find((e) => e.id === evId)!.usedBy).toEqual([]);
      expect(flag!.detail).toMatch(/not among this lot's sources/);
    }
    const n2 = lot("N2");
    expect(n2.flags.map((f) => f.kind)).toEqual(["supplement_matched"]);
    expect(n2.flags[0].label).toBe("already adjusted by the engine");
    expect(n2.flags[0].refs.map((r) => r.ref)).toEqual(["ev-0072"]);
    expect(n2.adjustment).toEqual({ code: "B", amount: -675 });
    expect(lot("N5").flags).toEqual([]);
    // The crypto lot with no basis carries the engine diagnostic.
    const c = v.groups.find((g) => g.id === "C")!;
    const c6 = c.lots.find((l) => l.lotId === "C6")!;
    expect(c6.basis).toBe(0);
    expect(c6.flags.map((f) => f.label)).toEqual(["engine diagnostic DIGITAL_ASSET_BASIS_MISSING"]);
    expect(c.clientItems.map((i) => i.id)).toContain("msg-07");
    // Schedule D and the carryovers.
    expect(v.schD.find((l) => l.key === "SchD.6")!.effective).toBe(-3200);
    expect(v.schD.find((l) => l.key === "SchD.14")!.effective).toBe(-11000);
    expect(v.carryovers.into.map((c) => c.amount)).toEqual([3200, 11000]);
    expect(v.carryovers.into.every((c) => c.ref.found)).toBe(true);
    expect(v.carryovers.out.map((c) => c.amount)).toEqual([0, 0]);
    const scorp = v.groups.find((g) => g.id === "SCORP")!;
    expect(scorp.passthroughHref).toBe("/review/passthroughs");
    expect(scorp.lots[0].gain).toBe(21215);
  });

  it("rentals view shows both properties side by side, the HVAC 11,000 inside repairs and the Form 8582 lines", async () => {
    const v = await rentalsView(priya.ctx);
    expect(v.properties.map((p) => p.column)).toEqual(["A", "B"]);
    const a = v.properties[0];
    expect(a.address).toMatch(/1450 Fremont Way/);
    expect(a.book?.id).toBe("D46");
    expect(a.book?.values.find((x) => x.id === "ev-1001")?.display).toBe("11,000.00");
    expect(a.supporting.map((d) => d.id)).toEqual(["D47", "D48", "D49"]);
    expect(a.days?.effective).toBe("365 / 0");
    const bProp = v.properties[1];
    expect(bProp.book?.id).toBe("D50");
    expect(bProp.supporting.map((d) => d.id)).toContain("D51");
    expect(bProp.supporting.map((d) => d.id)).toContain("D53");
    const rents = v.grid.find((r) => r.lineNo === "3")!;
    expect(rents.label).toBe("Rents received");
    expect(rents.cells.map((c) => c?.key)).toEqual(["SchE.3A", "SchE.3B"]);
    expect(rents.cells[0]!.effective).toBe(37200);
    expect(v.grid.find((r) => r.lineNo === "19")!.cells.map((c) => c?.key ?? null)).toEqual([null, "SchE.19B"]);

    expect(v.hvac.line?.key).toBe("SchE.14A");
    expect(v.hvac.line?.effective).toBe(13300);
    expect(v.hvac.note).toBe("HVAC 11,000.00 is inside repairs per the owner statement.");
    expect(v.hvac.evidence.map((e) => e.id)).toEqual(["ev-1001", "ev-1004", "ev-1005"]);
    expect(v.hvac.evidence[0].display).toBe("11,000.00");
    expect(v.hvac.invoice?.id).toBe("D47");
    expect(v.hvac.whatIf?.id).toBe("hvac_improvement");
    expect(v.hvac.whatIf?.federalTaxChange).toBe(3633);
    expect(v.hvac.whatIf?.californiaTaxChange).toBe(896);
    expect(v.hvac.whatIf?.changedLines.find((c) => c.key === "SchE.14A")).toMatchObject({ old: 13300, new: 2300 });
    expect(v.hvac.judgments).toEqual([]);
    expect(v.hvac.judgmentHref).toBe("/review/judgments?subject=SchE.14A");
    expect(v.hvac.clientItems.map((c) => c.id)).toEqual(["qa-37", "call-01"]);

    expect(v.sale.lines.map((l) => l.key)).toEqual(["F4797.20", "F4797.21", "F4797.22", "F4797.23", "F4797.24", "F4797.25", "F4797.26g", "F4797.32", "F4797.7", "F4797.8", "F4797.9"]);
    expect(v.sale.recapture.map((l) => l.key)).toEqual(["F4797.23", "F4797.26g", "SchD.19"]);
    expect(v.sale.notes.map((n) => n.key)).toEqual(["F4797.26g"]);
    expect(v.sale.docs.map((d) => d.id)).toEqual(["D51", "D52", "D53"]);
    expect(v.sale.assets.map((a) => a.ref)).toEqual(["asset:AUS-BLDG", "asset:AUS-FLOOR"]);

    expect(v.passive.lines.map((l) => l.key)).toEqual(["F8582.1a", "F8582.1b", "F8582.1c", "F8582.3a", "F8582.4"]);
    expect(v.passive.lines.find((l) => l.key === "F8582.1c")!.effective).toBe(-16150);
    expect(v.passive.prior.map((p) => p.amount)).toEqual([6300, 9850]);
    expect(v.passive.allowed.map((l) => [l.key, l.effective])).toEqual([
      ["SchE.22A", -22257],
      ["SchE.22B", -16373],
    ]);
    expect(v.passive.out.map((o) => o.amount)).toEqual([0, 0]);
    expect(v.passive.note).toMatch(/all current and prior-year passive losses are allowed/);
    expect(v.depreciation.href).toBe("/review/assets");
    expect(v.depreciation.lines.map((l) => l.key)).toEqual(["F4562-E.total-A", "F4562-E.total-B"]);
  });

  it("passthroughs view shows F7203 beginning basis 2,300 reproduced from the records and an unknown outside basis", async () => {
    const v = await passthroughsView(priya.ctx);
    expect(v.entities.map((e) => e.name)).toEqual(["Lindqvist Family Woodworks, Inc.", "Ridgeline Real Estate Fund III LP"]);
    expect(v.entities[0].lines.map((l) => l.key)).toContain("SchE.28A");
    expect(v.entities[0].lines.map((l) => l.key)).toContain("F8949.F.SCORP");
    expect(v.entities[0].docs.map((d) => d.id)).toEqual(["D39", "D40"]);
    expect(v.entities[1].lines.map((l) => l.key)).toContain("SchE.28B");
    expect(v.entities[1].docs.map((d) => d.id)).toEqual(["D37", "D38"]);

    const s = v.scorpBasis;
    expect(s.engineBeginning?.key).toBe("F7203.1");
    expect(s.engineBeginning?.effective).toBe(2300);
    expect(s.records.map((r) => [r.year, r.endingStockBasis])).toEqual([
      [2022, 21300],
      [2023, null],
      [2024, null],
    ]);
    expect(s.rollforward.map((r) => [r.year, r.ending, r.basis])).toEqual([
      [2022, 21300, "record"],
      [2023, 15400, "document"],
      [2024, 2300, "record"],
    ]);
    expect(s.rollforward[1].refs.map((r) => r.ref)).toEqual(["py:/basis_records/scorp_lindqvist_family_woodworks/1", "ev-0983", "ev-0984", "ev-0985"]);
    expect(s.rollforward[1].refs.every((r) => r.found)).toBe(true);
    expect(s.computedBeginning).toBe(2300);
    expect(s.matches).toBe(true);
    expect(s.versions.map((x) => [x.version, x.value])).toEqual([
      ["v1", 8200],
      ["v2", 8200],
      ["v3", 2300],
    ]);
    expect(s.versions[0].note).toMatch(/assumed zero net change/);
    expect(s.diagnostic.code).toBe("SCORP_BASIS_INCOMPLETE");
    expect(s.diagnostic.versions.map((x) => x.present)).toEqual([true, true, false]);
    expect(s.diagnostic.active).toBe(false);
    expect(s.diagnostic.finding).toBeNull();
    expect(s.distributions.distributions?.effective).toBe(42000);
    expect(s.distributions.basisBefore?.effective).toBe(20785);
    expect(s.distributions.excess?.effective).toBe(21215);
    expect(s.distributions.gainLine?.key).toBe("F8949.F.SCORP");

    const p = v.partnership;
    expect(p.capitalAccount.amount).toBe(63660);
    expect(p.capitalAccount.refs.map((r) => r.ref)).toEqual(["ev-0970"]);
    expect(p.outsideBasis.known).toBe(false);
    expect(p.outsideBasis.label).toBe("unknown");
    expect(p.outsideBasis.record).toMatch(/outside basis never computed/);
    expect(p.stateSupplement.doc?.id).toBe("D38");
    expect(p.stateSupplement.facts.map((f) => f.display)).toEqual(["0.22%", "0.31%", "0.27%", "0.2%"]);
    expect(p.stateSupplement.printed).toMatch(/Arizona composite return/);
    expect(p.stateSupplement.note).toMatch(/does not create, assume or schedule an Arizona filing/);

    expect(v.relatedReturns).toHaveLength(3);
    expect(v.relatedReturns.every((r) => /contents unknown/.test(r.contents))).toBe(true);
    expect(v.relatedReturns[0].inPacket).toBe("not in this packet");
    expect(v.relatedReturns[1].docs.map((d) => d.id)).toEqual(["D39", "D40"]);
    expect(v.relatedReturns[2].preparedBy).toBe("fund administrator");

    expect(v.lateK1.events.map((e) => [e.id, e.at.slice(0, 10)])).toEqual([["tl-16", "2026-06-22"]]);
    expect(v.lateK1.diagnostic.versions.map((x) => x.present)).toEqual([true, true, false]);
    expect(v.lateK1.changes.find((c) => c.key === "SchE.28B")).toMatchObject({ change: "added", new: 8400 });
    expect(v.lateK1.clientItems.map((c) => c.id)).toContain("qa-13");
  });

  it("retirement view shows SchB.1.6 at 10.56 with the 9.86 alternative as an identified rate choice, the IRA basis conflict and the SEP open item", async () => {
    const v = await retirementForeignView(priya.ctx);
    const f = v.foreign;
    expect(f.interest?.key).toBe("SchB.1.6");
    expect(f.interest?.effective).toBe(1747);
    expect(f.sek?.id).toBe("ev-0960");
    expect(f.sekAmount).toBe(18450);
    expect(f.rateUsed).toMatchObject({ rate: "2024_average", value: 10.56, usd: 1747, used: true });
    const alt = f.alternatives.find((a) => a.rate === "2025_average")!;
    expect(alt.value).toBe(9.86);
    expect(alt.usd).toBe(1871);
    expect(alt.used).toBe(false);
    expect(f.rateNote).toMatch(/^Identified rate choice to document/);
    expect(f.rateNote).toMatch(/none is applied here/);
    expect(f.account.map((l) => [l.key, l.effective])).toEqual([
      ["SchB.7a", "Yes"],
      ["SchB.7b", "Sweden"],
      ["SchB.8", "No"],
    ]);
    expect(f.f8938.map((l) => l.key)).toEqual(["F8938.1.max", "F8938.1.ye", "F8938.req"]);
    expect(f.yearEndRate).toMatchObject({ rate: "2025_year_end", value: 9.71 });
    expect(f.maxValue?.display).toBe("1,452,300.00");
    expect(f.yeValue?.display).toBe("1,196,800.00");
    expect(f.fbar.diagnostic.active).toBe(true);
    expect(f.fbar.diagnostic.finding?.code).toBe("FBAR_OUTSIDE_RETURN");
    expect(f.fbar.deadline?.date).toBe("2026-10-15");
    expect(f.doc?.id).toBe("D36");
    const account = f.doc!.values.find((x) => x.valueType === "account_number")!;
    expect(account.display).toMatch(/^\*\*\*\*/);
    expect(f.doc!.pages[0].text).not.toMatch(/SE45 8000/);
    expect(f.doc!.pages[0].text).toMatch(/\*\*\*\*9901/);

    expect(v.ira.lines.map((l) => l.key)).toContain("F8606.18");
    expect(v.ira.lines.find((l) => l.key === "F8606.18")!.effective).toBe(26);
    expect(v.ira.priorBasis.amount).toBe(7000);
    expect(v.ira.priorBasis.refs.map((r) => r.ref)).toEqual(["py:/return_2024/lines/F8606.14", "ev-0991"]);
    expect(v.ira.questionnaire?.id).toBe("qa-31");
    expect(v.ira.questionnaire?.text).toMatch(/Prior basis: none/);
    expect(v.ira.conflict).toMatch(/engine carried 7,000/);
    expect(v.ira.docs.map((d) => d.id)).toEqual(["D41", "D42", "D43"]);

    expect(v.hsa.limit).toMatchObject({ name: "hsa_family_limit", display: "8,550", ref: "ref:param.hsa_family_limit" });
    expect(v.hsa.codeW.map((x) => [x.id, x.display])).toEqual([
      ["ev-0024", "2,500.00"],
      ["ev-0043", "3,500.00"],
      ["ev-0060", "3,500.00"],
    ]);
    expect(v.hsa.codeW[0].usedBy).toContain("F8889.9");
    expect(v.hsa.codeW[2].usedBy).toEqual([]);
    expect(v.hsa.docs.map((d) => d.id)).toEqual(["D44", "D45"]);

    expect(v.sep.line?.effective).toBe(15214);
    expect(v.sep.note).toMatch(/limit 20%/);
    expect(v.sep.deposited).toBe(18000);
    expect(v.sep.doc?.id).toBe("D26");
    expect(v.sep.notDeductible.amount).toBe(2786);
    expect(v.sep.notDeductible.label).toMatch(/sep_contribution_not_deductible_for_2025/);
    expect(v.sep.openItem).toMatch(/^Open item/);

    expect(v.sehi.line?.effective).toBe(14400);
    expect(v.sehi.doc?.id).toBe("D25");
    expect(v.sehi.questionnaire?.id).toBe("qa-25");
    expect(v.sehi.priorYearNote).toMatch(/covered on Ngozi's employer plan/);
    expect(v.sehi.judgmentItem).toMatch(/Nothing is disallowed automatically/);
  });

  it("deductions view shows the payoff-interest duplicate risk, the vehicle auction value, the provider mismatches and the due diligence status", async () => {
    const v = await deductionsCreditsView(priya.ctx);
    expect(v.salt.params.map((p) => [p.name, p.display])).toEqual([
      ["salt_cap", "40,000"],
      ["salt_cap_phase_start", "500,000"],
      ["salt_cap_phase_rate", "0.3"],
      ["salt_cap_floor", "10,000"],
    ]);
    expect(v.salt.rules.map((r) => r.id)).toEqual(["R-SALT-INCOME", "R-SALT-PROPERTY", "R-SALT-CAP"]);
    expect(v.salt.lines.map((l) => l.key)).toEqual(["SchA.5a", "SchA.5b", "SchA.5d", "SchA.5e", "SchA.7"]);
    expect(v.salt.capApplies).toMatch(/below the phase start/);

    expect(v.propertyTax.line?.key).toBe("SchA.5b");
    expect(v.propertyTax.sellerCredit?.detail).toMatch(/6,912\.00/);
    expect(v.propertyTax.sellerCredit?.docs.map((d) => d.id)).toEqual(["D54"]);
    expect(v.propertyTax.docs.map((d) => d.id)).toEqual(["D57", "D58"]);

    const payoff = v.mortgage.payoff!;
    expect(payoff.title).toMatch(/Duplicate risk/);
    expect(payoff.detail).toMatch(/includes prepaid interest at closing and interest paid at payoff 11\/20\/2025/);
    expect(payoff.detail).toMatch(/2,150\.00/);
    expect(payoff.docs.map((d) => d.id)).toEqual(["D55", "D56"]);
    expect(payoff.actions[0].href).toBe("/review/line/SchA.8a#propose");
    expect(v.mortgage.docs.map((d) => d.id)).toEqual(["D48", "D53", "D55", "D56", "D57"]);
    expect(v.mortgage.rentalInterest?.key).toBe("SchE.12B");

    const low = v.charitable.cash.lowConfidence!;
    expect(low.evidence[0]).toMatchObject({ id: "ev-1049", display: "1,500.00", confidence: 0.41 });
    expect(low.refs.some((r) => r.ref.startsWith("finding:"))).toBe(true);
    expect(low.detail).toMatch(/arrives 2026-07-01, after the replay clock/);
    expect(v.charitable.cash.corroboration.map((c) => [c.id, c.available, c.text])).toEqual([["msg-08", false, null]]);
    expect(v.charitable.cash.docs.map((d) => d.id)).toEqual(["D63", "D64"]);
    const vehicle = v.charitable.noncash.vehicle!;
    expect(vehicle.detail).toMatch(/carries 6,000/);
    expect(vehicle.detail).toMatch(/gross proceeds from sale 2,900\.00/);
    expect(vehicle.evidence.map((e) => e.id)).toEqual(["ev-1054"]);
    expect(vehicle.refs.map((r) => r.ref)).toEqual(["ev-1054", "qa-39"]);
    expect(v.charitable.noncash.docs.map((d) => d.id)).toEqual(["D65", "D66"]);

    expect(v.education.lines.map((l) => l.key)).toEqual(["F8863.27", "F8863.30", "F8863.7"]);
    expect(v.education.params[0]).toMatchObject({ name: "aotc_phaseout", display: "160,000 to 180,000" });
    expect(v.education.diagnostic.active).toBe(true);
    expect(v.education.docs.map((d) => d.id)).toEqual(["D59", "D60"]);
    expect(v.education.docs[0].values.some((x) => x.display.includes("666-38"))).toBe(false);

    expect(v.dependentCare.callouts.map((c) => c.id)).toEqual(["name-F2441.1a", "ein-F2441.1b"]);
    expect(v.dependentCare.callouts[0].detail).toMatch(/Bright Oak Preschool.*Bright Oak Kids Club/);
    expect(v.dependentCare.callouts[1].detail).toMatch(/74-3829516.*74-3829156/);
    expect(v.dependentCare.callouts[1].actions[0].href).toBe("/evidence/D62?page=1");
    expect(v.dependentCare.params.map((p) => p.display)).toEqual(["3,000", "5,000"]);

    expect(v.childTaxCredit.lines.map((l) => l.key)).toContain("F8812.11");
    expect(v.childTaxCredit.params.map((p) => [p.name, p.display])).toEqual([
      ["ctc_per_child", "2,200"],
      ["odc_per_dependent", "500"],
      ["ctc_phaseout_start", "400,000"],
    ]);
    expect(v.dueDiligence.line?.effective).toBe("Not completed");
    expect(v.dueDiligence.finding?.code).toBe("DUE_DILIGENCE_REQUIRED");
    expect(v.dueDiligence.finding?.status).toBe("open");
    expect(v.dueDiligence.href).toBe("/review/judgments?subject=F8867.status");
    expect(v.itemizedTotal?.effective).toBe(85706);
  });

  it("evidence after the replay clock is listed with its arrival date and no content, and appears once the clock passes it", async () => {
    const before = await passthroughsView(priya.ctx);
    expect(before.asOf.slice(0, 10)).toBe("2026-06-23");
    expect(before.entities[1].docs.every((d) => d.available)).toBe(true);
    const beforeRetire = await retirementForeignView(priya.ctx);
    expect(beforeRetire.ira.docs.every((d) => d.available)).toBe(true);

    const moved = await priya.run("advance_time", { to: "2026-03-10T00:00:00Z" });
    expect(moved.ok).toBe(true);
    const early = await passthroughsView(priya.ctx);
    const ridgeline = early.entities[1].docs.find((d) => d.id === "D37")!;
    expect(ridgeline.available).toBe(false);
    expect(ridgeline.receivedAt.slice(0, 10)).toBe("2026-06-22");
    expect(ridgeline.values).toEqual([]);
    expect(early.partnership.stateSupplement.printed).toBeNull();
    expect(early.partnership.stateSupplement.facts).toEqual([]);
    expect(early.scorpBasis.rollforward.find((r) => r.year === 2023)?.basis).toBe("gap");
    expect(early.scorpBasis.computedBeginning).toBeNull();
    const earlyRetire = await retirementForeignView(priya.ctx);
    expect(earlyRetire.sep.deposit.map((d) => [d.id, d.available, d.display, d.availableAt?.slice(0, 10)])).toEqual([
      ["ev-0485", false, "", "2026-04-10"],
      ["ev-0486", false, "", "2026-04-10"],
    ]);
    expect(earlyRetire.sep.doc?.available).toBe(false);
    expect(earlyRetire.sep.doc?.values).toEqual([]);
    expect(earlyRetire.ira.docs.find((d) => d.id === "D43")?.available).toBe(false);
    const earlySales = await salesView(priya.ctx);
    expect(earlySales.groups.find((g) => g.id === "C")!.clientItems.find((c) => c.id === "msg-07")?.text).toBeNull();

    const later = await priya.run("advance_time", { to: "2026-07-02T00:00:00Z" });
    expect(later.ok).toBe(true);
    const corroborated = await deductionsCreditsView(priya.ctx);
    expect(corroborated.charitable.cash.corroboration.map((c) => [c.id, c.available])).toEqual([["msg-08", true]]);
    expect(corroborated.charitable.cash.corroboration[0].text).toMatch(/1,500/);
    expect(corroborated.charitable.cash.lowConfidence?.detail).toMatch(/corroboration is in the file/);
    await priya.run("advance_time", { to: "2026-06-23T06:05:00Z" });
  });

  it("an accepted adjustment shows as adjusted on the lot and recomputed on the box total", async () => {
    const proposed = await priya.run("propose_adjustment", {
      targetRef: "F8949.B.N1",
      kind: "value",
      proposedValue: 140,
      reason: "Supplemental statement adjusted basis 19,100.00 for RSU-2502; the broker reported 0.00.",
      evidenceRefs: ["ev-0066", "ev-0067"],
      category: "stcg",
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const accepted = await helen.run("decide_adjustment", { adjustmentId: (proposed.result as { adjustmentId: string }).adjustmentId, decision: "accept" });
    expect(accepted.ok).toBe(true);
    const v = await salesView(helen.ctx);
    const n1 = v.groups.find((g) => g.id === "N")!.lots.find((l) => l.lotId === "N1")!;
    expect(n1.status).toBe("adjusted");
    expect(n1.gain).toBe(140);
    expect(n1.baseline).toBe(19240);
    const boxB = v.boxes.find((b) => b.box === "B")!;
    expect(boxB.total.status).toBe("recomputed");
    expect(boxB.total.effective).toBe(140 + 18480);
    expect(v.schD.find((l) => l.key === "SchD.2")!.status).toBe("recomputed");
  });

  it("no view leaks a sensitive literal", async () => {
    const packet = loaded.packet;
    const views = [
      JSON.stringify(await salesView(priya.ctx)),
      JSON.stringify(await salesView(priya.ctx, { group: "X", page: 4 })),
      JSON.stringify(await rentalsView(priya.ctx)),
      JSON.stringify(await passthroughsView(priya.ctx)),
      JSON.stringify(await retirementForeignView(priya.ctx)),
      JSON.stringify(await deductionsCreditsView(priya.ctx)),
    ];
    for (const text of views) expect(looksSensitive(text, packet)).toBe(false);
  });
});
