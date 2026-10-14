import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { openDb, type DbHandle } from "@/db/client";
import * as t from "@/db/schema";
import { loadPacket, type LoadedPacket } from "@/packet/load";
import { importPacket } from "@/packet/import";
import { loadSessionContext, type SessionContext } from "@/server/context";
import { createSession, createWorkspace } from "@/server/workspace";
import { dispatch } from "@/server/handlers";

config({ path: [".env.local", ".env"] });
const url = process.env.TEST_DATABASE_URL?.trim();

/**
 * Real multi-connection PostgreSQL only (PGlite is single-connection, so it
 * cannot exercise the row lock). Two people commit against the same revision
 * at the same moment: exactly one wins, the other gets a conflict that names
 * the winner's change, and nothing is overwritten.
 */
describe.skipIf(!url)("concurrent commands on real PostgreSQL", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let priya: SessionContext;
  let daniel: SessionContext;
  let wsId: string;

  beforeAll(async () => {
    handle = await openDb({ databaseUrl: url });
    await handle.db.execute(sql`drop schema if exists public cascade`);
    await handle.db.execute(sql`create schema public`);
    await handle.db.execute(sql`drop schema if exists drizzle cascade`);
    await handle.migrate();
    loaded = loadPacket();
    await importPacket(handle.db, loaded);
    const ws = await createWorkspace(handle.db, loaded, "race");
    wsId = ws.id;
    const s1 = await createSession(handle.db, loaded, wsId, "st-01");
    const s2 = await createSession(handle.db, loaded, wsId, "st-02");
    priya = (await loadSessionContext(handle.db, loaded, s1.id))!;
    daniel = (await loadSessionContext(handle.db, loaded, s2.id))!;
  });
  afterAll(async () => {
    await handle?.close();
  });

  it("exactly one of two simultaneous commits on revision 0 wins", async () => {
    const [a, b] = await Promise.all([
      dispatch(priya, {
        type: "propose_adjustment",
        payload: {
          targetRef: "SchC.1",
          kind: "value",
          proposedValue: 151300,
          reason: "Books already include the Paywell receipts",
          evidenceRefs: ["doc:D14#page1", "doc:D15#page3"],
          category: "schc_profit",
        },
        expectedRevision: 0,
        idempotencyKey: "race-priya-1",
      }),
      dispatch(daniel, {
        type: "raise_finding",
        payload: { title: "Check Paywell receipts", detail: "Possible double count of 1099-K amounts.", severity: "warning", refs: ["SchC.1"] },
        expectedRevision: 0,
        idempotencyKey: "race-daniel-1",
      }),
    ]);
    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const loser = losers[0];
    if (!loser.ok) {
      expect(loser.error.code).toBe("conflict");
      expect(loser.error.currentRevision).toBe(1);
      expect(loser.error.changesSince?.length).toBe(1);
    }
    const [ws] = await handle.db.select().from(t.workspaces).where(eq(t.workspaces.id, wsId));
    expect(ws.revision).toBe(1);
    const events = await handle.db.select().from(t.auditEvents).where(eq(t.auditEvents.workspaceId, wsId));
    expect(events.filter((e) => e.revision === 1)).toHaveLength(1);
  });

  it("the loser retries on the new revision and succeeds; replaying the winner's key adds nothing", async () => {
    const retry = await dispatch(daniel, {
      type: "raise_finding",
      payload: { title: "Check Paywell receipts", detail: "Possible double count of 1099-K amounts.", severity: "warning", refs: ["SchC.1"] },
      expectedRevision: 1,
      idempotencyKey: "race-daniel-2",
    });
    expect(retry.ok).toBe(true);
    const replay = await dispatch(priya, {
      type: "propose_adjustment",
      payload: { targetRef: "SchC.1", kind: "value", proposedValue: 151300, reason: "dup", evidenceRefs: ["doc:D14#page1"], category: "schc_profit" },
      expectedRevision: 5,
      idempotencyKey: "race-priya-1",
    });
    const [ws] = await handle.db.select().from(t.workspaces).where(eq(t.workspaces.id, wsId));
    if (replay.ok) {
      expect(replay.replayed).toBe(true);
    } else {
      // The winner was Daniel's command in this run; Priya's key was never applied, so this is a plain conflict.
      expect(replay.error.code).toBe("conflict");
    }
    expect(ws.revision).toBe(2);
    const adjustments = await handle.db.select().from(t.adjustments).where(eq(t.adjustments.workspaceId, wsId));
    expect(adjustments.length).toBeLessThanOrEqual(1);
  });

  it("a burst of ten commands on one revision applies exactly one", async () => {
    const [ws] = await handle.db.select().from(t.workspaces).where(eq(t.workspaces.id, wsId));
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        dispatch(daniel, {
          type: "raise_finding",
          payload: { title: `Burst ${i}`, detail: "Concurrency burst", severity: "info", refs: [] },
          expectedRevision: ws.revision,
          idempotencyKey: `burst-${i}`,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error.code === "conflict")).toHaveLength(9);
    const [after] = await handle.db.select().from(t.workspaces).where(eq(t.workspaces.id, wsId));
    expect(after.revision).toBe(ws.revision + 1);
  });
});
