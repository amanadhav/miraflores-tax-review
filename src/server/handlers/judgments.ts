import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as t from "@/db/schema";
import { AREAS } from "@/domain/areas";
import { requirePermission } from "@/domain/policy";
import { parseRef } from "@/packet/refs";
import { CommandError, registerHandler } from "../commands";
import { newId } from "../ids";
import { recordContribution } from "../state";
import { assertEvidence } from "./adjustments";
import { subjectArea } from "./common";

const judgmentSchema = z.object({
  kind: z.enum(["judgment", "election", "due_diligence", "penalty_decision"]),
  subjectRef: z.string().min(1),
  title: z.string().min(3).max(200),
  authority: z.string().min(2).max(2000),
  applicability: z.string().min(2).max(4000),
  conclusion: z.string().min(2).max(4000),
  consequences: z.string().max(4000).optional(),
  evidenceRefs: z.array(z.string().min(1)).max(40).default([]),
  checklist: z.array(z.object({ item: z.string().min(1), done: z.boolean(), note: z.string().max(500).optional() })).max(40).optional(),
  area: z.string().optional(),
  supersedesId: z.string().optional(),
});

/**
 * Judgment calls, elections, due diligence and penalty decisions. Each keeps
 * the authority relied on, its applicability, the conclusion and consequences.
 * Recording one is preparation work for the no-self-review rule.
 */
registerHandler({
  type: "record_judgment",
  schema: judgmentSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "add_verification", "record judgments");
    await assertEvidence(hc, [...p.evidenceRefs]);
    const area = p.area ?? subjectArea(hc, p.subjectRef);
    if (!AREAS.some((a) => a.id === area)) throw new CommandError("validation", `Unknown area ${area}.`);
    if (p.kind === "due_diligence" && (!p.checklist || p.checklist.length === 0)) {
      throw new CommandError("validation", "Due diligence needs its checklist items with a done flag each.");
    }
    if (p.supersedesId) {
      const [prev] = await tx.select().from(t.judgments).where(and(eq(t.judgments.id, p.supersedesId), eq(t.judgments.workspaceId, ctx.workspace.id)));
      if (!prev) throw new CommandError("not_found", "Superseded judgment not found.");
      await tx.update(t.judgments).set({ status: "superseded" }).where(eq(t.judgments.id, prev.id));
    }
    const id = newId("jdg");
    await tx.insert(t.judgments).values({
      id,
      workspaceId: ctx.workspace.id,
      kind: p.kind,
      subjectRef: p.subjectRef,
      area,
      title: p.title,
      authority: p.authority,
      applicability: p.applicability,
      conclusion: p.conclusion,
      consequences: p.consequences ?? null,
      evidenceRefs: p.evidenceRefs,
      checklist: p.checklist ?? null,
      status: "recorded",
      supersedesId: p.supersedesId ?? null,
      decidedBy: ctx.actor.id,
      createdRevision: revision,
    });
    const scopes: { scopeType: "area" | "line"; scopeId: string }[] = [{ scopeType: "area", scopeId: area }];
    if (parseRef(p.subjectRef).kind === "line") scopes.push({ scopeType: "line", scopeId: p.subjectRef });
    await recordContribution(tx, ctx.workspace.id, ctx.actor.id, "judgment", revision, scopes);
    return {
      result: { judgmentId: id },
      events: [
        {
          action: "judgment_recorded",
          entityType: "judgment",
          entityId: id,
          summary: `${ctx.actor.name} recorded a ${p.kind.replace(/_/g, " ")} on ${p.subjectRef}: ${p.title} (authority: ${p.authority.slice(0, 80)}).`,
          after: { kind: p.kind, subjectRef: p.subjectRef, conclusion: p.conclusion, evidenceRefs: p.evidenceRefs },
          area,
        },
      ],
    };
  },
});

const dispositionSchema = z.object({
  subjectRef: z.string().min(1),
  disposition: z.enum(["used", "duplicate", "superseded", "not_applicable", "outside_scope", "manual_review", "reviewed_no_use"]),
  note: z.string().max(2000).optional(),
});

/** Completeness: every document, page or area gets an explicit disposition. */
registerHandler({
  type: "record_disposition",
  schema: dispositionSchema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "add_verification", "record dispositions");
    const parsed = parseRef(p.subjectRef);
    let area = "intake_and_engagement";
    if (p.subjectRef.startsWith("area:")) {
      const id = p.subjectRef.slice(5);
      if (!AREAS.some((a) => a.id === id)) throw new CommandError("validation", `Unknown area ${id}.`);
      area = id;
    } else if (parsed.kind === "document" || parsed.kind === "document_page") {
      await assertEvidence(hc, [p.subjectRef]);
      area = subjectArea(hc, p.subjectRef);
    } else {
      throw new CommandError("validation", "A disposition applies to a document (D12), a page (doc:D12#page1) or an area (area:business).");
    }
    const id = newId("dsp");
    await tx.insert(t.dispositions).values({
      id,
      workspaceId: ctx.workspace.id,
      subjectRef: p.subjectRef,
      disposition: p.disposition,
      note: p.note ?? null,
      actorId: ctx.actor.id,
      createdRevision: revision,
    });
    await recordContribution(tx, ctx.workspace.id, ctx.actor.id, "disposition", revision, [{ scopeType: "area", scopeId: area }]);
    return {
      result: { dispositionId: id },
      events: [
        {
          action: "disposition_recorded",
          entityType: "disposition",
          entityId: id,
          summary: `${ctx.actor.name} marked ${p.subjectRef} as ${p.disposition.replace(/_/g, " ")}${p.note ? `: ${p.note}` : "."}`,
          after: { subjectRef: p.subjectRef, disposition: p.disposition },
          area,
        },
      ],
    };
  },
});
