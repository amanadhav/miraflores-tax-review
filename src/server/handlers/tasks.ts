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

const createTask = z.object({
  kind: z.enum(["review", "outside_filing", "follow_up", "planning"]),
  title: z.string().min(3).max(200),
  detail: z.string().min(1).max(4000),
  ownerId: z.string().min(1),
  dueAt: z.string().datetime({ offset: true }).optional(),
  refs: z.array(z.string().min(1)).max(40).default([]),
  area: z.string().optional(),
});

registerHandler({
  type: "create_task",
  schema: createTask,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "raise_finding", "assign tasks");
    const owner = findActor(ctx.packet.packet, p.ownerId);
    if (!owner || owner.role === "client") throw new CommandError("validation", "Tasks are assigned to firm staff.");
    await assertEvidence(hc, p.refs);
    let area = p.area;
    if (!area) {
      for (const r of p.refs) {
        try {
          area = subjectArea(hc, r);
          break;
        } catch {
          /* next */
        }
      }
    }
    area ??= "intake_and_engagement";
    if (!AREAS.some((a) => a.id === area)) throw new CommandError("validation", `Unknown area ${area}.`);
    const id = newId("tsk");
    await tx.insert(t.tasks).values({
      id,
      workspaceId: ctx.workspace.id,
      kind: p.kind,
      title: p.title,
      detail: p.detail,
      ownerId: p.ownerId,
      dueAt: p.dueAt ?? null,
      status: "open",
      refs: p.refs,
      area,
      createdBy: ctx.actor.id,
      createdRevision: revision,
    });
    await notify(tx, ctx.workspace.id, revision, [
      { recipientId: p.ownerId, kind: "assignment", title: `Assigned: ${p.title}`, body: `${ctx.actor.name} assigned you a ${p.kind.replace(/_/g, " ")} task${p.dueAt ? ` due ${p.dueAt.slice(0, 10)}` : ""}.`, refs: [`task:${id}`] },
    ]);
    return {
      result: { taskId: id },
      events: [
        {
          action: "task_created",
          entityType: "task",
          entityId: id,
          summary: `${ctx.actor.name} assigned ${owner.name}: ${p.title}${p.dueAt ? ` (due ${p.dueAt.slice(0, 10)})` : ""}.`,
          after: { kind: p.kind, ownerId: p.ownerId, dueAt: p.dueAt ?? null, refs: p.refs },
          area,
        },
      ],
    };
  },
});

const completeTask = z.object({
  taskId: z.string().min(1),
  outcome: z.enum(["done", "cancelled"]).default("done"),
  note: z.string().min(1).max(4000),
  evidenceRefs: z.array(z.string().min(1)).max(40).default([]),
});

/** Completion needs a note and, for outside filings, evidence; a note alone does not file anything. */
registerHandler({
  type: "complete_task",
  schema: completeTask,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    const [task] = await tx.select().from(t.tasks).where(and(eq(t.tasks.id, p.taskId), eq(t.tasks.workspaceId, ctx.workspace.id)));
    if (!task) throw new CommandError("not_found", "Task not found.");
    if (task.status !== "open") throw new CommandError("invalid_state", `Task is already ${task.status}.`);
    if (task.ownerId !== ctx.actor.id) requirePermission(ctx.actor, "manage_assignments", "complete another person's task");
    await assertEvidence(hc, p.evidenceRefs);
    if (task.kind === "outside_filing" && p.outcome === "done" && p.evidenceRefs.length === 0) {
      throw new CommandError("validation", "An outside filing is marked done only with evidence of the filing or the client's acknowledgment (attach it and cite the attachment).");
    }
    await tx
      .update(t.tasks)
      .set({ status: p.outcome, completedBy: ctx.actor.id, completedRevision: revision, completionNote: p.note, completionRefs: p.evidenceRefs })
      .where(eq(t.tasks.id, task.id));
    if (task.createdBy !== ctx.actor.id) {
      await notify(tx, ctx.workspace.id, revision, [
        { recipientId: task.createdBy, kind: "task_update", title: `${p.outcome === "done" ? "Done" : "Cancelled"}: ${task.title}`, body: p.note.slice(0, 500), refs: [`task:${task.id}`] },
      ]);
    }
    return {
      result: { taskId: task.id, status: p.outcome },
      events: [
        {
          action: p.outcome === "done" ? "task_completed" : "task_cancelled",
          entityType: "task",
          entityId: task.id,
          summary: `${ctx.actor.name} marked "${task.title}" ${p.outcome}: ${p.note}`,
          before: { status: "open" },
          after: { status: p.outcome, evidenceRefs: p.evidenceRefs },
          area: task.area,
        },
      ],
    };
  },
});

const logTime = z.object({
  area: z.string().min(1),
  hours: z.number().positive().max(24),
  note: z.string().max(500).optional(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

registerHandler({
  type: "log_time",
  schema: logTime,
  allowedWhenLocked: true,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    if (ctx.actor.role === "client") throw new CommandError("validation", "Clients do not log time.");
    if (!AREAS.some((a) => a.id === p.area)) throw new CommandError("validation", `Unknown area ${p.area}.`);
    const id = newId("tme");
    await tx.insert(t.timeEntries).values({
      id,
      workspaceId: ctx.workspace.id,
      actorId: ctx.actor.id,
      area: p.area,
      hours: String(p.hours),
      note: p.note ?? null,
      workDate: p.workDate,
      createdRevision: revision,
    });
    return {
      result: { timeEntryId: id },
      events: [
        {
          action: "time_logged",
          entityType: "time_entry",
          entityId: id,
          summary: `${ctx.actor.name} logged ${p.hours} h on ${p.area.replace(/_/g, " ")} for ${p.workDate}${p.note ? `: ${p.note}` : "."}`,
          after: { area: p.area, hours: p.hours, workDate: p.workDate },
          area: p.area,
        },
      ],
    };
  },
});

const markRead = z.object({ notificationIds: z.array(z.string().min(1)).min(1).max(200) });

registerHandler({
  type: "mark_notifications_read",
  schema: markRead,
  allowedWhenLocked: true,
  async handle(hc, p) {
    const { tx, ctx } = hc;
    for (const id of p.notificationIds) {
      await tx
        .update(t.notifications)
        .set({ readAt: hc.now })
        .where(and(eq(t.notifications.id, id), eq(t.notifications.workspaceId, ctx.workspace.id), eq(t.notifications.recipientId, ctx.actor.id)));
    }
    return { result: { count: p.notificationIds.length }, events: [] };
  },
});
