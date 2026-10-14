import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as t from "@/db/schema";
import { AREAS, areaForLine } from "@/domain/areas";
import { requirePermission } from "@/domain/policy";
import { findActor } from "@/domain/policy";
import { indexPacket } from "@/packet/load";
import { parseRef } from "@/packet/refs";
import { CommandError, registerHandler } from "../commands";
import { newId } from "../ids";
import { assertEvidence } from "./adjustments";

const raiseSchema = z.object({
  title: z.string().min(3).max(200),
  detail: z.string().min(3).max(4000),
  severity: z.enum(["info", "warning", "blocker"]),
  refs: z.array(z.string().min(1)).max(40).default([]),
  area: z.string().optional(),
  blocksFiling: z.boolean().optional(),
  ownerId: z.string().optional(),
});

registerHandler({
  type: "raise_finding",
  schema: raiseSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "raise_finding", "raise findings");
    await assertEvidence(hc, p.refs);
    let area = p.area;
    if (!area) {
      const lines = indexPacket(ctx.packet.packet).linesByVersion.get(ctx.workspace.activeVersion)!;
      for (const r of p.refs) {
        const parsed = parseRef(r);
        if (parsed.kind === "line") {
          const line = lines.get(parsed.key);
          if (line) {
            area = areaForLine(line.key, line.form);
            break;
          }
        }
      }
    }
    area ??= "intake_and_engagement";
    if (!AREAS.some((a) => a.id === area)) throw new CommandError("validation", `Unknown area ${area}.`);
    if (p.ownerId && !findActor(ctx.packet.packet, p.ownerId)) throw new CommandError("validation", `Unknown owner ${p.ownerId}.`);
    const blocksFiling = p.blocksFiling ?? p.severity !== "info";
    const id = newId("fnd");
    await tx.insert(t.findings).values({
      id,
      workspaceId: ctx.workspace.id,
      origin: "reviewer",
      severity: p.severity,
      title: p.title,
      detail: p.detail,
      refs: p.refs,
      area,
      blocksFiling,
      status: "open",
      ownerId: p.ownerId ?? ctx.workspace.assignedPreparer,
      createdBy: ctx.actor.id,
      createdRevision: revision,
    });
    return {
      result: { findingId: id },
      events: [
        {
          action: "finding_raised",
          entityType: "finding",
          entityId: id,
          summary: `${ctx.actor.name} raised a ${p.severity}${blocksFiling ? " (blocks filing)" : ""}: ${p.title}`,
          after: { title: p.title, severity: p.severity, refs: p.refs, blocksFiling },
          area,
        },
      ],
    };
  },
});

const resolveSchema = z.object({
  findingId: z.string().min(1),
  outcome: z.enum(["resolved", "dismissed"]),
  resolution: z.string().min(3).max(4000),
  evidenceRefs: z.array(z.string().min(1)).max(40).default([]),
});

registerHandler({
  type: "resolve_finding",
  schema: resolveSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "resolve_finding", "resolve findings");
    const [f] = await tx.select().from(t.findings).where(and(eq(t.findings.id, p.findingId), eq(t.findings.workspaceId, ctx.workspace.id)));
    if (!f) throw new CommandError("not_found", "Finding not found.");
    if (f.status !== "open") throw new CommandError("invalid_state", `Finding is already ${f.status}.`);
    await assertEvidence(hc, p.evidenceRefs);
    const resolution = p.evidenceRefs.length ? `${p.resolution} [evidence: ${p.evidenceRefs.join(", ")}]` : p.resolution;
    await tx
      .update(t.findings)
      .set({ status: p.outcome, resolvedBy: ctx.actor.id, resolvedAt: hc.now, resolvedRevision: revision, resolution })
      .where(eq(t.findings.id, f.id));
    return {
      result: { findingId: f.id, status: p.outcome },
      events: [
        {
          action: p.outcome === "resolved" ? "finding_resolved" : "finding_dismissed",
          entityType: "finding",
          entityId: f.id,
          summary: `${ctx.actor.name} ${p.outcome} "${f.title}": ${p.resolution}`,
          before: { status: "open" },
          after: { status: p.outcome, evidenceRefs: p.evidenceRefs },
          area: f.area,
        },
      ],
    };
  },
});
