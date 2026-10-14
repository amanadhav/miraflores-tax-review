import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import * as t from "@/db/schema";
import { looksSensitive, makeRedactor } from "@/domain/redaction";
import type { LoadedPacket } from "@/packet/load";
import { revealField } from "@/server/reveal";
import { importedDb } from "./helpers/db";
import { newWorkspace, persona, type Persona } from "./helpers/session";

/**
 * Sensitive data never leaves the server unmasked. The redactor is checked
 * over every text the packet contains, and the logged reveal path is checked
 * for the three kinds of viewer: a staff member without clearance, a cleared
 * reviewer, and a client.
 */
describe("redaction and logged reveals", () => {
  let handle: DbHandle;
  let loaded: LoadedPacket;
  let wsId: string;
  let marcus: Persona;
  let daniel: Persona;
  let client: Persona;

  beforeAll(async () => {
    const db = await importedDb();
    handle = db.handle;
    loaded = db.loaded;
    const ws = await newWorkspace(handle, loaded);
    wsId = ws.id;
    marcus = await persona(handle, loaded, wsId, "st-04");
    daniel = await persona(handle, loaded, wsId, "st-02");
    client = await persona(handle, loaded, wsId, "cu-01");
  });
  afterAll(async () => {
    await handle.close();
  });

  it("the packet does contain sensitive values in the raw, so the checks below are meaningful", () => {
    const packet = loaded.packet;
    const ssnPages = packet.documents.flatMap((d) => d.pages.filter((p) => looksSensitive(p.printed_content, packet)));
    expect(ssnPages.length).toBeGreaterThanOrEqual(10);
    expect(looksSensitive(JSON.stringify(packet.household), packet)).toBe(true);
    expect(looksSensitive(JSON.stringify(packet.firm.firm_identity), packet)).toBe(true);
    expect(looksSensitive(packet.timeline.find((e) => e.id === "tl-20")!.detail!, packet)).toBe(true);
  });

  it("redacts every printed page", () => {
    const packet = loaded.packet;
    const redact = makeRedactor(packet);
    let pages = 0;
    for (const d of packet.documents) {
      for (const p of d.pages) {
        pages += 1;
        const out = redact.text(p.printed_content);
        expect(looksSensitive(out, packet), `${d.id} page ${p.page}`).toBe(false);
      }
    }
    expect(pages).toBe(199);
    const card = packet.documents.find((d) => d.id === "D71")!.pages[0];
    expect(redact.text(card.printed_content)).toMatch(/\*\*\*-\*\*-\d{4}/);
  });

  it("redacts every extracted value and the text it was read from", () => {
    const packet = loaded.packet;
    const redact = makeRedactor(packet);
    for (const ev of packet.extracted_values) {
      const value = typeof ev.value === "string" ? ev.value : JSON.stringify(ev.value ?? null);
      expect(looksSensitive(redact.text(value), packet), `${ev.id} value`).toBe(false);
      expect(looksSensitive(redact.text(ev.text_as_read), packet), `${ev.id} text_as_read`).toBe(false);
    }
    const iban = packet.extracted_values.find((ev) => ev.id === "ev-0963")!;
    expect(iban.value_type).toBe("account_number");
    expect(redact.text(iban.text_as_read)).toMatch(/^\*\*\*\*\S{4}$/);
  });

  it("redacts every client message, answer, call note and timeline detail", () => {
    const packet = loaded.packet;
    const redact = makeRedactor(packet);
    for (const m of packet.client.messages) expect(looksSensitive(redact.text(m.text), packet), m.id).toBe(false);
    for (const q of packet.client.questionnaire) expect(looksSensitive(redact.text(`${q.question} ${q.answer}`), packet), q.id).toBe(false);
    for (const c of packet.client.call_notes) for (const n of c.notes) expect(looksSensitive(redact.text(n), packet), c.id).toBe(false);
    for (const e of packet.timeline) {
      if (!e.detail) continue;
      const out = redact.text(e.detail);
      expect(looksSensitive(out, packet), e.id).toBe(false);
      if (e.id === "tl-20") {
        expect(out).toMatch(/Taxpayer PIN \*+/);
        expect(out).toMatch(/spouse PIN \*+/);
      }
    }
  });

  it("deep-redacts the household and firm identity objects, keeping only the last four digits", () => {
    const packet = loaded.packet;
    const redact = makeRedactor(packet);
    const household = redact.deep(packet.household);
    expect(looksSensitive(JSON.stringify(household), packet)).toBe(false);
    const ngozi = household.people.find((p) => p.id === "ngozi")!;
    expect(ngozi.ssn).toMatch(/^\*\*\*-\*\*-\d{4}$/);
    expect(ngozi.ssn.slice(-4)).toBe(packet.household.people[0].ssn.slice(-4));
    expect(ngozi.ip_pin).toBe("*****");
    expect(household.bank_account_for_refund_or_payment.routing).toMatch(/^\*\*\*\*\d{4}$/);
    expect(household.bank_account_for_refund_or_payment.account).toMatch(/^\*\*\*\*\d{4}$/);

    const identity = redact.deep(packet.firm.firm_identity);
    expect(looksSensitive(JSON.stringify(identity), packet)).toBe(false);
    expect(identity.efin).toBe("*****");
    expect(identity.ero_pin).toBe("*****");
    expect(Object.values(identity.ptins).every((v) => v === "*****")).toBe(true);
    // EIN, address and phone are not sensitive and stay readable.
    expect(identity.ein).toBe(packet.firm.firm_identity.ein);
  });

  it("the commands route pattern (deep redaction of a result) leaves a page text clean", () => {
    const packet = loaded.packet;
    const redact = makeRedactor(packet);
    const w2 = packet.documents.find((d) => d.id === "D08")!;
    const sample = {
      ok: true,
      revision: 3,
      result: {
        page: { documentId: w2.id, page: 1, printedContent: w2.pages[0].printed_content },
        person: packet.household.people[0],
        detail: packet.timeline.find((e) => e.id === "tl-20")!.detail,
        values: packet.extracted_values.filter((ev) => ev.value_type === "ssn"),
      },
    };
    expect(looksSensitive(JSON.stringify(sample), packet)).toBe(true);
    const json = JSON.stringify(redact.deep(sample));
    expect(looksSensitive(json, packet)).toBe(false);
    expect(json).toContain("***-**-");
  });

  it("Marcus (no clearance) is refused, and the refusal is written to the view log and the audit trail", async () => {
    const before = marcus.ctx.workspace.revision;
    const r = await revealField(marcus.ctx, { ref: "household:ngozi", field: "ssn" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("forbidden");
    expect(r.message).toMatch(/logged/);
    expect(looksSensitive(r.message, loaded.packet)).toBe(false);

    const views = await handle.db
      .select()
      .from(t.viewEvents)
      .where(and(eq(t.viewEvents.workspaceId, wsId), eq(t.viewEvents.actorId, "st-04")));
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ ref: "household:ngozi", field: "ssn", outcome: "denied", revision: before });
    expect(views[0].reason).toMatch(/clearance/);

    const audits = await handle.db
      .select()
      .from(t.auditEvents)
      .where(and(eq(t.auditEvents.workspaceId, wsId), eq(t.auditEvents.action, "sensitive_reveal_denied")));
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe("st-04");
    expect(audits[0].revision).toBe(before);
    expect(looksSensitive(audits[0].summary, loaded.packet)).toBe(false);

    // A logged read never bumps the workspace revision.
    await marcus.refresh();
    expect(marcus.ctx.workspace.revision).toBe(before);
  });

  it("Daniel (cleared reviewer) gets the value once; the log records the view but never the value", async () => {
    const packet = loaded.packet;
    const ngozi = packet.household.people.find((p) => p.id === "ngozi")!;
    const r = await revealField(daniel.ctx, { ref: "household:ngozi", field: "ssn" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(ngozi.ssn);

    const views = await handle.db
      .select()
      .from(t.viewEvents)
      .where(and(eq(t.viewEvents.workspaceId, wsId), eq(t.viewEvents.actorId, "st-02")));
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ ref: "household:ngozi", field: "ssn", outcome: "revealed" });
    expect(views[0].reason ?? "").not.toContain(ngozi.ssn);

    const audits = await handle.db
      .select()
      .from(t.auditEvents)
      .where(and(eq(t.auditEvents.workspaceId, wsId), eq(t.auditEvents.action, "sensitive_revealed")));
    expect(audits).toHaveLength(1);
    expect(audits[0].summary).not.toContain(ngozi.ssn);
    expect(looksSensitive(JSON.stringify(audits[0]), packet)).toBe(false);
  });

  it("supports every documented target for cleared staff and nothing else", async () => {
    const packet = loaded.packet;
    const ok = async (ref: string, field: string) => {
      const r = await revealField(daniel.ctx, { ref, field });
      expect(r.ok, `${ref} ${field}`).toBe(true);
      return r.ok ? r.value : "";
    };
    expect(await ok("household:ngozi", "ip_pin")).toBe(packet.household.people[0].ip_pin);
    expect(await ok("household:bank", "routing")).toBe(packet.household.bank_account_for_refund_or_payment.routing);
    expect(await ok("household:bank", "account")).toBe(packet.household.bank_account_for_refund_or_payment.account);
    expect(await ok("ev-0963", "value")).toBe(packet.extracted_values.find((ev) => ev.id === "ev-0963")!.value);
    expect(await ok("firm:identity", "efin")).toBe(packet.firm.firm_identity.efin);
    expect(await ok("firm:identity", "ero_pin")).toBe(packet.firm.firm_identity.ero_pin);
    expect(await ok("firm:identity", "ptin:st-02")).toBe(packet.firm.firm_identity.ptins["st-02"]);
    const detail = packet.timeline.find((e) => e.id === "tl-20")!.detail!;
    expect(await ok("timeline:tl-20", "taxpayer_pin")).toBe(detail.match(/Taxpayer PIN (\d+)/)![1]);
    expect(await ok("timeline:tl-20", "spouse_pin")).toBe(detail.match(/spouse PIN (\d+)/)![1]);

    const noPin = await revealField(daniel.ctx, { ref: "household:erik", field: "ip_pin" });
    expect(noPin.ok).toBe(false);
    if (!noPin.ok) expect(noPin.code).toBe("not_found");
    const money = await revealField(daniel.ctx, { ref: "ev-0103", field: "value" });
    expect(money.ok).toBe(false);
    if (!money.ok) expect(money.code).toBe("unsupported");
    const nobody = await revealField(daniel.ctx, { ref: "household:zed", field: "ssn" });
    expect(nobody.ok).toBe(false);
    if (!nobody.ok) expect(nobody.code).toBe("not_found");

    // Every one of those attempts, allowed or not, is in the view log.
    const views = await handle.db
      .select()
      .from(t.viewEvents)
      .where(and(eq(t.viewEvents.workspaceId, wsId), eq(t.viewEvents.actorId, "st-02")));
    expect(views.filter((v) => v.outcome === "revealed")).toHaveLength(10);
    expect(views.filter((v) => v.outcome === "denied")).toHaveLength(3);
    for (const v of views) expect(looksSensitive(JSON.stringify(v), packet)).toBe(false);
  });

  it("a client user is refused even for their own SSN, and the refusal is logged", async () => {
    const r = await revealField(client.ctx, { ref: "household:ngozi", field: "ssn" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("forbidden");
    const views = await handle.db
      .select()
      .from(t.viewEvents)
      .where(and(eq(t.viewEvents.workspaceId, wsId), eq(t.viewEvents.actorId, "cu-01")));
    expect(views).toHaveLength(1);
    expect(views[0].outcome).toBe("denied");
    expect(views[0].reason).toMatch(/client/);
  });

  it("a sensitive value smuggled into the target is masked before it is logged", async () => {
    const ssn = loaded.packet.household.people[0].ssn;
    const r = await revealField(marcus.ctx, { ref: "household:ngozi", field: ssn });
    expect(r.ok).toBe(false);
    const rows = await handle.db.select().from(t.viewEvents).where(eq(t.viewEvents.workspaceId, wsId));
    const audits = await handle.db.select().from(t.auditEvents).where(eq(t.auditEvents.workspaceId, wsId));
    expect(looksSensitive(JSON.stringify(rows), loaded.packet)).toBe(false);
    expect(looksSensitive(JSON.stringify(audits), loaded.packet)).toBe(false);
  });
});
