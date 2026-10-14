/**
 * Read model for the standards screen: the version in force, the history
 * with a diff of each version against the one before, and what publishing a
 * new version would reopen. Staff only; the edit form is for the firm
 * administrator and the server enforces that.
 */
import { and, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { can } from "@/domain/policy";
import { makeRedactor } from "@/domain/redaction";
import type { StarterStandards } from "@/packet/types";
import type { SessionContext } from "@/server/context";
import { actorOrUnknown, isoOrNull, refusalFor, selfView, type Refusal } from "@/server/queries/people";
import type { ActorView } from "@/server/queries/review";
import { currentStandards, standardsHistory } from "@/server/standards";

export interface StandardsBody {
  note: string;
  rules: string[];
  requiredSteps: string[];
  verificationTypes: string[];
  reviewLevels: string[];
  variance: { compareTo: string; percent: number; amount: number };
}

export interface ListDiff {
  added: string[];
  removed: string[];
}

export interface StandardsVersionView {
  id: string;
  version: number;
  note: string;
  createdBy: ActorView | null;
  createdAt: string | null;
  createdRevision: number | null;
  body: StandardsBody;
  /** Against the previous version; null for the packet's starter standard. */
  diff: null | { rules: ListDiff; requiredSteps: ListDiff; verificationTypes: ListDiff; reviewLevels: ListDiff; variance: { before: StandardsBody["variance"]; after: StandardsBody["variance"] } | null };
}

export interface StandardsView {
  revision: number;
  actor: ActorView & { canEdit: boolean };
  current: { id: string; version: number; body: StandardsBody };
  history: StandardsVersionView[];
  /** What a new version would reopen. */
  exposure: { activeSignoffs: number; activeApprovals: number };
}

function body(s: StarterStandards): StandardsBody {
  return {
    note: s.note,
    rules: s.rules,
    requiredSteps: s.required_steps,
    verificationTypes: s.verification_types,
    reviewLevels: s.review_levels,
    variance: { compareTo: s.variance_review.compare_to, percent: s.variance_review.flag_if_change_over_percent, amount: s.variance_review.and_over_amount },
  };
}

function listDiff(before: string[], after: string[]): ListDiff {
  return { added: after.filter((x) => !before.includes(x)), removed: before.filter((x) => !after.includes(x)) };
}

function sameVariance(a: StandardsBody["variance"], b: StandardsBody["variance"]): boolean {
  return a.compareTo === b.compareTo && a.percent === b.percent && a.amount === b.amount;
}

export async function standardsView(ctx: SessionContext): Promise<StandardsView | Refusal> {
  const refused = refusalFor(ctx);
  if (refused) return refused;
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const starter = packet.firm.starter_standards;
  const [current, rows, signoffs, approvals] = await Promise.all([
    currentStandards(ctx.db, ctx.workspace.id, starter),
    standardsHistory(ctx.db, ctx.workspace.id),
    ctx.db.select({ id: t.signoffs.id }).from(t.signoffs).where(and(eq(t.signoffs.workspaceId, ctx.workspace.id), eq(t.signoffs.status, "active"))),
    ctx.db.select({ id: t.clientApprovals.id }).from(t.clientApprovals).where(and(eq(t.clientApprovals.workspaceId, ctx.workspace.id), eq(t.clientApprovals.status, "approved"))),
  ]);
  // Oldest first so each version can be compared with the one before it.
  const ordered = [...rows].sort((a, b) => a.version - b.version);
  const versions: StandardsVersionView[] = [
    { id: "starter-standards-v1", version: 1, note: "Packet starter standards.", createdBy: null, createdAt: null, createdRevision: null, body: body(starter), diff: null },
  ];
  for (const row of ordered) {
    const b = body(row.standards as StarterStandards);
    const prev = versions[versions.length - 1].body;
    versions.push({
      id: row.id,
      version: row.version,
      note: row.note,
      createdBy: actorOrUnknown(packet, row.createdBy),
      createdAt: isoOrNull(row.createdAt),
      createdRevision: row.createdRevision,
      body: b,
      diff: {
        rules: listDiff(prev.rules, b.rules),
        requiredSteps: listDiff(prev.requiredSteps, b.requiredSteps),
        verificationTypes: listDiff(prev.verificationTypes, b.verificationTypes),
        reviewLevels: listDiff(prev.reviewLevels, b.reviewLevels),
        variance: sameVariance(prev.variance, b.variance) ? null : { before: prev.variance, after: b.variance },
      },
    });
  }
  const view: StandardsView = {
    revision: ctx.workspace.revision,
    actor: { ...selfView(ctx), canEdit: can(ctx.actor, "manage_standards") },
    current: { id: current.id, version: current.version, body: body(current.standards) },
    history: versions.reverse(),
    exposure: { activeSignoffs: signoffs.length, activeApprovals: approvals.length },
  };
  return redact.deep(view);
}
