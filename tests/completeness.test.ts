import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db/client";
import type { LoadedPacket } from "@/packet/load";
import { looksSensitive } from "@/domain/redaction";
import { completenessView, statesNothingFurther, type CompletenessView } from "@/server/queries/completeness";
import { isRefusal } from "@/server/queries/people";
import { importedDb } from "./helpers/db";
import { newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * Completeness: every document has a status at the replay clock, a batch
 * disposition is one unit that can be undone unless a colleague has since
 * worked on the same item, and areas carry an explicit applicability mark.
 */
describe("completeness", () => {
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
  const view = async (p: Persona, filters?: { status?: string; area?: string }): Promise<CompletenessView> => {
    const v = await completenessView(p.ctx, filters);
    if (isRefusal(v)) throw new Error(v.message);
    return v;
  };
  const sensitive = (value: unknown) => looksSensitive(JSON.stringify(value), loaded.packet);

  it("counts every document at the default clock: used, superseded, unaccounted, not yet available", async () => {
    expect(isRefusal(await completenessView(ngozi.ctx))).toBe(true);
    const v = await view(priya);
    expect(v.version).toBe("v3");
    expect(v.asOf.slice(0, 10)).toBe("2026-06-23");
    expect(v.total).toBe(74);
    expect(v.counts).toEqual({ used: 71, superseded: 1, dispositioned: 0, unaccounted: 0, not_yet_available: 2 });
    expect(v.documents.find((d) => d.id === "D30")).toMatchObject({ status: "superseded", supersededBy: "D31", available: true });
    expect(v.documents.find((d) => d.id === "D71")).toMatchObject({ status: "not_yet_available", available: false });
    expect(v.documents.find((d) => d.id === "D31")).toMatchObject({ status: "used", usedByEngine: true, pagesWithoutValues: [32], statedEmptyPages: 21 });
    expect(statesNothingFurther("Page 12: 1099-B detail - no further transactions; 1099-MISC and 1099-OID sections: none.")).toBe(true);
    // Page-level completeness: only the supplemental page is listed for each partial document.
    expect(v.pages.map((p) => p.ref).sort()).toEqual(["doc:D30#page32", "doc:D31#page32"]);
    expect(v.pages.find((p) => p.ref === "doc:D31#page32")?.href).toBe("/evidence/D31?page=32");
    expect(v.applicability).toHaveLength(10);
    expect(v.applicability.every((a) => a.applies === null)).toBe(true);
    expect(v.batches).toEqual([]);
    expect(v.outsideFilings).toEqual([]);
    const byStatus = await view(priya, { status: "superseded" });
    expect(byStatus.documents.map((d) => d.id)).toEqual(["D30"]);
    const byArea = await view(priya, { area: "rentals_and_sale" });
    expect(byArea.documents.every((d) => d.area === "rentals_and_sale")).toBe(true);
    expect(byArea.documents.length).toBeGreaterThan(3);
    expect(sensitive(v)).toBe(false);
  });

  it("a document arriving when the clock moves is unaccounted until dispositioned; a batch is undone as one unit", async () => {
    ok(await priya.run("advance_time", { to: "2026-07-13T20:00:00Z" }));
    let v = await view(priya);
    expect(v.counts).toMatchObject({ unaccounted: 1, not_yet_available: 1 });
    expect(v.documents.find((d) => d.id === "D71")).toMatchObject({ status: "unaccounted", available: true });

    const batch = ok(await priya.run("batch_disposition", { subjectRefs: ["D71", "doc:D31#page32"], disposition: "manual_review", note: "Look at these by hand." }));
    const batchId = (batch.result as { batchId: string }).batchId;
    v = await view(priya);
    expect(v.counts).toMatchObject({ unaccounted: 0, dispositioned: 1 });
    const d71 = v.documents.find((d) => d.id === "D71")!;
    expect(d71.status).toBe("dispositioned");
    expect(d71.disposition).toMatchObject({ disposition: "manual_review", label: "Needs manual review", note: "Look at these by hand.", batchId });
    expect(d71.disposition?.actor.name).toBe("Priya Raman");
    expect(v.pages.find((p) => p.ref === "doc:D31#page32")?.disposition?.batchId).toBe(batchId);
    expect(v.batches).toHaveLength(1);
    expect(v.batches[0]).toMatchObject({ batchId, mine: true, canUndo: true, subjects: ["D71", "doc:D31#page32"] });
    // The reviewer did not make the batch but holds the undo permission; the client sees nothing.
    const asDaniel = await view(daniel);
    expect(asDaniel.batches[0]).toMatchObject({ mine: false, canUndo: true });

    ok(await priya.run("undo_batch", { batchId }));
    v = await view(priya);
    expect(v.counts).toMatchObject({ unaccounted: 1, dispositioned: 0 });
    expect(v.documents.find((d) => d.id === "D71")?.disposition).toBeNull();
    expect(v.batches).toEqual([]);
    expect(v.pages.find((p) => p.ref === "doc:D31#page32")?.disposition).toBeNull();
  });

  it("undo refuses when a colleague has since worked on the same item", async () => {
    const batch = ok(await priya.run("batch_disposition", { subjectRefs: ["D71"], disposition: "used", note: "Supports the identifier correction." }));
    const batchId = (batch.result as { batchId: string }).batchId;
    ok(await daniel.run("record_disposition", { subjectRef: "D71", disposition: "reviewed_no_use", note: "Reviewer disagrees; keep as reviewed." }));
    const refused = await priya.run("undo_batch", { batchId });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("invalid_state");
      expect(refused.error.message).toMatch(/colleague has since worked on D71/);
    }
    const v = await view(priya);
    // The latest disposition in force is the reviewer's; the batch is still listed because it was not withdrawn.
    expect(v.documents.find((d) => d.id === "D71")?.disposition).toMatchObject({ disposition: "reviewed_no_use", batchId: null });
    expect(v.documents.find((d) => d.id === "D71")?.disposition?.actor.name).toBe("Daniel Ortiz");
    expect(v.batches.map((b) => b.batchId)).toEqual([batchId]);
  });

  it("area applicability is recorded on area:<id> and shown with its note and actor", async () => {
    ok(await priya.run("record_disposition", { subjectRef: "area:partner_review", disposition: "not_applicable", note: "No material judgment yet; partner review opens after reviewer sign-off." }));
    let v = await view(priya);
    const partner = v.applicability.find((a) => a.id === "partner_review")!;
    expect(partner).toMatchObject({ ref: "area:partner_review", applies: false });
    expect(partner.disposition).toMatchObject({ disposition: "not_applicable", note: "No material judgment yet; partner review opens after reviewer sign-off." });
    expect(partner.disposition?.actor.name).toBe("Priya Raman");
    expect(v.applicability.filter((a) => a.applies === null)).toHaveLength(9);

    ok(await daniel.run("record_disposition", { subjectRef: "area:partner_review", disposition: "used", note: "Applies: the HVAC judgment is material." }));
    v = await view(priya);
    const updated = v.applicability.find((a) => a.id === "partner_review")!;
    expect(updated.applies).toBe(true);
    expect(updated.disposition?.actor.name).toBe("Daniel Ortiz");
    const bad = await priya.run("record_disposition", { subjectRef: "area:nowhere", disposition: "used" });
    expect(bad.ok).toBe(false);
  });

  it("outside filings are listed from tasks and nothing sensitive leaves the view", async () => {
    ok(await daniel.run("create_task", {
      kind: "outside_filing",
      title: "FinCEN 114 (FBAR) for the Sparbanken account",
      detail: "Outside the engagement; confirm the client files by the automatic extended due date.",
      ownerId: "st-01",
      dueAt: "2026-10-15T23:59:59Z",
      refs: ["F8938.1.max", "D36"],
    }));
    const v = await view(priya);
    expect(v.outsideFilings).toHaveLength(1);
    expect(v.outsideFilings[0]).toMatchObject({ kind: "outside_filing", status: "open", overdue: false });
    expect(v.outsideFilings[0].refs.map((r) => r.ref)).toEqual(["F8938.1.max", "D36"]);
    expect(v.actor).toMatchObject({ canDisposition: true, canUndoOthers: false, canCreateTask: true });
    expect((await view(daniel)).actor.canUndoOthers).toBe(true);
    expect(sensitive(v)).toBe(false);
    expect(sensitive(await view(daniel, { status: "used" }))).toBe(false);
  });
});
