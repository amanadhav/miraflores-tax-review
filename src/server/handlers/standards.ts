import { z } from "zod";
import * as t from "@/db/schema";
import { requirePermission } from "@/domain/policy";
import { registerHandler } from "../commands";
import { newId } from "../ids";
import { currentStandards } from "../standards";

const schema = z.object({
  note: z.string().min(3).max(2000),
  rules: z.array(z.string().min(3)).max(40).optional(),
  requiredSteps: z.array(z.string().min(3)).max(40).optional(),
  verificationTypes: z.array(z.string().min(3)).max(20).optional(),
  varianceReview: z.object({ compare_to: z.string(), flag_if_change_over_percent: z.number().min(0), and_over_amount: z.number().min(0) }).optional(),
  reviewLevels: z.array(z.string().min(3)).max(10).optional(),
});

/**
 * Firm standards are versioned. A new version is the standard in force from
 * this revision on; every active sign-off and client approval was given under
 * the previous version, so the invalidation step reopens them with that reason.
 */
registerHandler({
  type: "update_standards",
  schema,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "manage_standards", "change firm standards");
    const current = await currentStandards(tx, ctx.workspace.id, ctx.packet.packet.firm.starter_standards);
    const next = {
      ...current.standards,
      rules: p.rules ?? current.standards.rules,
      required_steps: p.requiredSteps ?? current.standards.required_steps,
      verification_types: p.verificationTypes ?? current.standards.verification_types,
      variance_review: p.varianceReview ?? current.standards.variance_review,
      review_levels: p.reviewLevels ?? current.standards.review_levels,
      note: p.note,
    };
    const id = newId("std");
    await tx.insert(t.standardsVersions).values({
      id,
      workspaceId: ctx.workspace.id,
      version: current.version + 1,
      standards: next,
      note: p.note,
      createdBy: ctx.actor.id,
      createdRevision: revision,
    });
    return {
      result: { standardsId: id, version: current.version + 1 },
      events: [
        {
          action: "standards_published",
          entityType: "standards",
          entityId: id,
          summary: `${ctx.actor.name} published firm standards version ${current.version + 1}: ${p.note}`,
          before: { version: current.version, standards: current.standards },
          after: { version: current.version + 1, standards: next },
        },
      ],
    };
  },
});
