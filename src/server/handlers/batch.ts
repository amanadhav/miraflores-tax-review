import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import * as t from "@/db/schema";
import { requirePermission } from "@/domain/policy";
import { parseRef } from "@/packet/refs";
import { CommandError, registerHandler, type AuditSeed } from "../commands";
import { newId } from "../ids";
import { recordContribution } from "../state";
import { assertEvidence } from "./adjustments";
import { subjectArea } from "./common";

const batchVerify = z.object({
  subjectRefs: z.array(z.string().min(1)).min(1).max(500),
  method: z.string().min(1),
  conclusion: z.enum(["agrees", "disagrees", "unresolved"]),
  evidenceRefs: z.array(z.string().min(1)).max(40).default([]),
  note: z.string().max(2000).optional(),
});

/**
 * Act on many items at once. The whole batch succeeds or fails together and
 * every record carries the batch id so one undo can reverse exactly this set.
 */
registerHandler({
  type: "batch_verify",
  schema: batchVerify,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "add_verification", "record verifications");
    const allowed = ctx.packet.packet.firm.starter_standards.verification_types;
    if (!allowed.includes(p.method)) throw new CommandError("validation", `Verification method must be one of: ${allowed.join(", ")}.`);
    await assertEvidence(hc, p.evidenceRefs);
    const batchId = newId("bat");
    const scopes = new Map<string, { scopeType: "area" | "line"; scopeId: string }>();
    const rows = p.subjectRefs.map((subjectRef) => {
      const area = subjectArea(hc, subjectRef);
      scopes.set(`area:${area}`, { scopeType: "area", scopeId: area });
      if (parseRef(subjectRef).kind === "line") scopes.set(`line:${subjectRef}`, { scopeType: "line", scopeId: subjectRef });
      return {
        id: newId("ver"),
        workspaceId: ctx.workspace.id,
        subjectRef,
        area,
        method: p.method,
        evidenceRefs: p.evidenceRefs,
        conclusion: p.conclusion,
        note: p.note ?? null,
        actorId: ctx.actor.id,
        createdRevision: revision,
        batchId,
      };
    });
    await tx.insert(t.verifications).values(rows);
    await recordContribution(tx, ctx.workspace.id, ctx.actor.id, "verification", revision, [...scopes.values()]);
    return {
      result: { batchId, count: rows.length, verificationIds: rows.map((r) => r.id) },
      events: [
        {
          action: "batch_verified",
          entityType: "batch",
          entityId: batchId,
          summary: `${ctx.actor.name} verified ${rows.length} item(s) by ${p.method.replace(/_/g, " ")} (${p.conclusion}) in one batch.`,
          after: { subjectRefs: p.subjectRefs, method: p.method, conclusion: p.conclusion, evidenceRefs: p.evidenceRefs },
        },
      ],
    };
  },
});

const batchDisposition = z.object({
  subjectRefs: z.array(z.string().min(1)).min(1).max(200),
  disposition: z.enum(["used", "duplicate", "superseded", "not_applicable", "outside_scope", "manual_review", "reviewed_no_use"]),
  note: z.string().max(2000).optional(),
});

registerHandler({
  type: "batch_disposition",
  schema: batchDisposition,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "add_verification", "record dispositions");
    const batchId = newId("bat");
    for (const subjectRef of p.subjectRefs) {
      const parsed = parseRef(subjectRef);
      if (parsed.kind !== "document" && parsed.kind !== "document_page" && !subjectRef.startsWith("area:")) {
        throw new CommandError("validation", `${subjectRef} is not a document, page or area.`);
      }
    }
    await assertEvidence(hc, p.subjectRefs.filter((r) => !r.startsWith("area:")));
    const rows = p.subjectRefs.map((subjectRef) => {
      return {
        id: newId("dsp"),
        workspaceId: ctx.workspace.id,
        subjectRef,
        disposition: p.disposition,
        note: p.note ?? null,
        actorId: ctx.actor.id,
        createdRevision: revision,
        batchId,
      };
    });
    await tx.insert(t.dispositions).values(rows);
    return {
      result: { batchId, count: rows.length },
      events: [
        {
          action: "batch_dispositioned",
          entityType: "batch",
          entityId: batchId,
          summary: `${ctx.actor.name} marked ${rows.length} item(s) as ${p.disposition.replace(/_/g, " ")} in one batch.`,
          after: { subjectRefs: p.subjectRefs, disposition: p.disposition },
        },
      ],
    };
  },
});

const undoBatch = z.object({ batchId: z.string().min(1), reason: z.string().max(1000).optional() });

/**
 * Undo a batch. It refuses when a colleague has since acted on any of the
 * same subjects, so an undo never removes later work by someone else.
 */
registerHandler({
  type: "undo_batch",
  schema: undoBatch,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    const vers = await tx
      .select()
      .from(t.verifications)
      .where(and(eq(t.verifications.workspaceId, ctx.workspace.id), eq(t.verifications.batchId, p.batchId), isNull(t.verifications.withdrawnRevision)));
    const disps = await tx
      .select()
      .from(t.dispositions)
      .where(and(eq(t.dispositions.workspaceId, ctx.workspace.id), eq(t.dispositions.batchId, p.batchId), isNull(t.dispositions.withdrawnRevision)));
    if (vers.length === 0 && disps.length === 0) throw new CommandError("not_found", "Nothing from that batch is still in force.");
    const author = vers[0]?.actorId ?? disps[0]?.actorId;
    if (author !== ctx.actor.id) requirePermission(ctx.actor, "undo_adjustment", "undo another person's batch");
    const batchRevision = vers[0]?.createdRevision ?? disps[0]?.createdRevision ?? 0;
    const conflicts: string[] = [];
    for (const v of vers) {
      const later = await tx
        .select({ id: t.verifications.id, actorId: t.verifications.actorId })
        .from(t.verifications)
        .where(and(eq(t.verifications.workspaceId, ctx.workspace.id), eq(t.verifications.subjectRef, v.subjectRef), gt(t.verifications.createdRevision, batchRevision), isNull(t.verifications.withdrawnRevision)));
      for (const l of later) if (l.actorId !== ctx.actor.id) conflicts.push(`${v.subjectRef} (later verified by ${l.actorId})`);
    }
    for (const d of disps) {
      const later = await tx
        .select({ id: t.dispositions.id, actorId: t.dispositions.actorId })
        .from(t.dispositions)
        .where(and(eq(t.dispositions.workspaceId, ctx.workspace.id), eq(t.dispositions.subjectRef, d.subjectRef), gt(t.dispositions.createdRevision, batchRevision), isNull(t.dispositions.withdrawnRevision)));
      for (const l of later) if (l.actorId !== ctx.actor.id) conflicts.push(`${d.subjectRef} (later dispositioned by ${l.actorId})`);
    }
    if (conflicts.length) throw new CommandError("invalid_state", `Cannot undo: a colleague has since worked on ${conflicts.slice(0, 5).join("; ")}${conflicts.length > 5 ? " and more" : ""}.`);
    for (const v of vers) await tx.update(t.verifications).set({ withdrawnRevision: revision, withdrawnBy: ctx.actor.id }).where(eq(t.verifications.id, v.id));
    for (const d of disps) await tx.update(t.dispositions).set({ withdrawnRevision: revision, withdrawnBy: ctx.actor.id }).where(eq(t.dispositions.id, d.id));
    const events: AuditSeed[] = [
      {
        action: "batch_undone",
        entityType: "batch",
        entityId: p.batchId,
        summary: `${ctx.actor.name} undid batch ${p.batchId}: ${vers.length} verification(s) and ${disps.length} disposition(s) withdrawn${p.reason ? `: ${p.reason}` : "."}`,
        after: { verificationIds: vers.map((v) => v.id), dispositionIds: disps.map((d) => d.id) },
      },
    ];
    return { result: { withdrawn: vers.length + disps.length }, events };
  },
});
