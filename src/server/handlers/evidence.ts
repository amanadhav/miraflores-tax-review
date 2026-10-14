import { z } from "zod";
import * as t from "@/db/schema";
import { areaForLine } from "@/domain/areas";
import { requirePermission } from "@/domain/policy";
import { indexPacket } from "@/packet/load";
import { parseRef, resolveRef } from "@/packet/refs";
import { CommandError, registerHandler } from "../commands";
import { newId } from "../ids";
import { recordContribution } from "../state";
import { assertEvidence } from "./adjustments";

function subjectArea(hc: { ctx: { packet: { packet: import("@/packet/types").Packet }; workspace: { activeVersion: string } } }, subjectRef: string): string {
  const parsed = parseRef(subjectRef);
  const packet = hc.ctx.packet.packet;
  if (parsed.kind === "line") {
    const line = indexPacket(packet).linesByVersion.get(hc.ctx.workspace.activeVersion)?.get(parsed.key);
    if (!line) throw new CommandError("not_found", `${subjectRef} is not a line in ${hc.ctx.workspace.activeVersion}.`);
    return areaForLine(line.key, line.form);
  }
  const resolved = resolveRef(packet, subjectRef, { version: hc.ctx.workspace.activeVersion });
  if (!resolved.found && parsed.kind !== "workpaper") throw new CommandError("not_found", `${subjectRef} does not resolve.`);
  return "intake_and_engagement";
}

const verificationSchema = z.object({
  subjectRef: z.string().min(1),
  method: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).max(40).default([]),
  conclusion: z.enum(["agrees", "disagrees", "unresolved"]),
  note: z.string().max(2000).optional(),
});

registerHandler({
  type: "add_verification",
  schema: verificationSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "add_verification", "record verifications");
    const allowed = ctx.packet.packet.firm.starter_standards.verification_types;
    if (!allowed.includes(p.method)) throw new CommandError("validation", `Verification method must be one of: ${allowed.join(", ")}.`);
    const area = subjectArea(hc, p.subjectRef);
    assertEvidence(hc, p.evidenceRefs);
    const id = newId("ver");
    await tx.insert(t.verifications).values({
      id,
      workspaceId: ctx.workspace.id,
      subjectRef: p.subjectRef,
      area,
      method: p.method,
      evidenceRefs: p.evidenceRefs,
      conclusion: p.conclusion,
      note: p.note ?? null,
      actorId: ctx.actor.id,
      createdRevision: revision,
    });
    const scopes: { scopeType: "area" | "line"; scopeId: string }[] = [{ scopeType: "area", scopeId: area }];
    if (parseRef(p.subjectRef).kind === "line") scopes.push({ scopeType: "line", scopeId: p.subjectRef });
    await recordContribution(tx, ctx.workspace.id, ctx.actor.id, "verification", revision, scopes);
    if (p.evidenceRefs.length) {
      await tx.insert(t.referenceEdges).values(
        p.evidenceRefs.map((ref) => ({
          packetId: ctx.workspace.packetId,
          workspaceId: ctx.workspace.id,
          version: ctx.workspace.activeVersion,
          fromRef: ref,
          toRef: p.subjectRef,
          relation: "verifies",
          origin: "workpaper",
        })),
      );
    }
    return {
      result: { verificationId: id },
      events: [
        {
          action: "verification_recorded",
          entityType: "verification",
          entityId: id,
          summary: `${ctx.actor.name} verified ${p.subjectRef} by ${p.method.replace(/_/g, " ")}: ${p.conclusion}${p.note ? ` (${p.note})` : ""}.`,
          after: { subjectRef: p.subjectRef, method: p.method, conclusion: p.conclusion, evidenceRefs: p.evidenceRefs },
          area,
        },
      ],
    };
  },
});

const anchorSchema = z.object({
  subjectRef: z.string().min(1),
  documentId: z.string().regex(/^D\d{2}$/),
  page: z.number().int().positive(),
  textSpan: z.string().min(2).max(500),
  occurrence: z.number().int().nonnegative().default(0),
  note: z.string().max(1000).optional(),
});

registerHandler({
  type: "add_anchor",
  schema: anchorSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "add_anchor", "anchor evidence to source text");
    const packet = ctx.packet.packet;
    const doc = indexPacket(packet).documents.get(p.documentId);
    const page = doc?.pages.find((pg) => pg.page === p.page);
    if (!doc || !page) throw new CommandError("not_found", `${p.documentId} page ${p.page} is not in the packet.`);
    assertEvidence(hc, [`doc:${p.documentId}#page${p.page}`]);
    const area = subjectArea(hc, p.subjectRef);
    // Exact text only: an anchor is a quotation of what is printed, never an approximation.
    let start = -1;
    let from = 0;
    for (let i = 0; i <= p.occurrence; i++) {
      start = page.printed_content.indexOf(p.textSpan, from);
      if (start < 0) break;
      from = start + 1;
    }
    if (start < 0) throw new CommandError("validation", `The exact text "${p.textSpan}" is not printed on ${p.documentId} page ${p.page}.`);
    const id = newId("anc");
    await tx.insert(t.anchors).values({
      id,
      workspaceId: ctx.workspace.id,
      subjectRef: p.subjectRef,
      documentId: p.documentId,
      page: p.page,
      textSpan: p.textSpan,
      startOffset: start,
      endOffset: start + p.textSpan.length,
      origin: "manual",
      note: p.note ?? null,
      createdBy: ctx.actor.id,
      createdRevision: revision,
    });
    const scopes: { scopeType: "area" | "line"; scopeId: string }[] = [{ scopeType: "area", scopeId: area }];
    if (parseRef(p.subjectRef).kind === "line") scopes.push({ scopeType: "line", scopeId: p.subjectRef });
    await recordContribution(tx, ctx.workspace.id, ctx.actor.id, "anchor", revision, scopes);
    await tx.insert(t.referenceEdges).values({
      packetId: ctx.workspace.packetId,
      workspaceId: ctx.workspace.id,
      version: ctx.workspace.activeVersion,
      fromRef: `doc:${p.documentId}#page${p.page}`,
      toRef: p.subjectRef,
      relation: "anchors",
      origin: "workpaper",
    });
    return {
      result: { anchorId: id, startOffset: start, endOffset: start + p.textSpan.length },
      events: [
        {
          action: "anchor_added",
          entityType: "anchor",
          entityId: id,
          summary: `${ctx.actor.name} anchored ${p.subjectRef} to "${p.textSpan}" on ${doc.title}, page ${p.page}.`,
          after: { subjectRef: p.subjectRef, documentId: p.documentId, page: p.page, textSpan: p.textSpan },
          area,
        },
      ],
    };
  },
});
