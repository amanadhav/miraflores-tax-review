import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import * as t from "@/db/schema";
import { importPacket, countPacket } from "@/packet/import";
import { fixturePacket, testDb } from "./helpers/db";

const EXPECTED_SHA = "ee01f8508bd2fd9854754b82fd9c4a055bdc55e2778a132002a25381c412ad19";

describe("packet import", () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await testDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("loads the packet byte-identically", () => {
    const loaded = fixturePacket();
    expect(loaded.sha256).toBe(EXPECTED_SHA);
    expect(loaded.packet.packet.client_id).toBe("CL-20417");
  });

  it("imports once and keeps every record; a second import is a no-op", async () => {
    const loaded = fixturePacket();
    const first = await importPacket(handle.db, loaded);
    expect(first.imported).toBe(true);
    expect(first.counts.documents).toBe(74);
    expect(first.counts.pages).toBe(199);
    expect(first.counts.extractedValues).toBe(3012);
    expect(first.counts.lines).toEqual({ v1: 625, v2: 625, v3: 627 });
    expect(first.counts.edges).toBeGreaterThan(1000);

    const second = await importPacket(handle.db, loaded);
    expect(second.imported).toBe(false);
    expect(second.counts).toEqual(first.counts);
    expect(await countPacket(handle.db, loaded.sha256)).toEqual(first.counts);
  });

  it("keeps printed source text separate from extracted values", async () => {
    const loaded = fixturePacket();
    const [page] = await handle.db
      .select()
      .from(t.documentPages)
      .where(and(eq(t.documentPages.packetId, loaded.sha256), eq(t.documentPages.documentId, "D62"), eq(t.documentPages.page, 1)));
    expect(page.printedContent).toContain("Tax ID 74-3829156");
    const [ev] = await handle.db
      .select()
      .from(t.extractedValues)
      .where(and(eq(t.extractedValues.packetId, loaded.sha256), eq(t.extractedValues.id, "ev-1045")));
    expect(ev.value).toBe("74-3829516");
    expect(ev.confidence).toBeCloseTo(0.97);
  });

  it("records supersession and reverse edges", async () => {
    const loaded = fixturePacket();
    const edges = await handle.db
      .select()
      .from(t.referenceEdges)
      .where(and(eq(t.referenceEdges.packetId, loaded.sha256), eq(t.referenceEdges.relation, "supersedes")));
    expect(edges.map((e) => `${e.version}:${e.fromRef}>${e.toRef}`).sort()).toEqual(["v2:D31>D30", "v3:D31>D30"]);
    const uses = await handle.db
      .select()
      .from(t.referenceEdges)
      .where(and(eq(t.referenceEdges.packetId, loaded.sha256), eq(t.referenceEdges.fromRef, "ev-1045")));
    expect(uses.map((u) => `${u.version}:${u.toRef}`).sort()).toEqual(["v1:F2441.1b", "v2:F2441.1b", "v3:F2441.1b"]);
  });
});
