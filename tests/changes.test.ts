import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import * as t from "@/db/schema";
import type { LoadedPacket } from "@/packet/load";
import { auditPage, ledger, sinceLastLooked, timelineView, versionCompare, whatIfView } from "@/server/queries/changes";
import { importedDb } from "./helpers/db";
import { newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * The Changes section: what changed since a person last looked (per-user
 * revision cursor), the ledger with net estimated effects, version comparison,
 * supplied what-if branches, the baseline switch and the replay timeline.
 */
describe("changes: since last looked, ledger, versions, what-ifs, timeline", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let wsId: string;
  let priya: Persona;
  let daniel: Persona;
  let helen: Persona;
  let firstId: string;
  let secondId: string;

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

  async function markSeen(actorId: string, revision: number) {
    // Same upsert the /api/session/seen route performs.
    await handle.db
      .insert(t.seenCursors)
      .values({ workspaceId: wsId, actorId, revision })
      .onConflictDoUpdate({ target: [t.seenCursors.workspaceId, t.seenCursors.actorId], set: { revision, updatedAt: sql`now()` } });
  }

  it("after two commands by Priya, Daniel's since-last-looked lists 2 revisions, then 0 once marked seen", async () => {
    await markSeen("st-02", 0);
    const propose = await priya.run("propose_adjustment", {
      targetRef: "SchC.1",
      kind: "value",
      proposedValue: 151300,
      reason: "Books total income already includes the Paywell receipts; the engine added the 1099-K again.",
      evidenceRefs: ["doc:D15#page3", "ev-0103"],
      category: "schc_profit",
    });
    expect(propose.ok).toBe(true);
    if (!propose.ok) return;
    firstId = (propose.result as { adjustmentId: string }).adjustmentId;
    const finding = await priya.run("raise_finding", { title: "Check Paywell receipts", detail: "The 1099-K total may be double counted.", severity: "info", refs: ["SchC.1"] });
    expect(finding.ok).toBe(true);

    await daniel.refresh();
    const view = await sinceLastLooked(daniel.ctx);
    expect(view.cursor).toBe(0);
    expect(view.currentRevision).toBe(2);
    expect(view.groups.map((g) => g.revision)).toEqual([1, 2]);
    expect(view.eventCount).toBe(2);
    expect(view.groups[0].events[0].actorName).toBe("Priya Raman");
    expect(view.groups[0].events[0].actionLabel).toBe("proposed a change");
    expect(view.groups[0].events[0].entityRef).toBe(`adjustment:${firstId}`);
    expect(view.groups[0].events[0].areaLabel).toBe("Business (Schedule C)");
    expect(view.groups[0].events[0].after).toMatchObject({ targetRef: "SchC.1", kind: "value" });

    // No cursor at all means everything, including the revision 0 creation event.
    const all = await sinceLastLooked(priya.ctx);
    expect(all.cursor).toBeNull();
    expect(all.groups.map((g) => g.revision)).toEqual([0, 1, 2]);

    await markSeen("st-02", daniel.ctx.workspace.revision);
    const after = await sinceLastLooked(daniel.ctx);
    expect(after.cursor).toBe(2);
    expect(after.groups).toHaveLength(0);
    expect(after.eventCount).toBe(0);
  });

  it("the ledger excludes superseded rows from the net effect", async () => {
    const accept1 = await helen.run("decide_adjustment", { adjustmentId: firstId, decision: "accept", note: "Agreed to the books." });
    expect(accept1.ok).toBe(true);
    const propose2 = await priya.run("propose_adjustment", {
      targetRef: "SchC.1",
      kind: "value",
      proposedValue: 151000,
      reason: "Refund of 300 to a customer was also netted in the books.",
      evidenceRefs: ["doc:D15#page3"],
      category: "schc_profit",
    });
    expect(propose2.ok).toBe(true);
    if (!propose2.ok) return;
    secondId = (propose2.result as { adjustmentId: string }).adjustmentId;
    const accept2 = await helen.run("decide_adjustment", { adjustmentId: secondId, decision: "accept" });
    expect(accept2.ok).toBe(true);

    const book = await ledger(helen.ctx);
    expect(book.rows).toHaveLength(2);
    expect(book.counts).toEqual({ superseded: 1, accepted: 1 });
    const first = book.rows.find((r) => r.id === firstId)!;
    const second = book.rows.find((r) => r.id === secondId)!;
    expect(first.status).toBe("superseded");
    expect(first.supersededById).toBe(secondId);
    expect(second.supersedesId).toBe(firstId);
    expect(second.priorValue).toBe(151300);
    expect(second.proposedValue).toBe(151000);
    expect(second.authorName).toBe("Priya Raman");
    expect(second.deciderName).toBe("Helen Strand");
    expect(first.decisionNote).toBe("Agreed to the books.");
    expect(second.needsRebase).toBe(false);
    expect(second.targetLabel).toMatch(/^SchC line 1/);
    expect(second.evidence[0]).toMatchObject({ ref: "doc:D15#page3", found: true });

    // Net effect counts only the row that is still accepted (-300 x v3 rates), not the superseded -12,400.
    expect(book.net.accepted).toBe(1);
    expect(book.net.federal).toBeCloseTo(second.effectFederal!, 2);
    expect(book.net.california).toBeCloseTo(second.effectCalifornia!, 2);
    expect(book.net.federal).toBeCloseTo(-300 * 0.355, 2);
    expect(Math.abs(book.net.federal)).toBeLessThan(Math.abs(first.effectFederal!));
    expect(book.net.limitations.length).toBeGreaterThan(0);
  });

  it('versionCompare("v2", "v3") finds SchB.1.8 added and the resolved K-1 and S corporation diagnostics', async () => {
    const cmp = await versionCompare(priya.ctx, "v2", "v3");
    expect(cmp.versions.map((v) => v.version)).toEqual(["v1", "v2", "v3"]);
    expect(cmp.versions[2].isActive).toBe(true);
    expect(cmp.versions[2].documentsUsed).toBe(71);
    expect(cmp.versions[2].federal.total_tax).toBe(81962);
    expect(cmp.diff.from).toBe("v2");
    expect(cmp.diff.to).toBe("v3");
    const added = cmp.diff.rows.find((r) => r.key === "SchB.1.8");
    expect(added?.change).toBe("added");
    expect(added?.new).toBe(120);
    expect(cmp.diff.added).toBe(2);
    expect(cmp.diff.removed).toBe(0);
    expect(cmp.diff.changed).toBeGreaterThan(50);
    expect(cmp.diff.total).toBe(cmp.diff.added + cmp.diff.removed + cmp.diff.changed);
    expect(cmp.diff.pageCount).toBe(2);
    expect(cmp.selected.version).toBe("v3");
    expect(cmp.selected.previousVersion).toBe("v2");
    expect(cmp.selected.changesFromPrevious.some((c) => c.key === "SchB.1.8" && c.change === "added")).toBe(true);
    expect(cmp.selected.resolvedDiagnostics.map((d) => d.code).sort()).toEqual(["K1_EXPECTED_NOT_RECEIVED", "SCORP_BASIS_INCOMPLETE"]);
    expect(cmp.selected.newDiagnostics).toHaveLength(0);

    const page2 = await versionCompare(priya.ctx, "v2", "v3", { page: 2 });
    expect(page2.diff.page).toBe(2);
    expect(page2.diff.rows.length).toBe(cmp.diff.total - 50);

    const first = await versionCompare(priya.ctx, "v1", "v1", { selected: "v1" });
    expect(first.selected.previousVersion).toBeNull();
    expect(first.diff.total).toBe(0);
    await expect(versionCompare(priya.ctx, "v9", "v3")).rejects.toThrow(/not a return version/);
  });

  it('whatIfView("equipment_section179") reports federal 0 and California -1050 and refuses a combined result once a change is accepted', async () => {
    const w = await whatIfView(priya.ctx, "equipment_section179");
    expect(w.alternatives).toHaveLength(5);
    expect(w.selected?.federalTaxChange).toBe(0);
    expect(w.selected?.federalPenaltyChange).toBe(0);
    expect(w.selected?.californiaTaxChange).toBe(-1050);
    expect(w.selected?.baseVersion).toBe("v3");
    expect(w.selected?.suppliedLabel).toBe("exact as supplied for pristine v3");
    expect(w.selected?.exclusiveWith).toEqual(["equipment_no_bonus"]);
    expect(w.selected?.changedLines.total).toBe(22);
    expect(w.selected?.changedLines.rows[0]).toMatchObject({ key: "F4562-C.12", change: "changed", old: 0, new: 38000 });
    expect(w.acceptedCount).toBe(1);
    expect(w.combined.available).toBe(false);
    expect(w.combined.reason).toBe("A combined result is not available: the supplied result applies to pristine v3 only; the workpaper has 1 accepted change.");
    expect(w.extension.basedOnVersion).toBe("v2");
    expect(w.extension.federal.paid_with_form_4868).toBe(36000);

    const none = await whatIfView(priya.ctx, null);
    expect(none.selected).toBeNull();
    expect(none.combined.available).toBe(false);

    // A pristine workspace on v3 can take the supplied figures as they stand.
    const fresh = await newWorkspace(handle, loaded);
    const freshPriya = await persona(handle, loaded, fresh.id, "st-01");
    const pristine = await whatIfView(freshPriya.ctx, "equipment_no_bonus");
    expect(pristine.acceptedCount).toBe(0);
    expect(pristine.combined.available).toBe(true);
    expect(pristine.selected?.federalTaxChange).toBe(10245);
  });

  it('set_version to "v2" flags a v3 adjustment as needing rebase without touching it or the clock', async () => {
    const asOfBefore = new Date(priya.ctx.workspace.asOf).toISOString();
    const same = await priya.run("set_version", { version: "v3" });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.error.code).toBe("invalid_state");
    const unknown = await priya.run("set_version", { version: "v9" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("not_found");

    const r = await priya.run("set_version", { version: "v2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result).toMatchObject({ activeVersion: "v2", previousVersion: "v3" });
    expect(priya.ctx.workspace.activeVersion).toBe("v2");
    expect(new Date(priya.ctx.workspace.asOf).toISOString()).toBe(asOfBefore);

    const book = await ledger(priya.ctx);
    expect(book.activeVersion).toBe("v2");
    const second = book.rows.find((row) => row.id === secondId)!;
    expect(second.baselineVersion).toBe("v3");
    expect(second.status).toBe("accepted");
    expect(second.needsRebase).toBe(true);
    expect(book.needsRebaseCount).toBe(1);

    const [row] = await handle.db.select().from(t.adjustments).where(and(eq(t.adjustments.id, secondId), eq(t.adjustments.workspaceId, wsId)));
    expect(row.status).toBe("accepted");
    expect(row.baselineVersion).toBe("v3");

    const events = await handle.db.select().from(t.auditEvents).where(and(eq(t.auditEvents.workspaceId, wsId), eq(t.auditEvents.action, "version_selected")));
    expect(events).toHaveLength(1);
    expect(events[0].before).toMatchObject({ activeVersion: "v3" });
    expect(events[0].after).toMatchObject({ activeVersion: "v2" });
    expect(events[0].summary).toMatch(/replay clock stays at 2026-06-23/);

    // A proposal made against v3 cannot be decided while the workspace is on v2.
    const stale = await priya.run("propose_adjustment", {
      targetRef: "SchC.1",
      kind: "value",
      proposedValue: 150000,
      reason: "Test proposal on the v2 baseline.",
      evidenceRefs: ["doc:D15#page3"],
      category: "schc_profit",
    });
    expect(stale.ok).toBe(true);
    const back = await priya.run("set_version", { version: "v3" });
    expect(back.ok).toBe(true);
    const decide = await helen.run("decide_adjustment", { adjustmentId: (stale.ok ? (stale.result as { adjustmentId: string }).adjustmentId : ""), decision: "accept" });
    expect(decide.ok).toBe(false);
    if (!decide.ok) expect(decide.error.message).toMatch(/Rebase the proposal first/);
  });

  it("timelineView at the default clock lists tl-18 (msg-07 on June 30) as future and hides its detail", async () => {
    const tv = await timelineView(priya.ctx);
    expect(tv.asOf).toBe("2026-06-23T06:05:00.000Z");
    expect(tv.events.map((e) => e.id)).toEqual(loaded.packet.timeline.map((e) => e.id));
    const tl18 = tv.events.find((e) => e.id === "tl-18")!;
    expect(tl18.isPast).toBe(false);
    expect(tl18.event).toBe("client_message");
    expect(tl18.at).toBe("2026-06-30T18:02:00Z");
    expect(tl18.detail).toBeNull();
    expect(tl18.refs).toEqual([]);
    const tl17 = tv.events.find((e) => e.id === "tl-17")!;
    expect(tl17.isPast).toBe(true);
    expect(tl17.refs[0]).toMatchObject({ ref: "v3", found: true });
    expect(tv.clockAtEventId).toBe("tl-17");
    expect(tv.nextEventId).toBe("tl-18");
    expect(tv.pastCount).toBe(17);
    expect(tv.futureCount).toBe(12);
    const extension = tv.events.find((e) => e.id === "extension-2026-04-14")!;
    expect(extension.isExtension).toBe(true);
    expect(extension.isPast).toBe(true);
    expect(extension.actorName).toBe("Daniel Ortiz");
    expect(extension.detail).toMatch(/Form 4868/);

    // Advancing past the 8879 signing reveals that event, with the PINs masked.
    const moved = await priya.run("advance_time", { to: "2026-07-11T00:00:00Z" });
    expect(moved.ok).toBe(true);
    const later = await timelineView(priya.ctx);
    const tl20 = later.events.find((e) => e.id === "tl-20")!;
    expect(tl20.isPast).toBe(true);
    expect(tl20.detail).not.toContain("41207");
    expect(tl20.detail).toContain("PIN *****");
    expect(later.events.find((e) => e.id === "tl-21")!.isPast).toBe(false);
  });

  it("the audit page lists newest first, filters by actor, area and action, and paginates", async () => {
    const page = await auditPage(priya.ctx, {}, 1);
    expect(page.total).toBeGreaterThan(5);
    expect(page.events[0].revision).toBe(priya.ctx.workspace.revision);
    for (let i = 1; i < page.events.length; i++) expect(page.events[i - 1].revision).toBeGreaterThanOrEqual(page.events[i].revision);
    expect(page.pageSize).toBe(50);
    expect(page.options.actors.map((a) => a.name)).toContain("Helen Strand");
    expect(page.options.actions.map((a) => a.id)).toContain("version_selected");

    const byActor = await auditPage(priya.ctx, { actor: "st-03" });
    expect(byActor.total).toBeGreaterThan(0);
    expect(byActor.events.every((e) => e.actorId === "st-03")).toBe(true);
    const byArea = await auditPage(priya.ctx, { area: "business" });
    expect(byArea.events.every((e) => e.area === "business")).toBe(true);
    const byAction = await auditPage(priya.ctx, { action: "clock_moved" });
    expect(byAction.total).toBe(1);
    expect(byAction.events[0].before).toEqual({ asOf: expect.any(String) });
    const beyond = await auditPage(priya.ctx, {}, 99);
    expect(beyond.page).toBe(beyond.pageCount);
  });
});
