import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as t from "@/db/schema";
import { AREAS, areaForLine, areaLabel } from "@/domain/areas";
import { requireIndependent, requirePermission, signOffPermission } from "@/domain/policy";
import { indexPacket } from "@/packet/load";
import { CommandError, registerHandler } from "../commands";
import { newId } from "../ids";
import { computeFingerprint } from "../invalidation";
import { loadWorkspaceState, scopePreparers } from "../state";
import { currentStandards } from "../standards";

const signSchema = z.object({
  scopeType: z.enum(["area", "line", "return"]),
  scopeId: z.string().min(1),
  level: z.enum(["preparer", "reviewer", "partner"]),
  note: z.string().max(2000).optional(),
});

registerHandler({
  type: "sign_off",
  schema: signSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, signOffPermission(p.level), `sign off at ${p.level} level`);
    const idx = indexPacket(ctx.packet.packet);
    const lines = idx.linesByVersion.get(ctx.workspace.activeVersion)!;
    let area: string;
    if (p.scopeType === "return") {
      if (p.scopeId !== "*") throw new CommandError("validation", "A whole-return sign-off uses scope id *.");
      area = "partner_review";
    } else if (p.scopeType === "area") {
      if (!AREAS.some((a) => a.id === p.scopeId)) throw new CommandError("validation", `Unknown area ${p.scopeId}.`);
      area = p.scopeId;
    } else {
      const line = lines.get(p.scopeId);
      if (!line) throw new CommandError("not_found", `${p.scopeId} is not a line in ${ctx.workspace.activeVersion}.`);
      area = areaForLine(line.key, line.form);
    }
    // Preparer-level sign-off is the preparer attesting their own work; the
    // independence rule applies to reviewer and partner levels.
    if (p.level !== "preparer") {
      const preparers = await scopePreparers(tx, ctx.workspace.id, p.scopeType, p.scopeId);
      requireIndependent(ctx.actor, preparers, p.scopeType === "area" ? areaLabel(area) : p.scopeId);
    }
    const state = await loadWorkspaceState(tx, ctx);
    const std = await currentStandards(tx, ctx.workspace.id, ctx.packet.packet.firm.starter_standards);
    const fp = computeFingerprint(state, p.scopeType, p.scopeId, lines, std.id);
    // A fresh sign-off by the same person at the same level replaces the previous one; history stays.
    const existing = state.signoffs.filter(
      (s) => s.status === "active" && s.scopeType === p.scopeType && s.scopeId === p.scopeId && s.level === p.level && s.actorId === ctx.actor.id,
    );
    for (const s of existing) {
      await tx
        .update(t.signoffs)
        .set({ status: "withdrawn", invalidatedAt: hc.now, invalidatedRevision: revision, invalidationReason: "Replaced by a newer sign-off." })
        .where(eq(t.signoffs.id, s.id));
    }
    const id = newId("sig");
    await tx.insert(t.signoffs).values({
      id,
      workspaceId: ctx.workspace.id,
      scopeType: p.scopeType,
      scopeId: p.scopeId,
      level: p.level,
      actorId: ctx.actor.id,
      status: "active",
      fingerprint: fp.hash,
      fingerprintParts: fp.parts,
      revision,
      note: p.note ?? null,
    });
    const openBlockers = state.findings.filter(
      (f) => f.status === "open" && f.blocksFiling && (p.scopeType === "return" ? true : p.scopeType === "area" ? f.area === area : f.refs.includes(p.scopeId)),
    );
    return {
      result: { signoffId: id, fingerprint: fp.hash, openBlockers: openBlockers.map((f) => f.id) },
      events: [
        {
          action: "signoff_recorded",
          entityType: "signoff",
          entityId: id,
          summary: `${ctx.actor.name} signed off ${p.scopeType === "return" ? "the whole return" : p.scopeType === "area" ? areaLabel(area) : p.scopeId} at ${p.level} level${openBlockers.length ? ` with ${openBlockers.length} open blocking finding(s)` : ""}.`,
          after: { scopeType: p.scopeType, scopeId: p.scopeId, level: p.level, fingerprint: fp.hash },
          area,
        },
      ],
    };
  },
});

const withdrawSchema = z.object({ signoffId: z.string().min(1), reason: z.string().max(1000).optional() });

registerHandler({
  type: "withdraw_signoff",
  schema: withdrawSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    const [s] = await tx.select().from(t.signoffs).where(and(eq(t.signoffs.id, p.signoffId), eq(t.signoffs.workspaceId, ctx.workspace.id)));
    if (!s) throw new CommandError("not_found", "Sign-off not found.");
    if (s.status !== "active" && s.status !== "stale") throw new CommandError("invalid_state", `Sign-off is already ${s.status}.`);
    if (s.actorId !== ctx.actor.id) requirePermission(ctx.actor, "sign_off_partner", "withdraw another person's sign-off");
    await tx
      .update(t.signoffs)
      .set({ status: "withdrawn", invalidatedAt: hc.now, invalidatedRevision: revision, invalidationReason: p.reason ?? "Withdrawn." })
      .where(eq(t.signoffs.id, s.id));
    return {
      result: { signoffId: s.id },
      events: [
        {
          action: "signoff_withdrawn",
          entityType: "signoff",
          entityId: s.id,
          summary: `${ctx.actor.name} withdrew the ${s.level} sign-off on ${s.scopeType} ${s.scopeId}${p.reason ? `: ${p.reason}` : "."}`,
          before: { status: s.status },
          after: { status: "withdrawn" },
          area: s.scopeType === "area" ? s.scopeId : null,
        },
      ],
    };
  },
});
