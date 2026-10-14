import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as t from "@/db/schema";
import { AREAS } from "@/domain/areas";
import { findActor, requirePermission } from "@/domain/policy";
import { CommandError, registerHandler } from "../commands";
import { newId } from "../ids";
import { notify } from "../notify";
import { assertEvidence } from "./adjustments";
import { subjectArea } from "./common";

const createSchema = z.object({
  kind: z.enum(["client_question", "colleague_question", "document_request"]),
  title: z.string().min(3).max(200),
  body: z.string().min(3).max(4000),
  toActorId: z.string().min(1),
  dueAt: z.string().datetime({ offset: true }).optional(),
  refs: z.array(z.string().min(1)).max(40).default([]),
  area: z.string().optional(),
});

/** A question to the client or a colleague. The answer becomes evidence. */
registerHandler({
  type: "create_request",
  schema: createSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "raise_finding", "send requests");
    const to = findActor(ctx.packet.packet, p.toActorId);
    if (!to) throw new CommandError("validation", `Unknown recipient ${p.toActorId}.`);
    if (p.kind === "client_question" || p.kind === "document_request") {
      if (to.role !== "client") throw new CommandError("validation", "Client questions and document requests go to a client user.");
    } else if (to.role === "client") {
      throw new CommandError("validation", "Colleague questions go to firm staff.");
    }
    await assertEvidence(hc, p.refs);
    let area = p.area;
    if (!area) {
      for (const r of p.refs) {
        try {
          area = subjectArea(hc, r);
          break;
        } catch {
          /* try the next ref */
        }
      }
    }
    area ??= "intake_and_engagement";
    if (!AREAS.some((a) => a.id === area)) throw new CommandError("validation", `Unknown area ${area}.`);
    const id = newId("req");
    await tx.insert(t.requests).values({
      id,
      workspaceId: ctx.workspace.id,
      kind: p.kind,
      title: p.title,
      body: p.body,
      fromActorId: ctx.actor.id,
      toActorId: p.toActorId,
      dueAt: p.dueAt ?? null,
      status: "open",
      refs: p.refs,
      area,
      createdRevision: revision,
      businessTime: hc.businessTime,
    });
    await notify(tx, ctx.workspace.id, revision, [
      { recipientId: p.toActorId, kind: "request", title: `Question from ${ctx.actor.name}: ${p.title}`, body: p.body, refs: [`request:${id}`] },
    ]);
    return {
      result: { requestId: id },
      events: [
        {
          action: "request_created",
          entityType: "request",
          entityId: id,
          summary: `${ctx.actor.name} asked ${to.name}: ${p.title}${p.dueAt ? ` (due ${p.dueAt.slice(0, 10)})` : ""}.`,
          after: { kind: p.kind, toActorId: p.toActorId, refs: p.refs, dueAt: p.dueAt ?? null },
          area,
        },
      ],
    };
  },
});

const replySchema = z.object({
  requestId: z.string().min(1),
  body: z.string().min(1).max(8000),
  attachmentIds: z.array(z.string().min(1)).max(10).default([]),
});

/** Anyone the request involves can reply; a client can only reply to requests addressed to them. */
registerHandler({
  type: "reply_request",
  schema: replySchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    const [req] = await tx.select().from(t.requests).where(and(eq(t.requests.id, p.requestId), eq(t.requests.workspaceId, ctx.workspace.id)));
    if (!req) throw new CommandError("not_found", "Request not found.");
    if (req.status === "resolved" || req.status === "withdrawn") throw new CommandError("invalid_state", `Request is ${req.status}.`);
    if (ctx.actor.role === "client" && req.toActorId !== ctx.actor.id) {
      throw new CommandError("validation", "This request is not addressed to you.");
    }
    for (const attId of p.attachmentIds) {
      const [att] = await tx.select({ id: t.attachments.id }).from(t.attachments).where(and(eq(t.attachments.id, attId), eq(t.attachments.workspaceId, ctx.workspace.id)));
      if (!att) throw new CommandError("not_found", `Attachment ${attId} not found.`);
    }
    const id = newId("rpl");
    await tx.insert(t.requestReplies).values({
      id,
      workspaceId: ctx.workspace.id,
      requestId: req.id,
      authorId: ctx.actor.id,
      body: p.body,
      attachmentIds: p.attachmentIds,
      businessTime: hc.businessTime,
      createdRevision: revision,
    });
    if (p.attachmentIds.length) {
      for (const attId of p.attachmentIds) {
        await tx.update(t.attachments).set({ requestId: req.id }).where(eq(t.attachments.id, attId));
      }
    }
    await tx.update(t.requests).set({ status: "answered" }).where(eq(t.requests.id, req.id));
    await notify(tx, ctx.workspace.id, revision, [
      { recipientId: req.fromActorId, kind: "reply", title: `${ctx.actor.name} replied: ${req.title}`, body: p.body.slice(0, 500), refs: [`request:${req.id}`, `reply:${id}`] },
    ]);
    return {
      result: { replyId: id, evidenceRef: `reply:${id}` },
      events: [
        {
          action: "request_answered",
          entityType: "request",
          entityId: req.id,
          summary: `${ctx.actor.name} answered "${req.title}"${p.attachmentIds.length ? ` with ${p.attachmentIds.length} attachment(s)` : ""}: ${p.body.slice(0, 160)}`,
          after: { replyId: id, attachmentIds: p.attachmentIds },
          area: req.area,
        },
      ],
    };
  },
});

const resolveSchema = z.object({
  requestId: z.string().min(1),
  resolution: z.string().min(2).max(4000),
  outcome: z.enum(["resolved", "withdrawn"]).default("resolved"),
});

registerHandler({
  type: "resolve_request",
  schema: resolveSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "raise_finding", "resolve requests");
    const [req] = await tx.select().from(t.requests).where(and(eq(t.requests.id, p.requestId), eq(t.requests.workspaceId, ctx.workspace.id)));
    if (!req) throw new CommandError("not_found", "Request not found.");
    if (req.status === "resolved" || req.status === "withdrawn") throw new CommandError("invalid_state", `Request is already ${req.status}.`);
    await tx
      .update(t.requests)
      .set({ status: p.outcome, resolvedBy: ctx.actor.id, resolvedRevision: revision, resolution: p.resolution })
      .where(eq(t.requests.id, req.id));
    return {
      result: { requestId: req.id, status: p.outcome },
      events: [
        {
          action: p.outcome === "resolved" ? "request_resolved" : "request_withdrawn",
          entityType: "request",
          entityId: req.id,
          summary: `${ctx.actor.name} ${p.outcome} "${req.title}": ${p.resolution}`,
          before: { status: req.status },
          after: { status: p.outcome },
          area: req.area,
        },
      ],
    };
  },
});

const attachmentSchema = z.object({
  kind: z.enum(["file", "note", "message"]),
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  content: z.string().min(1).max(1_000_000),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
  requestId: z.string().optional(),
  linkedRefs: z.array(z.string().min(1)).max(40).default([]),
});

/** Attach a file, note or message as evidence; provenance and received time are kept. */
registerHandler({
  type: "add_attachment",
  schema: attachmentSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    if (ctx.actor.role !== "client") requirePermission(ctx.actor, "add_verification", "attach evidence");
    if (p.requestId) {
      const [req] = await tx.select().from(t.requests).where(and(eq(t.requests.id, p.requestId), eq(t.requests.workspaceId, ctx.workspace.id)));
      if (!req) throw new CommandError("not_found", "Request not found.");
      if (ctx.actor.role === "client" && req.toActorId !== ctx.actor.id) throw new CommandError("validation", "This request is not addressed to you.");
    }
    if (ctx.actor.role !== "client") await assertEvidence(hc, p.linkedRefs);
    const bytes = p.encoding === "base64" ? Buffer.from(p.content, "base64") : Buffer.from(p.content, "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const id = newId("att");
    await tx.insert(t.attachments).values({
      id,
      workspaceId: ctx.workspace.id,
      kind: p.kind,
      filename: p.filename,
      contentType: p.contentType,
      byteLength: bytes.length,
      sha256,
      content: p.content,
      encoding: p.encoding,
      provenance: ctx.actor.role === "client" ? "client_upload" : "staff_upload",
      uploadedBy: ctx.actor.id,
      requestId: p.requestId ?? null,
      linkedRefs: ctx.actor.role === "client" ? [] : p.linkedRefs,
      businessTime: hc.businessTime,
      createdRevision: revision,
    });
    if (p.linkedRefs.length && ctx.actor.role !== "client") {
      await tx.insert(t.referenceEdges).values(
        p.linkedRefs.map((ref) => ({
          packetId: ctx.workspace.packetId,
          workspaceId: ctx.workspace.id,
          version: ctx.workspace.activeVersion,
          fromRef: `attachment:${id}`,
          toRef: ref,
          relation: "supports",
          origin: "workpaper",
        })),
      );
    }
    return {
      result: { attachmentId: id, sha256, evidenceRef: `attachment:${id}` },
      events: [
        {
          action: "attachment_added",
          entityType: "attachment",
          entityId: id,
          summary: `${ctx.actor.name} attached ${p.kind} "${p.filename}" (${bytes.length} bytes, sha256 ${sha256.slice(0, 12)})${p.linkedRefs.length ? ` linked to ${p.linkedRefs.join(", ")}` : ""}.`,
          after: { filename: p.filename, contentType: p.contentType, byteLength: bytes.length, sha256, linkedRefs: p.linkedRefs },
        },
      ],
    };
  },
});
