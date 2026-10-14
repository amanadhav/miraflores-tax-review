import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import * as t from "@/db/schema";
import { looksSensitive } from "@/domain/redaction";
import type { LoadedPacket } from "@/packet/load";
import { search } from "@/server/queries/search";
import { importedDb } from "./helpers/db";
import { newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * Search finds evidence by what is printed on it, never by a sensitive value,
 * and only what the viewer may see as of the replay clock.
 */
describe("workpaper search", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let wsId: string;
  let priya: Persona;
  let marcus: Persona;
  let client: Persona;

  beforeAll(async () => {
    const db = await importedDb();
    handle = db.handle;
    loaded = db.loaded;
    const ws = await newWorkspace(handle, loaded);
    wsId = ws.id;
    priya = await persona(handle, loaded, wsId, "st-01");
    marcus = await persona(handle, loaded, wsId, "st-04");
    client = await persona(handle, loaded, wsId, "cu-01");
  });
  afterAll(async () => {
    await handle.close();
  });

  it("finds the Paywell 1099-K, the books page that mentions it, and the receipts line it feeds", async () => {
    const r = await search(priya.ctx, "Paywell");
    expect(r.internal).toBe(true);
    expect(r.refused).toBe(false);
    const docs = r.hits.filter((h) => h.type === "document");
    expect(docs.map((h) => h.ref)).toEqual(["D21"]);

    const pages = r.hits.filter((h) => h.type === "page");
    const books = pages.find((h) => h.type === "page" && h.documentId === "D15" && h.page === 3);
    expect(books).toBeDefined();
    expect(books!.ref).toBe("doc:D15#page3");
    expect(books!.snippet).toMatch(/arrived through Paywell/);
    expect(books!.snippet.length).toBeLessThan(400);

    const lines = r.hits.filter((h) => h.type === "line");
    const receipts = lines.find((h) => h.type === "line" && h.key === "SchC.1");
    expect(receipts).toBeDefined();
    if (receipts && receipts.type === "line") {
      expect(receipts.via).toMatch(/D21/);
      expect(receipts.value).toBe("163,700");
    }
  });

  it("matches are case-insensitive, multi-word, and limited to 20 per type", async () => {
    const r = await search(priya.ctx, "form w-2");
    expect(r.hits.some((h) => h.type === "document" && /W-2/.test(h.title))).toBe(true);
    const wide = await search(priya.ctx, "2025");
    for (const type of ["document", "page", "value", "line"] as const) {
      expect(wide.hits.filter((h) => h.type === type).length).toBeLessThanOrEqual(20);
    }
    expect(Object.keys(wide.more).length).toBeGreaterThan(0);
  });

  it("every snippet is redacted, even on pages that print an SSN", async () => {
    const r = await search(marcus.ctx, "Box a employee");
    const values = r.hits.filter((h) => h.type === "value");
    expect(values.length).toBeGreaterThan(0);
    for (const h of r.hits) {
      expect(looksSensitive(JSON.stringify(h), loaded.packet), h.ref).toBe(false);
    }
    const w2 = await search(marcus.ctx, "Employee Ngozi Okafor, SSN");
    const w2Pages = w2.hits.filter((h) => h.type === "page");
    expect(w2Pages.length).toBeGreaterThan(0);
    expect(JSON.stringify(w2)).toContain("***-**-");
    expect(looksSensitive(JSON.stringify(w2), loaded.packet)).toBe(false);
  });

  it("searching a full SSN finds nothing and is logged as a denied attempt without the query", async () => {
    const ssn = loaded.packet.household.people.find((p) => p.id === "ngozi")!.ssn;
    const r = await search(priya.ctx, ssn);
    expect(r.hits).toHaveLength(0);
    expect(r.refused).toBe(true);
    expect(r.query).toBe("");
    expect(r.message).toMatch(/refused and logged/);

    const views = await handle.db
      .select()
      .from(t.viewEvents)
      .where(and(eq(t.viewEvents.workspaceId, wsId), eq(t.viewEvents.actorId, "st-01")));
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ ref: "search", field: "query", outcome: "denied" });
    expect(views[0].reason).toMatch(/ssn/i);
    expect(views[0].reason).not.toContain(ssn);
    const audits = await handle.db
      .select()
      .from(t.auditEvents)
      .where(and(eq(t.auditEvents.workspaceId, wsId), eq(t.auditEvents.action, "sensitive_reveal_denied")));
    expect(audits).toHaveLength(1);
    expect(looksSensitive(JSON.stringify(audits), loaded.packet)).toBe(false);

    // The digits without dashes, a partial probe, and the IBAN are refused or empty too.
    const digits = await search(priya.ctx, ssn.replace(/-/g, ""));
    expect(digits.refused).toBe(true);
    const probe = await search(priya.ctx, ssn.slice(0, 6));
    expect(probe.refused).toBe(false);
    expect(probe.hits).toHaveLength(0);
    const iban = loaded.packet.extracted_values.find((ev) => ev.id === "ev-0963")!.text_as_read;
    const ibanSearch = await search(priya.ctx, iban);
    expect(ibanSearch.refused).toBe(true);
    expect(ibanSearch.hits).toHaveLength(0);
  });

  it("a client user gets no internal results at all, and the page says so", async () => {
    const r = await search(client.ctx, "Paywell");
    expect(r.internal).toBe(false);
    expect(r.hits).toHaveLength(0);
    expect(r.message).toMatch(/not available to client users/);
  });

  it("evidence received after the replay clock is hidden until the clock moves past it", async () => {
    const before = await search(priya.ctx, "IMG_6012");
    expect(before.hits).toHaveLength(0);
    const beforeCard = await search(priya.ctx, "Social Security card");
    expect(beforeCard.hits.some((h) => h.ref === "D71" || h.ref === "doc:D71#page1" || h.ref === "ev-1080")).toBe(false);

    const moved = await priya.run("advance_time", { to: "2026-07-14T00:00:00Z" });
    expect(moved.ok).toBe(true);

    const after = await search(priya.ctx, "IMG_6012");
    expect(after.hits.map((h) => h.ref)).toEqual(["D71"]);
    const card = await search(priya.ctx, "Social Security card");
    const page = card.hits.find((h) => h.ref === "doc:D71#page1");
    expect(page).toBeDefined();
    expect(page!.snippet).toMatch(/\*\*\*-\*\*-\d{4}/);
    expect(looksSensitive(JSON.stringify(card), loaded.packet)).toBe(false);

    // The July client message is visible now as well.
    const crypto = await search(priya.ctx, "CryptoNorth");
    expect(crypto.hits.some((h) => h.type === "client" && h.ref === "msg-07")).toBe(true);
  });

  it("finds workspace findings and changes by their text", async () => {
    const r = await search(priya.ctx, "cost basis");
    expect(r.hits.some((h) => h.type === "finding")).toBe(true);
    const proposed = await priya.run("propose_adjustment", {
      targetRef: "SchC.1",
      kind: "value",
      proposedValue: 151300,
      reason: "Books already include the Paywell receipts; the engine counted the 1099-K again.",
      evidenceRefs: ["doc:D15#page3", "doc:D21#page1"],
      category: "schc_profit",
    });
    expect(proposed.ok).toBe(true);
    const changes = await search(priya.ctx, "counted the 1099-K again");
    const hit = changes.hits.find((h) => h.type === "adjustment");
    expect(hit).toBeDefined();
    if (hit && hit.type === "adjustment") expect(hit.target).toBe("SchC.1");
  });
});
