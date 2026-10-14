import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db/client";
import type { LoadedPacket } from "@/packet/load";
import { looksSensitive } from "@/domain/redaction";
import { loadClientItems, loadDocumentIndex, loadDocumentPage, loadRecords, locateExtractedValue } from "@/server/queries/evidence";
import { sourcesOf, usesOf } from "@/server/queries/trace";
import { importedDb } from "./helpers/db";
import { newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * Evidence: trace any number to its exact source, and any document to
 * everywhere it landed (or why it did not). Every read model is checked for
 * redaction: no SSN, account number, PIN, EFIN or PTIN may leave the server.
 */
describe("evidence tracing", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let wsId: string;
  let priya: Persona;

  beforeAll(async () => {
    const db = await importedDb();
    handle = db.handle;
    loaded = db.loaded;
    const ws = await newWorkspace(handle, loaded);
    wsId = ws.id;
    priya = await persona(handle, loaded, wsId, "st-01");
  });
  afterAll(async () => {
    await handle.close();
  });

  const packet = () => loaded.packet;
  const sensitive = (value: unknown) => looksSensitive(JSON.stringify(value), packet());

  it("ev-1045 is used by F2441.1b in v1, v2 and v3", async () => {
    const uses = await usesOf(priya.ctx, "ev-1045");
    expect(uses.found).toBe(true);
    expect(uses.version).toBe("v3");
    expect(uses.direct.map((d) => d.key)).toEqual(["F2441.1b"]);
    expect(uses.direct[0].via).toEqual(["ev-1045"]);
    expect(uses.byVersion).toEqual({ v1: ["F2441.1b"], v2: ["F2441.1b"], v3: ["F2441.1b"] });
    // F2441.1b feeds qualified expenses and the credit itself.
    expect(uses.transitive.map((t) => t.key)).toContain("F2441.2");
    expect(uses.transitive.map((t) => t.key)).toContain("F2441.31");
    expect(uses.transitive.every((t) => t.relation === "transitive")).toBe(true);
  });

  it("D62 page 1 reports the extracted EIN as not found and locates the printed Tax ID", async () => {
    const view = await loadDocumentPage(priya.ctx, "D62", 1);
    expect(view).not.toBeNull();
    expect(view!.available).toBe(true);
    expect(view!.printed).toContain("Tax ID 74-3829156");
    const ein = view!.values.find((v) => v.id === "ev-1045")!;
    expect(ein.anchorState).toBe("not_found");
    expect(ein.textAsRead).toBe("74-3829516");
    expect(ein.printedCandidate).toEqual({ label: "Tax ID", printed: "74-3829156", differs: true });
    // The conflicting printed text is marked on the page; the extracted text never is.
    const printedSegments = view!.segments.filter((s) => s.printed.includes("ev-1045"));
    expect(printedSegments.map((s) => s.text).join("")).toBe("74-3829156");
    expect(view!.segments.some((s) => s.values.includes("ev-1045"))).toBe(false);
    // The amount is printed exactly once and highlighted.
    const amount = view!.values.find((v) => v.id === "ev-1046")!;
    expect(amount.anchorState).toBe("found");
    expect(view!.segments.filter((s) => s.values.includes("ev-1046")).map((s) => s.text).join("")).toBe("4,200.00");
    expect(amount.usedBy).toEqual(["F2441.1b"]);
    expect(view!.landed.direct.map((l) => l.key)).toEqual(["F2441.1b"]);
    expect(view!.subjectSuggestions[0].ref).toBe("F2441.1b");
  });

  it("D31 page 32 has zero extracted values and offers nothing to the engine", async () => {
    const view = await loadDocumentPage(priya.ctx, "D31", 32);
    expect(view!.values).toHaveLength(0);
    expect(view!.landed.nothingLanded).toBe(true);
    expect(view!.printed).toContain("proceeds 250.00 basis 310.00");
    expect(view!.document.supersedes).toEqual({ id: "D30", title: "Meridian Brokerage 2025 consolidated Form 1099 (joint)" });
    expect(view!.document.supersededBy).toBeNull();
  });

  it("manual anchors are highlighted in their own layer and listed with their subject", async () => {
    const r = await priya.run("add_anchor", {
      subjectRef: "SchD.1b",
      documentId: "D31",
      page: 32,
      textSpan: "proceeds 250.00 basis 310.00",
      note: "Lot M18 printed only on the supplemental page",
    });
    expect(r.ok).toBe(true);
    const view = await loadDocumentPage(priya.ctx, "D31", 32);
    expect(view!.anchors).toHaveLength(1);
    expect(view!.anchors[0].located).toBe(true);
    expect(view!.anchors[0].subjectRef).toBe("SchD.1b");
    const anchored = view!.segments.filter((s) => s.anchors.includes(view!.anchors[0].id));
    expect(anchored.map((s) => s.text).join("")).toBe("proceeds 250.00 basis 310.00");
    expect(view!.workpaper.some((w) => w.table === "anchor")).toBe(true);
    // The anchor is a workpaper edge the forward trace sees as well.
    const uses = await usesOf(priya.ctx, "doc:D31#page32");
    expect(uses.workpaper.map((w) => w.table)).toContain("anchor");
    expect(uses.edges.some((e) => e.relation === "anchors" && e.workspace)).toBe(true);
  });

  it("D30 is superseded by D31 in v3 and the index says so", async () => {
    const index = await loadDocumentIndex(priya.ctx);
    expect(index.rows).toHaveLength(74);
    const d30 = index.rows.find((r) => r.id === "D30")!;
    expect(d30.supersededBy).toBe("D31");
    expect(d30.disposition).toBe("superseded");
    const d31 = index.rows.find((r) => r.id === "D31")!;
    expect(d31.supersedes).toBe("D30");
    expect(d31.disposition).toBe("used");
    expect(d31.directUses).toBe(24);
    expect(d31.usedValues).toBeGreaterThan(100);
    expect(d30.directUses).toBe(0);
    const page = await loadDocumentPage(priya.ctx, "D30", 1);
    expect(page!.document.supersededBy?.id).toBe("D31");
    const uses = await usesOf(priya.ctx, "D30");
    // The forward trace reports every version that recorded the supersession; the index only looks at the active one.
    expect(uses.supersededBy).toEqual([{ documentId: "D31", label: "Meridian Brokerage 2025 consolidated Form 1099 - CORRECTED (joint)", versions: ["v2", "v3"] }]);
  });

  it("at the default clock D71 and msg-07 are not available and D37 is", async () => {
    expect(new Date(priya.ctx.workspace.asOf).toISOString().slice(0, 10)).toBe("2026-06-23");
    const index = await loadDocumentIndex(priya.ctx);
    const d71 = index.rows.find((r) => r.id === "D71")!;
    expect(d71.available).toBe(false);
    expect(d71.disposition).toBe("not_yet_available");
    expect(index.rows.find((r) => r.id === "D37")!.available).toBe(true);
    const page = await loadDocumentPage(priya.ctx, "D71", 1);
    expect(page!.available).toBe(false);
    expect(page!.printed).toBeNull();
    expect(page!.values).toHaveLength(0);
    expect(page!.segments).toHaveLength(0);
    const client = await loadClientItems(priya.ctx);
    const msg7 = client.messages.find((m) => m.id === "msg-07")!;
    expect(msg7.available).toBe(false);
    expect(msg7.body).toBeNull();
    const msg5 = client.messages.find((m) => m.id === "msg-05")!;
    expect(msg5.available).toBe(true);
    expect(msg5.body).toMatch(/corrected 1099/);
    const qa22 = client.questionnaire.find((q) => q.id === "qa-22")!;
    expect(qa22.lines.map((l) => l.key)).toEqual(["SchC.I"]);
    const call = client.callNotes.find((c) => c.id === "call-01")!;
    expect(call.available).toBe(true);
    expect(call.notes.length).toBeGreaterThan(0);
  });

  it("the engine's stated reason surfaces for the duplicate W-2 image D10", async () => {
    const view = await loadDocumentPage(priya.ctx, "D10", 1);
    expect(view!.landed.nothingLanded).toBe(true);
    expect(view!.landed.engineNotes.map((n) => n.key)).toEqual(["F1040.1a"]);
    expect(view!.landed.engineNotes[0].note).toMatch(/counted once/);
    expect(view!.landed.unusedValues.length).toBe(view!.values.length);
    expect(sensitive(view)).toBe(false);
  });

  it("sourcesOf(SchC.1) resolves all seven sources with labels and availability", async () => {
    const s = await sourcesOf(priya.ctx, "SchC.1");
    expect(s.found).toBe(true);
    expect(s.line?.label).toBe("Gross receipts");
    expect(s.sources).toHaveLength(7);
    expect(s.sources.every((x) => x.found && x.state === "resolved" && x.available)).toBe(true);
    expect(s.sources.map((x) => x.ref)).toEqual(["ev-0103", "ev-0127", "ev-0113", "ev-0116", "ev-0119", "ev-0122", "ev-0125"]);
    expect(s.sources[0].label).toMatch(/Total income/);
    expect(s.sources[0].location).toEqual({ documentId: "D14", page: 1 });
    expect(s.sources[1].display).toBe("12,400.00");
    expect(s.problems).toEqual([]);
    expect(s.edges.filter((e) => e.origin === "engine")).toHaveLength(7);
  });

  it("sourcesOf reports missing lines and refs instead of throwing", async () => {
    const missing = await sourcesOf(priya.ctx, "F9999.1");
    expect(missing.found).toBe(false);
    expect(missing.problems[0].state).toBe("missing");
    const s = await sourcesOf(priya.ctx, "SchC.9");
    expect(s.inputs.map((i) => i.key)).toEqual(["SchC.44a"]);
    expect(s.sources[0]).toMatchObject({ ref: "ref:param.mileage_rate", found: true, display: "0.7" });
  });

  it("usesOf(doc:D23#page3) reaches SchC.44a directly and SchC.9 transitively", async () => {
    const uses = await usesOf(priya.ctx, "doc:D23#page3");
    expect(uses.expanded).toContain("ev-0404");
    expect(uses.direct.map((d) => d.key)).toEqual(["SchC.44a"]);
    expect(uses.direct[0].via).toEqual(["ev-0404"]);
    const transitive = uses.transitive.map((t) => t.key);
    expect(transitive).toContain("SchC.9");
    expect(transitive).toContain("SchC.31");
    expect(uses.transitive.find((t) => t.key === "SchC.9")!.relation).toBe("transitive");
    const view = await loadDocumentPage(priya.ctx, "D23", 3);
    expect(view!.landed.direct.map((l) => l.key)).toEqual(["SchC.44a"]);
    expect(view!.landed.transitive.map((l) => l.key)).toContain("SchC.9");
    // Repeated trip mileage is ambiguous on the page and never gets a guessed box.
    const ambiguous = view!.values.filter((v) => v.anchorState === "ambiguous");
    expect(ambiguous.length).toBeGreaterThan(0);
    for (const v of ambiguous) expect(view!.segments.some((s) => s.values.includes(v.id))).toBe(false);
  });

  it("an extracted value id resolves to its document page", () => {
    expect(locateExtractedValue(priya.ctx, "ev-1045")).toEqual({ documentId: "D62", page: 1, label: "Provider tax ID" });
    expect(locateExtractedValue(priya.ctx, "ev-9999")).toBeNull();
  });

  it("redaction holds for every rendered page of D06, D08 and D36", async () => {
    for (const id of ["D06", "D08", "D36"]) {
      const doc = packet().documents.find((d) => d.id === id)!;
      for (const p of doc.pages) {
        const view = await loadDocumentPage(priya.ctx, id, p.page);
        expect(view!.available).toBe(true);
        expect(looksSensitive(view!.printed!, packet())).toBe(false);
        expect(view!.segments.map((s) => s.text).join("")).toBe(view!.printed);
        for (const v of view!.values) {
          expect(looksSensitive(v.textAsRead, packet())).toBe(false);
          expect(looksSensitive(v.display, packet())).toBe(false);
        }
        expect(sensitive(view)).toBe(false);
      }
    }
    // Masked values still anchor: the W-2 SSN is highlighted as its masked form.
    const w2 = await loadDocumentPage(priya.ctx, "D08", 1);
    const ssn = w2!.values.find((v) => v.id === "ev-0015")!;
    expect(ssn.textAsRead).toBe("***-**-2287");
    expect(ssn.anchorState).toBe("found");
  });

  it("the index, client items, records and traces never leak sensitive values", async () => {
    expect(sensitive(await loadDocumentIndex(priya.ctx))).toBe(false);
    expect(sensitive(await loadClientItems(priya.ctx))).toBe(false);
    const records = await loadRecords(priya.ctx, ["py:/return_2024/lines/F1040.24", "agency:/irs_account_transcript_2025/1", "py:/nowhere"]);
    expect(sensitive(records)).toBe(false);
    expect(records.household.people[0].ssn).toMatch(/^\*\*\*-\*\*-\d{4}$/);
    expect(records.household.bank.account).toMatch(/^\*\*\*\*\d{4}$/);
    expect(records.priorReturn.dependents.every((d) => d.ssn.startsWith("***-**-"))).toBe(true);
    expect(sensitive(await usesOf(priya.ctx, "household:theo"))).toBe(false);
    expect(sensitive(await sourcesOf(priya.ctx, "F1040.1a"))).toBe(false);
    expect(records.pointers.map((p) => p.found)).toEqual([true, true, false]);
  });

  it("records honour the replay clock and keep unknown basis unknown", async () => {
    const r = await loadRecords(priya.ctx);
    expect(r.agency.irs.map((s) => [s.asOf, s.available, s.transactions === null])).toEqual([
      ["2026-03-12", true, false],
      ["2026-08-03", false, true],
    ]);
    expect(r.agency.notices.map((n) => n.available)).toEqual([true, false]);
    expect(r.agency.notices[1].summary).toBeNull();
    expect(r.agency.notices[1].items).toEqual([]);
    expect(r.agency.efile.every((e) => !e.available && e.submissionId === null)).toBe(true);
    const scorp = r.basis.find((b) => b.key === "scorp_lindqvist_family_woodworks")!;
    const year2023 = scorp.rows[1].fields.find((f) => f.key === "ending_stock_basis")!;
    expect(year2023.display).toBe("unknown");
    expect(year2023.unknown).toBe(true);
    expect(r.priorReturn.lines.find((l) => l.key === "F1040.1a")).toMatchObject({ sourceRef: "ev-2909", sourceFound: true, ref: "py:/return_2024/lines/F1040.1a" });
    expect(r.carryovers.federal.find((c) => c.key === "capital_loss_short")?.display).toBe("3200");
  });
});
