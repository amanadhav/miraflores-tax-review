import { eq } from "drizzle-orm";
import { z } from "zod";
import * as t from "@/db/schema";
import { requirePermission } from "@/domain/policy";
import { CommandError, registerHandler } from "../commands";

const schema = z.object({ to: z.string().datetime({ offset: true }) });

const EARLIEST = "2026-01-01T00:00:00Z";
const LATEST = "2028-12-31T23:59:59Z";

/**
 * Move the replay clock. Evidence, messages, staff availability and agency
 * snapshots are filtered by this time; the engine version is chosen separately.
 * Moving the clock never satisfies a review step by itself.
 */
registerHandler({
  type: "advance_time",
  schema,
  allowedWhenLocked: true,
  async handle(hc, p) {
    const { tx, ctx } = hc;
    requirePermission(ctx.actor, "advance_time", "move the replay clock");
    const to = new Date(p.to).toISOString();
    if (to < EARLIEST || to > LATEST) throw new CommandError("validation", `Replay time must be between ${EARLIEST.slice(0, 10)} and ${LATEST.slice(0, 10)}.`);
    const from = ctx.workspace.asOf;
    await tx.update(t.workspaces).set({ asOf: to }).where(eq(t.workspaces.id, ctx.workspace.id));
    return {
      result: { asOf: to },
      events: [
        {
          action: "clock_moved",
          entityType: "workspace",
          entityId: ctx.workspace.id,
          summary: `${ctx.actor.name} moved the replay clock from ${new Date(from).toISOString().slice(0, 10)} to ${to.slice(0, 10)}.`,
          before: { asOf: from },
          after: { asOf: to },
        },
      ],
    };
  },
});
