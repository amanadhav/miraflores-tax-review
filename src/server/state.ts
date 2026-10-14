/**
 * Shared loaders for a workspace's workpaper state. Handlers, invalidation and
 * screens all read through here so the effective state is computed one way.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as t from "@/db/schema";
import { computeEffective, type EffectiveState } from "@/domain/effective";
import { areaForLine } from "@/domain/areas";
import { indexPacket } from "@/packet/load";
import type { ReturnVersion } from "@/packet/types";
import type { SessionContext } from "./context";

export type AdjustmentRow = typeof t.adjustments.$inferSelect;
export type FindingRow = typeof t.findings.$inferSelect;
export type SignoffRow = typeof t.signoffs.$inferSelect;
export type VerificationRow = typeof t.verifications.$inferSelect;
export type AnchorRow = typeof t.anchors.$inferSelect;

export interface WorkspaceState {
  version: ReturnVersion;
  effective: EffectiveState;
  adjustments: AdjustmentRow[];
  accepted: AdjustmentRow[];
  findings: FindingRow[];
  signoffs: SignoffRow[];
  verifications: VerificationRow[];
  anchors: AnchorRow[];
}

export function activeVersion(ctx: SessionContext): ReturnVersion {
  const v = indexPacket(ctx.packet.packet).versions.get(ctx.workspace.activeVersion);
  if (!v) throw new Error(`Version ${ctx.workspace.activeVersion} is not in the packet`);
  return v;
}

export async function loadAcceptedAdjustments(db: Db, workspaceId: string): Promise<AdjustmentRow[]> {
  return db
    .select()
    .from(t.adjustments)
    .where(and(eq(t.adjustments.workspaceId, workspaceId), eq(t.adjustments.status, "accepted")))
    .orderBy(asc(t.adjustments.decidedRevision), asc(t.adjustments.createdAt));
}

export async function loadEffective(db: Db, ctx: SessionContext): Promise<EffectiveState> {
  const version = activeVersion(ctx);
  const accepted = await loadAcceptedAdjustments(db, ctx.workspace.id);
  return computeEffective(
    version,
    ctx.packet.packet.engine_reference.parameters,
    accepted.map((a) => ({ id: a.id, targetRef: a.targetRef, kind: a.kind, proposedValue: a.proposedValue })),
  );
}

export async function loadWorkspaceState(db: Db, ctx: SessionContext): Promise<WorkspaceState> {
  const version = activeVersion(ctx);
  const wsId = ctx.workspace.id;
  const [adjustments, findings, signoffs, verifications, anchors] = await Promise.all([
    db.select().from(t.adjustments).where(eq(t.adjustments.workspaceId, wsId)).orderBy(asc(t.adjustments.createdRevision), asc(t.adjustments.createdAt)),
    db.select().from(t.findings).where(eq(t.findings.workspaceId, wsId)).orderBy(asc(t.findings.createdRevision)),
    db.select().from(t.signoffs).where(eq(t.signoffs.workspaceId, wsId)).orderBy(asc(t.signoffs.revision)),
    db.select().from(t.verifications).where(eq(t.verifications.workspaceId, wsId)).orderBy(asc(t.verifications.createdRevision)),
    db.select().from(t.anchors).where(eq(t.anchors.workspaceId, wsId)).orderBy(asc(t.anchors.createdRevision)),
  ]);
  const accepted = adjustments
    .filter((a) => a.status === "accepted")
    .sort((a, b) => (a.decidedRevision ?? 0) - (b.decidedRevision ?? 0));
  const effective = computeEffective(
    version,
    ctx.packet.packet.engine_reference.parameters,
    accepted.map((a) => ({ id: a.id, targetRef: a.targetRef, kind: a.kind, proposedValue: a.proposedValue })),
  );
  return { version, effective, adjustments, accepted, findings, signoffs, verifications, anchors };
}

/** Line keys that belong to a review area in the active version. */
export function linesInArea(version: ReturnVersion, areaId: string): string[] {
  return version.lines.filter((l) => areaForLine(l.key, l.form) === areaId).map((l) => l.key);
}

/**
 * Everyone who prepared any part of a scope, including the engagement's
 * assigned preparer. Used by the no-self-review rule.
 */
export async function scopePreparers(db: Db, workspaceId: string, scopeType: "area" | "line", scopeId: string): Promise<Set<string>> {
  const rows = await db
    .select({ actorId: t.scopeContributions.actorId })
    .from(t.scopeContributions)
    .where(
      and(
        eq(t.scopeContributions.workspaceId, workspaceId),
        inArray(t.scopeContributions.scopeType, [scopeType, "engagement"]),
        inArray(t.scopeContributions.scopeId, [scopeId, "*"]),
      ),
    );
  return new Set(rows.map((r) => r.actorId));
}

export async function recordContribution(
  db: Db,
  workspaceId: string,
  actorId: string,
  kind: string,
  revision: number,
  scopes: { scopeType: "area" | "line"; scopeId: string }[],
): Promise<void> {
  if (scopes.length === 0) return;
  await db.insert(t.scopeContributions).values(
    scopes.map((s) => ({ workspaceId, scopeType: s.scopeType, scopeId: s.scopeId, actorId, kind, revision })),
  );
}
