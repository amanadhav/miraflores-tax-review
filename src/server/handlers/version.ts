import { eq } from "drizzle-orm";
import { z } from "zod";
import * as t from "@/db/schema";
import { requirePermission } from "@/domain/policy";
import { indexPacket } from "@/packet/load";
import { CommandError, registerHandler } from "../commands";

const schema = z.object({ version: z.string().regex(/^v\d+$/, "Version must look like v1, v2 or v3.") });

/**
 * Choose which engine version is the workpaper's baseline. The engine version
 * and the replay clock are separate: selecting v1 does not move evidence time,
 * and moving the clock never changes the version. Adjustments are left exactly
 * as they are; any proposal made against a different version shows a
 * "needs rebase" flag in the ledger and cannot be decided until it is redone.
 */
registerHandler({
  type: "set_version",
  schema,
  async handle(hc, p) {
    const { tx, ctx } = hc;
    requirePermission(ctx.actor, "propose_adjustment", "select the engine baseline version");
    const packet = ctx.packet.packet;
    const target = indexPacket(packet).versions.get(p.version);
    if (!target) throw new CommandError("not_found", `${p.version} is not a return version in the packet.`);
    const from = ctx.workspace.activeVersion;
    if (from === p.version) throw new CommandError("invalid_state", `${p.version} is already the baseline.`);
    const previous = indexPacket(packet).versions.get(from);
    const asOf = new Date(ctx.workspace.asOf).toISOString();
    await tx.update(t.workspaces).set({ activeVersion: p.version }).where(eq(t.workspaces.id, ctx.workspace.id));
    // Sign-offs are re-fingerprinted after every command against the workspace
    // the handler leaves behind, so the context must already name the new version.
    hc.ctx.workspace = { ...hc.ctx.workspace, activeVersion: p.version };
    return {
      result: { activeVersion: p.version, previousVersion: from, asOf },
      events: [
        {
          action: "version_selected",
          entityType: "workspace",
          entityId: ctx.workspace.id,
          summary: `${ctx.actor.name} made ${p.version} (computed ${target.computed_at.slice(0, 10)}) the baseline instead of ${from}; the replay clock stays at ${asOf.slice(0, 10)} and no adjustment was touched.`,
          before: { activeVersion: from, computedAt: previous?.computed_at ?? null },
          after: { activeVersion: p.version, computedAt: target.computed_at, trigger: target.trigger },
        },
      ],
    };
  },
});
