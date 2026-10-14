import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as t from "@/db/schema";
import { areaForLine, areaLabel } from "@/domain/areas";
import { EFFECT_CATEGORIES, estimateEffect, round2 } from "@/domain/effects";
import { numeric } from "@/domain/formulas";
import { requireIndependent, requirePermission, requiresPartner, PolicyError } from "@/domain/policy";
import { checkAvailability } from "@/packet/availability";
import { indexPacket } from "@/packet/load";
import { parseRef, resolveRef } from "@/packet/refs";
import { CommandError, registerHandler, type HandlerContext } from "../commands";
import { newId } from "../ids";
import { loadEffective, recordContribution, scopePreparers } from "../state";

const SCHC_EXPENSE = /^SchC\.(8|9|1\d|2\d[a-z]?(\.\d+)?|30)$/;

/** Reject evidence that does not resolve or is not yet available at the replay clock. */
export function assertEvidence(hc: HandlerContext, refs: string[]): void {
  const packet = hc.ctx.packet.packet;
  const unresolved = refs.filter((r) => {
    const parsed = parseRef(r);
    if (parsed.kind === "workpaper") return false;
    return !resolveRef(packet, r, { version: hc.ctx.workspace.activeVersion }).found;
  });
  if (unresolved.length) throw new CommandError("validation", `These references do not resolve: ${unresolved.join(", ")}.`);
  const unavailable = checkAvailability(packet, refs, hc.businessTime).filter((c) => !c.available);
  if (unavailable.length) {
    throw new CommandError(
      "validation",
      `Not yet available at ${hc.businessTime.slice(0, 10)}: ${unavailable.map((u) => `${u.ref} (arrives ${u.availableAt?.slice(0, 10)})`).join(", ")}. Advance the replay clock to use it.`,
    );
  }
}

const proposeSchema = z.object({
  targetRef: z.string().min(1),
  kind: z.enum(["value", "label", "evidence"]),
  proposedValue: z.union([z.number(), z.string(), z.boolean(), z.null()]).optional(),
  proposedLabel: z.string().max(400).optional(),
  reason: z.string().min(3).max(2000),
  evidenceRefs: z.array(z.string().min(1)).min(1).max(40),
  category: z.enum(EFFECT_CATEGORIES).default("none"),
  measureDelta: z.number().optional(),
  caSource: z.boolean().default(false),
});

registerHandler({
  type: "propose_adjustment",
  schema: proposeSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "propose_adjustment", "propose adjustments");
    const idx = indexPacket(ctx.packet.packet);
    const version = idx.versions.get(ctx.workspace.activeVersion)!;
    const line = idx.linesByVersion.get(version.version)!.get(p.targetRef);
    if (!line) throw new CommandError("not_found", `${p.targetRef} is not a line in ${version.version}.`);
    assertEvidence(hc, p.evidenceRefs);

    const effective = await loadEffective(tx, ctx);
    const current = effective.lines.get(p.targetRef)!;
    const priorValue = current.effective;
    let proposedValue: unknown = priorValue;
    let measureDelta = 0;
    let basisNote = "";
    if (p.kind === "value") {
      if (p.proposedValue === undefined) throw new CommandError("validation", "A value change needs a proposed value.");
      proposedValue = p.proposedValue;
      const before = numeric(priorValue);
      const after = numeric(proposedValue);
      if (p.measureDelta !== undefined) {
        measureDelta = p.measureDelta;
        basisNote = "Measure change supplied by the preparer.";
      } else if (before !== null && after !== null) {
        const lineDelta = round2(after - before);
        if (p.category === "schc_profit" && SCHC_EXPENSE.test(p.targetRef)) {
          measureDelta = -lineDelta;
          basisNote = "Expense line: reducing the expense increases profit, so the profit change is the opposite of the line change.";
        } else {
          measureDelta = lineDelta;
          basisNote = "Measure change equals the line change.";
        }
      }
    } else if (p.kind === "label") {
      if (!p.proposedLabel) throw new CommandError("validation", "A label change needs the corrected text.");
    }

    const effect = estimateEffect({
      category: p.kind === "value" ? p.category : "none",
      measureDelta,
      caSource: p.caSource,
      jurisdiction: line.jurisdiction,
      version,
    });
    const unknown = effect.status === "unknown";
    const needsPartner = requiresPartner(
      Math.max(Math.abs(effect.federal ?? 0), Math.abs(effect.balanceFederal ?? 0)),
      Math.max(Math.abs(effect.california ?? 0), Math.abs(effect.balanceCalifornia ?? 0)),
      unknown,
    );
    const area = areaForLine(line.key, line.form);
    const id = newId("adj");
    await tx.insert(t.adjustments).values({
      id,
      workspaceId: ctx.workspace.id,
      targetRef: p.targetRef,
      baselineVersion: version.version,
      area,
      kind: p.kind,
      priorValue: priorValue as never,
      proposedValue: proposedValue as never,
      priorLabel: p.kind === "label" ? line.label : null,
      proposedLabel: p.kind === "label" ? p.proposedLabel : null,
      reason: p.reason,
      evidenceRefs: p.evidenceRefs,
      category: p.kind === "value" ? p.category : "none",
      measureDelta: String(measureDelta),
      caSource: p.caSource,
      effectFederal: effect.federal === null ? null : String(effect.federal),
      effectCalifornia: effect.california === null ? null : String(effect.california),
      balanceFederal: effect.balanceFederal === null ? null : String(effect.balanceFederal),
      balanceCalifornia: effect.balanceCalifornia === null ? null : String(effect.balanceCalifornia),
      effectStatus: effect.status,
      effectBasis: [effect.basis, basisNote].filter(Boolean).join(" "),
      limitations: effect.limitations,
      requiresPartner: needsPartner,
      status: "proposed",
      authorId: ctx.actor.id,
      createdRevision: revision,
    });
    await recordContribution(tx, ctx.workspace.id, ctx.actor.id, "adjustment", revision, [
      { scopeType: "line", scopeId: p.targetRef },
      { scopeType: "area", scopeId: area },
    ]);
    await tx.insert(t.referenceEdges).values([
      ...p.evidenceRefs.map((ref) => ({
        packetId: ctx.workspace.packetId,
        workspaceId: ctx.workspace.id,
        version: version.version,
        fromRef: ref,
        toRef: `adjustment:${id}`,
        relation: "supports",
        origin: "workpaper",
      })),
      {
        packetId: ctx.workspace.packetId,
        workspaceId: ctx.workspace.id,
        version: version.version,
        fromRef: `adjustment:${id}`,
        toRef: p.targetRef,
        relation: "adjusts",
        origin: "workpaper",
      },
    ]);
    const describe =
      p.kind === "value"
        ? `${line.key} ${fmt(priorValue)} to ${fmt(proposedValue)}`
        : p.kind === "label"
          ? `${line.key} label to "${p.proposedLabel}"`
          : `${line.key} evidence links`;
    return {
      result: { adjustmentId: id, effect, requiresPartner: needsPartner },
      events: [
        {
          action: "adjustment_proposed",
          entityType: "adjustment",
          entityId: id,
          summary: `${ctx.actor.name} proposed ${describe} (${areaLabel(area)}): ${p.reason}`,
          after: { targetRef: p.targetRef, kind: p.kind, proposedValue, proposedLabel: p.proposedLabel, effect, requiresPartner: needsPartner },
          area,
        },
      ],
    };
  },
});

const decideSchema = z.object({
  adjustmentId: z.string().min(1),
  decision: z.enum(["accept", "reject"]),
  note: z.string().max(2000).optional(),
});

registerHandler({
  type: "decide_adjustment",
  schema: decideSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    const [adj] = await tx.select().from(t.adjustments).where(and(eq(t.adjustments.id, p.adjustmentId), eq(t.adjustments.workspaceId, ctx.workspace.id)));
    if (!adj) throw new CommandError("not_found", "Adjustment not found.");
    if (adj.status !== "proposed") throw new CommandError("invalid_state", `Adjustment is already ${adj.status}.`);
    requirePermission(ctx.actor, "decide_adjustment", "accept or reject adjustments");
    if (adj.requiresPartner && p.decision === "accept" && !ctx.actor.role.includes("partner")) {
      throw new PolicyError("partner_required", "This adjustment's estimated effect is over the 1,000 threshold (or unknown), so a partner must accept it.");
    }
    const preparers = await scopePreparers(tx, ctx.workspace.id, "line", adj.targetRef);
    preparers.add(adj.authorId);
    requireIndependent(ctx.actor, preparers, `${adj.targetRef}`);
    if (adj.baselineVersion !== ctx.workspace.activeVersion) {
      throw new CommandError("invalid_state", `Proposed against ${adj.baselineVersion}; the workspace is on ${ctx.workspace.activeVersion}. Rebase the proposal first.`);
    }

    const events = [];
    if (p.decision === "accept") {
      // A replacement supersedes the previously accepted change on the same line.
      const [previous] = await tx
        .select()
        .from(t.adjustments)
        .where(and(eq(t.adjustments.workspaceId, ctx.workspace.id), eq(t.adjustments.targetRef, adj.targetRef), eq(t.adjustments.status, "accepted"), eq(t.adjustments.kind, adj.kind)));
      if (previous) {
        await tx.update(t.adjustments).set({ status: "superseded" }).where(eq(t.adjustments.id, previous.id));
        await tx.update(t.adjustments).set({ supersedesId: previous.id }).where(eq(t.adjustments.id, adj.id));
        events.push({
          action: "adjustment_superseded",
          entityType: "adjustment",
          entityId: previous.id,
          summary: `Earlier accepted change on ${adj.targetRef} superseded by ${adj.id}.`,
          area: adj.area,
        });
      }
    }
    await tx
      .update(t.adjustments)
      .set({ status: p.decision === "accept" ? "accepted" : "rejected", decidedBy: ctx.actor.id, decidedAt: hc.now, decidedRevision: revision, decisionNote: p.note ?? null })
      .where(eq(t.adjustments.id, adj.id));
    events.push({
      action: p.decision === "accept" ? "adjustment_accepted" : "adjustment_rejected",
      entityType: "adjustment",
      entityId: adj.id,
      summary: `${ctx.actor.name} ${p.decision === "accept" ? "accepted" : "rejected"} the change to ${adj.targetRef}${adj.kind === "value" ? ` (${fmt(adj.priorValue)} to ${fmt(adj.proposedValue)})` : ""}${p.note ? `: ${p.note}` : "."}`,
      before: { status: "proposed" },
      after: { status: p.decision === "accept" ? "accepted" : "rejected", effectFederal: adj.effectFederal, effectCalifornia: adj.effectCalifornia },
      area: adj.area,
    });
    return { result: { adjustmentId: adj.id, status: p.decision === "accept" ? "accepted" : "rejected" }, events };
  },
});

const undoSchema = z.object({ adjustmentId: z.string().min(1), reason: z.string().max(1000).optional() });

registerHandler({
  type: "undo_adjustment",
  schema: undoSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "undo_adjustment", "undo accepted adjustments");
    const [adj] = await tx.select().from(t.adjustments).where(and(eq(t.adjustments.id, p.adjustmentId), eq(t.adjustments.workspaceId, ctx.workspace.id)));
    if (!adj) throw new CommandError("not_found", "Adjustment not found.");
    if (adj.status !== "accepted") throw new CommandError("invalid_state", `Only accepted changes can be undone; this one is ${adj.status}.`);
    // Never remove a colleague's later work on the same line.
    const later = await tx
      .select({ id: t.adjustments.id, decidedBy: t.adjustments.decidedBy })
      .from(t.adjustments)
      .where(and(eq(t.adjustments.workspaceId, ctx.workspace.id), eq(t.adjustments.targetRef, adj.targetRef), eq(t.adjustments.status, "proposed")));
    if (later.length) throw new CommandError("invalid_state", `A newer proposal on ${adj.targetRef} is pending; decide it before undoing.`);
    const id = newId("adj");
    await tx.insert(t.adjustments).values({
      id,
      workspaceId: ctx.workspace.id,
      targetRef: adj.targetRef,
      baselineVersion: adj.baselineVersion,
      area: adj.area,
      kind: adj.kind,
      priorValue: adj.proposedValue as never,
      proposedValue: adj.priorValue as never,
      priorLabel: adj.proposedLabel,
      proposedLabel: adj.priorLabel,
      reason: `Undo of ${adj.id}${p.reason ? `: ${p.reason}` : ""}`,
      evidenceRefs: adj.evidenceRefs,
      category: adj.category,
      measureDelta: adj.measureDelta === null ? null : String(-Number(adj.measureDelta)),
      caSource: adj.caSource,
      effectFederal: neg(adj.effectFederal),
      effectCalifornia: neg(adj.effectCalifornia),
      balanceFederal: neg(adj.balanceFederal),
      balanceCalifornia: neg(adj.balanceCalifornia),
      effectStatus: adj.effectStatus,
      effectBasis: `Compensating entry reversing ${adj.id}.`,
      limitations: adj.limitations,
      requiresPartner: false,
      status: "accepted",
      authorId: ctx.actor.id,
      createdRevision: revision,
      decidedBy: ctx.actor.id,
      decidedAt: hc.now,
      decidedRevision: revision,
      revertsId: adj.id,
    });
    await tx.update(t.adjustments).set({ status: "reverted" }).where(eq(t.adjustments.id, adj.id));
    return {
      result: { adjustmentId: id, reverted: adj.id },
      events: [
        {
          action: "adjustment_undone",
          entityType: "adjustment",
          entityId: adj.id,
          summary: `${ctx.actor.name} undid the change to ${adj.targetRef} with compensating entry ${id}; the line is back to ${fmt(adj.priorValue)}.`,
          before: { status: "accepted" },
          after: { status: "reverted", compensatingId: id },
          area: adj.area,
        },
      ],
    };
  },
});

function neg(v: string | null): string | null {
  return v === null ? null : String(round2(-Number(v)));
}

export function fmt(v: unknown): string {
  if (typeof v === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v === null || v === undefined) return "blank";
  return String(v);
}
