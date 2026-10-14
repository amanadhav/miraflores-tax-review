import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import * as t from "@/db/schema";
import { looksSensitive } from "@/domain/redaction";
import type { LoadedPacket } from "@/packet/load";
import { buildClientCopy, buildNoticeBundle, carryforwardExport, examinationLines } from "@/server/export";
import { filingReadiness } from "@/server/filing";
import { loadWorkspaceState } from "@/server/state";
import { importedDb } from "./helpers/db";
import { newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * Self-contained exports: the client copy carries the frozen presentation
 * with its manifest hash and no sensitive literal; the notice bundle, once the
 * clock reaches the 2028 letter, carries the printed passages, the accepted
 * adjustment and its reason, content hashes and no links back to the app.
 */
describe("exports", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let wsId: string;
  let priya: Persona;
  let daniel: Persona;
  let helen: Persona;
  let ngozi: Persona;
  let erik: Persona;

  const SCHC_REASON = "Gross receipts agreed to the QuickBooks profit and loss: 145,900 client projects plus 5,400 print and licensing; the 1099-K amounts all match books deposits.";

  beforeAll(async () => {
    const db = await importedDb();
    handle = db.handle;
    loaded = db.loaded;
    const ws = await newWorkspace(handle, loaded);
    wsId = ws.id;
    priya = await persona(handle, loaded, wsId, "st-01");
    daniel = await persona(handle, loaded, wsId, "st-02");
    helen = await persona(handle, loaded, wsId, "st-03");
    ngozi = await persona(handle, loaded, wsId, "cu-01");
    erik = await persona(handle, loaded, wsId, "cu-02");
  });
  afterAll(async () => {
    await handle.close();
  });

  const ok = (r: { ok: boolean; error?: { message: string; code: string } }) => {
    if (!r.ok) throw new Error(`${r.error?.code}: ${r.error?.message}`);
    return r as { ok: true; result: unknown; revision: number };
  };

  const noAppLinks = (html: string) => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/localhost/i);
    expect(html).not.toMatch(/href="\/(review|evidence|changes|filing|client|api)/);
    expect(html).not.toMatch(/<link\s/i);
    expect(html).not.toMatch(/<img\s/i);
  };

  it("maps examination items to return lines", () => {
    const v3 = loaded.packet.return_versions.find((v) => v.version === "v3")!;
    const notice = (loaded.packet.tax_agency_records.notices as { id: string; items_under_examination?: string[] }[]).find((n) => n.id === "N-2025-L566")!;
    const [charity, schc] = notice.items_under_examination!;
    expect(examinationLines(charity, v3)).toEqual(["F8283.A1.stock", "F8283.A1.vehicle", "SchA.12"]);
    expect(examinationLines(schc, v3)).toEqual(["SchC.1"]);
    expect(examinationLines("Something unrelated", v3)).toEqual([]);
  });

  let acceptedSnapshotId: string;

  it("walks the lifecycle to acceptance with an accepted Schedule C receipts change", async () => {
    const proposed = ok(await priya.run("propose_adjustment", {
      targetRef: "SchC.1",
      kind: "value",
      proposedValue: 151300,
      reason: SCHC_REASON,
      evidenceRefs: ["doc:D14#page1", "ev-0103", "D21"],
      category: "schc_profit",
    }));
    expect((proposed.result as { requiresPartner: boolean }).requiresPartner).toBe(true);
    ok(await helen.run("decide_adjustment", { adjustmentId: (proposed.result as { adjustmentId: string }).adjustmentId, decision: "accept", note: "Books agree; the 1099-K duplication is removed." }));

    const state = await loadWorkspaceState(handle.db, (await priya.refresh()));
    for (const f of state.findings.filter((x) => x.status === "open")) {
      ok(await daniel.run("resolve_finding", { findingId: f.id, outcome: "resolved", resolution: `Reviewed for the demo: ${f.title}.` }));
    }
    ok(await priya.run("add_verification", { subjectRef: "household:ngozi", method: "agreed_to_source_document", evidenceRefs: ["D04"], conclusion: "agrees", note: "Identity agreed to the Texas license." }));
    ok(await priya.run("add_verification", { subjectRef: "D06", method: "agreed_to_prior_year", evidenceRefs: ["D06"], conclusion: "agrees", note: "Prior-year return reviewed." }));
    ok(await priya.run("add_verification", { subjectRef: "F1040.26", method: "agreed_to_third_party_record", evidenceRefs: ["agency:/irs_account_transcript_2025/0"], conclusion: "disagrees", note: "Transcript shows 12,000; questionnaire claims 13,000." }));
    ok(await priya.run("add_verification", { subjectRef: "F540NR.72", method: "agreed_to_third_party_record", evidenceRefs: ["agency:/ftb_account"], conclusion: "disagrees", note: "FTB credits 10,500 to 2025." }));
    ok(await priya.run("record_judgment", {
      kind: "due_diligence",
      subjectRef: "F8867.status",
      title: "Form 8867 due diligence for CTC and ODC",
      authority: "IRC 6695(g); Form 8867 instructions",
      applicability: "Child tax credit claimed for Theo; credit for other dependents for Ada.",
      conclusion: "Checklist completed from the organizer, identity documents and school records.",
      evidenceRefs: ["D04", "D59", "qa-04"],
      checklist: [{ item: "Residency of qualifying child confirmed", done: true }, { item: "Relationship confirmed", done: true }, { item: "Knowledge requirement questions documented", done: true }],
    }));
    let readiness = await filingReadiness(handle.db, await priya.refresh());
    const docs = readiness.items.find((i) => i.step === "All documents accounted for")!;
    if (!docs.ok) ok(await priya.run("batch_disposition", { subjectRefs: docs.refs, disposition: "reviewed_no_use", note: "Reviewed; not an input to the computed return." }));
    const swings = readiness.items.find((i) => i.step === "Prior-year variances explained")!;
    if (!swings.ok) ok(await priya.run("batch_verify", { subjectRefs: swings.refs, method: "agreed_to_prior_year", conclusion: "agrees", note: "Swing explained by the move, the sale and the job change." }));
    const carry = readiness.items.find((i) => i.step === "Carryovers agreed to prior year")!;
    if (!carry.ok) ok(await priya.run("batch_verify", { subjectRefs: carry.refs, method: "agreed_to_prior_year", conclusion: "agrees", evidenceRefs: ["py:/carryovers_into_2025"] }));
    readiness = await filingReadiness(handle.db, await priya.refresh());
    expect(readiness.blocking.map((b) => b.step)).toEqual(["Reviewer sign-off", "Partner sign-off"]);
    ok(await daniel.run("sign_off", { scopeType: "return", scopeId: "*", level: "reviewer" }));
    ok(await helen.run("sign_off", { scopeType: "return", scopeId: "*", level: "partner" }));
    ok(await daniel.run("present_to_client", { note: "Presentation with the receipts correction" }));
    const snaps = await handle.db.select().from(t.filingSnapshots).where(and(eq(t.filingSnapshots.workspaceId, wsId), eq(t.filingSnapshots.kind, "client_ready")));
    const snapshotId = snaps[snaps.length - 1].id;
    ok(await ngozi.run("approve_return", { snapshotId, acknowledgement: true }));
    ok(await erik.run("approve_return", { snapshotId, acknowledgement: true }));
    ok(await helen.run("submit_filing", {}));
    const subs = await handle.db.select().from(t.submissions).where(eq(t.submissions.workspaceId, wsId));
    const federal = subs.find((s) => s.jurisdiction === "federal")!;
    ok(await helen.run("record_submission_outcome", { submissionId: federal.id, outcome: "accepted", fromPacketEfileIndex: 2 }));
    const after = await handle.db.select().from(t.submissions).where(eq(t.submissions.workspaceId, wsId));
    const california = after.find((s) => s.jurisdiction === "california")!;
    expect(california.status).toBe("submitted");
    ok(await helen.run("record_submission_outcome", { submissionId: california.id, outcome: "accepted", fromPacketEfileIndex: 3 }));
    expect((await helen.refresh()).workspace.workflowState).toBe("accepted");
    const accepted = await handle.db.select().from(t.filingSnapshots).where(and(eq(t.filingSnapshots.workspaceId, wsId), eq(t.filingSnapshots.kind, "accepted")));
    expect(accepted).toHaveLength(1);
    acceptedSnapshotId = accepted[0].id;
  });

  it("the client copy carries the frozen presentation, the manifest hash and no sensitive literal", async () => {
    const [snap] = await handle.db.select().from(t.filingSnapshots).where(eq(t.filingSnapshots.id, acceptedSnapshotId));
    const copy = await buildClientCopy((await helen.refresh()), acceptedSnapshotId);
    expect(copy.kind).toBe("accepted");
    const html = copy.html;
    expect(html.startsWith("<!doctype html>")).toBe(true);
    noAppLinks(html);
    expect(html).toMatch(/<style>/);
    // The frozen SchC.1 value, the baseline it replaced and the reason.
    expect(html).toContain("151,300");
    expect(html).toContain("163,700");
    expect(html).toContain(SCHC_REASON);
    expect(html).toMatch(/Lindqvist Studio - Profit and Loss/);
    // Identification masks SSNs to the last four and says so.
    expect(html).toMatch(/\*\*\*-\*\*-\d{4}/);
    expect(html).toMatch(/last four digits only/);
    expect(looksSensitive(html, loaded.packet)).toBe(false);
    // Manifest.
    expect(html).toContain(snap.contentHash);
    expect(copy.json.manifest.contentHash).toBe(snap.contentHash);
    expect(copy.json.manifest.snapshotId).toBe(acceptedSnapshotId);
    expect(copy.json.manifest.snapshotKind).toBe("accepted");
    expect(copy.json.manifest.revision).toBe(snap.revision);
    expect(copy.json.manifest.businessTime).toBe(new Date(snap.businessTime).toISOString());
    expect(copy.json.manifest.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Content: every line grouped by form, approvals, submissions, limitations.
    const schc = copy.json.forms.find((f) => f.form === "SchC")!;
    expect(schc.lines.find((l) => l.key === "SchC.1")).toMatchObject({ baseline: 163700, effective: 151300, status: "adjusted" });
    expect(copy.json.forms.map((f) => f.form)).toContain("F540NR");
    expect(copy.json.changes).toHaveLength(1);
    expect(copy.json.changes[0].evidence.some((e) => /Profit and Loss/.test(e) && /page 1/.test(e))).toBe(true);
    expect(copy.json.approvals.map((a) => a.status)).toEqual(["approved", "approved"]);
    expect(copy.json.submissions.map((s) => [s.jurisdiction, s.status, s.simulated])).toEqual([
      ["federal", "accepted", true],
      ["california", "accepted", true],
    ]);
    expect(copy.json.limitations.length).toBeGreaterThan(0);
    expect(looksSensitive(JSON.stringify(copy.json), loaded.packet)).toBe(false);
    expect((copy.json.payload as { lines: unknown[] }).lines.length).toBeGreaterThan(100);
    expect(html).toMatch(/simulated/i);
    expect(html).not.toMatch(/corrected final tax/i);
  });

  it("clients export client presentations only; snapshots of other workspaces are not found", async () => {
    const mine = await buildClientCopy((await ngozi.refresh()), acceptedSnapshotId);
    const staff = await buildClientCopy((await helen.refresh()), acceptedSnapshotId);
    expect(mine.json.manifest.contentHash).toBe(staff.json.manifest.contentHash);
    expect(mine.json.manifest.recordSha256).toBe(staff.json.manifest.recordSha256);
    expect(looksSensitive(mine.html, loaded.packet)).toBe(false);
    await expect(buildClientCopy((await ngozi.refresh()), "snp_nope")).rejects.toThrow(/No such snapshot/);
    const other = await newWorkspace(handle, loaded);
    const stranger = await persona(handle, loaded, other.id, "st-03");
    await expect(buildClientCopy((await stranger.refresh()), acceptedSnapshotId)).rejects.toThrow(/No such snapshot/);
    await expect(buildNoticeBundle((await ngozi.refresh()), "N-2023-CP2000")).rejects.toThrow(/prepared by the firm/);
  });

  it("the notice bundle waits for the clock, then carries passages, the adjustment reason, hashes and no app links", async () => {
    await expect(buildNoticeBundle((await helen.refresh()), "N-2025-L566")).rejects.toMatchObject({ code: "unavailable" });
    await expect(buildNoticeBundle((await helen.refresh()), "N-9999")).rejects.toMatchObject({ code: "not_found" });
    ok(await priya.run("advance_time", { to: "2028-02-01T00:00:00Z" }));

    const bundle = await buildNoticeBundle((await helen.refresh()), "N-2025-L566");
    const html = bundle.html;
    noAppLinks(html);
    expect(looksSensitive(html, loaded.packet)).toBe(false);
    expect(html).toContain("Profit and Loss, Lindqvist Studio, Jan-Dec 2025, cash basis.");
    expect(html).toContain(SCHC_REASON);
    expect(html).toContain("Letter 566");
    expect(html).toContain("R-SCHC-GROSS");
    expect(html).toMatch(/Books revenue, plus payment-card/);
    expect(html).not.toMatch(/No accepted filing exists/);
    expect(html).toContain("151,300");
    expect((html.match(/\b[0-9a-f]{64}\b/g) ?? []).length).toBeGreaterThan(5);

    const j = bundle.json;
    expect(j.manifest.valueBasis).toBe("accepted_snapshot");
    expect(j.manifest.acceptedSnapshot?.id).toBe(acceptedSnapshotId);
    expect(j.manifest.warning).toBeNull();
    expect(j.manifest.items.map((i) => i.lines)).toEqual([["F8283.A1.stock", "F8283.A1.vehicle", "SchA.12"], ["SchC.1"]]);
    const schcItem = j.items[1];
    const schc = schcItem.lines[0];
    expect(schc.value).toMatchObject({ basis: "accepted_snapshot", baseline: 163700, effective: 151300, status: "adjusted" });
    expect(schc.rule.id).toBe("R-SCHC-GROSS");
    expect(schc.sources.map((s) => s.ref)).toContain("ev-0103");
    const d14 = j.passages.find((p) => p.id === "D14-p1")!;
    expect(d14.page).toBe(1);
    expect(d14.sha256).toBe(createHash("sha256").update(d14.text, "utf8").digest("hex"));
    expect(j.manifest.passages.find((p) => p.id === "D14-p1")?.sha256).toBe(d14.sha256);
    expect(schc.sources.find((s) => s.ref === "ev-0103")?.passageIds).toEqual(["D14-p1"]);
    expect(schc.adjustments).toHaveLength(1);
    expect(schc.adjustments[0].reason).toBe(SCHC_REASON);
    expect(schc.adjustments[0].decidedByName).toBe(loaded.packet.firm.staff.find((s) => s.id === "st-03")!.name);
    expect(j.manifest.adjustments).toEqual([schc.adjustments[0].id]);
    // The charity item: Schedule A line 12 is a sum, so its sources come from the Form 8283 input lines.
    const schA = j.items[0].lines.find((l) => l.key === "SchA.12")!;
    expect(schA.sources.map((s) => s.ref)).toEqual(expect.arrayContaining(["ev-1050", "qa-39"]));
    expect(j.passages.some((p) => p.id === "qa-39" && /Subaru/.test(p.text))).toBe(true);
    // The notice document itself is printed once the clock has passed its receipt.
    expect(j.notice.documentPassageIds).toEqual(["D72-p1"]);
    expect(j.manifest.recordSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(looksSensitive(JSON.stringify(j), loaded.packet)).toBe(false);
  });

  it("without an accepted filing the bundle warns and uses current effective values", async () => {
    const fresh = await newWorkspace(handle, loaded);
    const reviewer = await persona(handle, loaded, fresh.id, "st-02");
    ok(await reviewer.run("advance_time", { to: "2028-02-01T00:00:00Z" }));
    const bundle = await buildNoticeBundle((await reviewer.refresh()), "N-2025-L566");
    expect(bundle.json.manifest.valueBasis).toBe("current_effective");
    expect(bundle.json.manifest.warning).toMatch(/No accepted filing exists/);
    expect(bundle.html).toMatch(/No accepted filing exists/);
    expect(bundle.json.items[1].lines[0].value).toMatchObject({ basis: "current_effective", effective: 163700, status: "baseline" });
    noAppLinks(bundle.html);
  });

  it("the carryforward export returns the successor record and is staff only", async () => {
    const next = ok(await priya.run("start_next_year", { note: "Handoff" }));
    const id = (next.result as { carryforwardId: string }).carryforwardId;
    const out = await carryforwardExport((await helen.refresh()), id);
    const json = out.json as { manifest: { snapshotId: string; documentKind: string }; carryoversOut: unknown; basedOn: { acceptedSnapshotId: string }; note: string };
    expect(json.manifest).toMatchObject({ documentKind: "carryforward", snapshotId: id });
    expect(json.basedOn.acceptedSnapshotId).toBe(acceptedSnapshotId);
    expect(json.carryoversOut).toBeDefined();
    expect(json.note).toMatch(/No 2026 computation exists/);
    expect(looksSensitive(JSON.stringify(json), loaded.packet)).toBe(false);
    await expect(carryforwardExport((await ngozi.refresh()), id)).rejects.toThrow(/firm-internal/);
    await expect(carryforwardExport((await helen.refresh()), acceptedSnapshotId)).rejects.toThrow(/not a carryforward/);
    await expect(buildClientCopy((await helen.refresh()), id)).rejects.toThrow(/not a client presentation/);
  });
});
