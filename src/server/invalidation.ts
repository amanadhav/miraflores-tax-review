/**
 * Sign-offs are fingerprinted over what they covered: effective values,
 * evidence links, open findings, the firm standard in force and everything
 * upstream. After every command the active sign-offs are re-fingerprinted; a
 * changed part makes the sign-off stale with a stated reason. Unaffected areas
 * keep their approvals. Client approvals bind to the whole-return presentation
 * and reopen the same way. History is never erased.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { areaForLine } from "@/domain/areas";
import { upstreamClosure } from "@/domain/effective";
import { indexPacket } from "@/packet/load";
import type { AuditSeed, HandlerContext } from "./commands";
import { linesInArea, loadWorkspaceState, type WorkspaceState } from "./state";
import { currentStandards } from "./standards";
import { buildSnapshotPayload } from "./presentation";

export interface Fingerprint {
  hash: string;
  parts: Record<string, string>;
}

function h(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

export function scopeLineKeys(state: WorkspaceState, scopeType: string, scopeId: string): string[] {
  if (scopeType === "line") return state.effective.lines.has(scopeId) ? [scopeId] : [];
  if (scopeType === "return") return state.version.lines.map((l) => l.key);
  return linesInArea(state.version, scopeId);
}

export function computeFingerprint(
  state: WorkspaceState,
  scopeType: string,
  scopeId: string,
  packetLines: Map<string, { sources: string[] }>,
  standardsVersion: string,
): Fingerprint {
  const keys = scopeLineKeys(state, scopeType, scopeId);
  const keySet = new Set(keys);
  const inScopeRef = (ref: string) =>
    scopeType === "return" || keySet.has(ref) || (scopeType === "area" && refArea(ref, state) === scopeId);

  const values = keys.map((k) => {
    const l = state.effective.lines.get(k)!;
    return [k, l.effective, l.status];
  });
  const evidence = {
    sources: keys.map((k) => [k, packetLines.get(k)?.sources ?? []]),
    adjustments: state.accepted.filter((a) => keySet.has(a.targetRef)).map((a) => [a.id, a.evidenceRefs, a.proposedValue, a.proposedLabel]),
    verifications: state.verifications
      .filter((v) => v.withdrawnRevision === null && inScopeRef(v.subjectRef))
      .map((v) => [v.id, v.method, v.evidenceRefs, v.conclusion]),
    anchors: state.anchors.filter((a) => inScopeRef(a.subjectRef)).map((a) => [a.id, a.documentId, a.page, a.textSpan]),
    judgments: state.judgments.filter((j) => j.status === "recorded" && inScopeRef(j.subjectRef)).map((j) => [j.id, j.kind, j.conclusion, j.evidenceRefs]),
  };
  const findings = state.findings
    .filter((f) => f.status === "open" && (scopeType === "return" ? true : scopeType === "area" ? f.area === scopeId : f.refs.some((r) => keySet.has(r))))
    .map((f) => f.id)
    .sort();
  const upstream = [...upstreamClosure(state.version, keys)]
    .filter((k) => !keySet.has(k))
    .sort()
    .map((k) => {
      const l = state.effective.lines.get(k);
      return [k, l?.effective ?? null, l?.status ?? "missing"];
    });
  const parts = {
    values: h(values),
    evidence: h(evidence),
    findings: h(findings),
    standards: h(standardsVersion),
    upstream: h(upstream),
  };
  return { hash: h(parts), parts };
}

function refArea(ref: string, state: WorkspaceState): string | null {
  const line = state.version.lines.find((l) => l.key === ref);
  return line ? areaForLine(line.key, line.form) : null;
}

export const PART_REASONS: Record<string, string> = {
  values: "an amount in the scope changed",
  evidence: "an evidence link, verification or anchor in the scope changed",
  findings: "the open findings in the scope changed",
  standards: "the firm standard in force changed",
  upstream: "a line feeding this scope changed",
};

export async function invalidateStaleSignoffs(hc: HandlerContext): Promise<AuditSeed[]> {
  const { tx, ctx, revision } = hc;
  const state = await loadWorkspaceState(tx, ctx);
  const std = await currentStandards(tx, ctx.workspace.id, ctx.packet.packet.firm.starter_standards);
  const packetLines = indexPacket(ctx.packet.packet).linesByVersion.get(state.version.version)!;
  const events: AuditSeed[] = [];

  for (const s of state.signoffs.filter((x) => x.status === "active")) {
    const fp = computeFingerprint(state, s.scopeType, s.scopeId, packetLines, std.id);
    if (fp.hash === s.fingerprint) continue;
    const changed = Object.keys(fp.parts).filter((k) => fp.parts[k] !== s.fingerprintParts[k]);
    const reason = `Reopened at revision ${revision}: ${changed.map((k) => PART_REASONS[k] ?? k).join("; ")}.`;
    await tx
      .update(t.signoffs)
      .set({ status: "stale", invalidatedAt: hc.now, invalidatedRevision: revision, invalidationReason: reason })
      .where(eq(t.signoffs.id, s.id));
    events.push({
      action: "signoff_reopened",
      entityType: "signoff",
      entityId: s.id,
      summary: `${s.level} sign-off on ${s.scopeType} ${s.scopeId} by ${s.actorId} reopened: ${changed.map((k) => PART_REASONS[k] ?? k).join("; ")}.`,
      before: { status: "active", fingerprint: s.fingerprint },
      after: { status: "stale", fingerprint: fp.hash, changedParts: changed },
      area: s.scopeType === "area" ? s.scopeId : refArea(s.scopeId, state),
    });
  }

  // Client approvals bind to the whole-return presentation hash.
  const approvals = await tx
    .select()
    .from(t.clientApprovals)
    .where(and(eq(t.clientApprovals.workspaceId, ctx.workspace.id), eq(t.clientApprovals.status, "approved")));
  if (approvals.length > 0 && !ctx.workspace.filingLocked) {
    const { hash: presentationHash } = buildSnapshotPayload(ctx, state, std.id);
    const stale = approvals.filter((a) => a.presentationHash !== presentationHash);
    for (const a of stale) {
      await tx
        .update(t.clientApprovals)
        .set({ status: "invalidated", invalidatedRevision: revision, invalidationReason: `The return presentation changed at revision ${revision}; a new approval is required.` })
        .where(eq(t.clientApprovals.id, a.id));
      events.push({
        action: "client_approval_reopened",
        entityType: "client_approval",
        entityId: a.id,
        summary: `Client approval by ${a.personId} reopened: the presentation changed after it was signed.`,
        before: { status: "approved", presentationHash: a.presentationHash },
        after: { status: "invalidated", presentationHash },
      });
    }
    if (stale.length > 0 && (ctx.workspace.workflowState === "ready_for_client" || ctx.workspace.workflowState === "authorized")) {
      await tx.update(t.workspaces).set({ workflowState: "preparing" }).where(eq(t.workspaces.id, ctx.workspace.id));
      events.push({
        action: "workflow_state_changed",
        entityType: "workspace",
        entityId: ctx.workspace.id,
        summary: `Return moved back to preparing because the presented return changed after client approval.`,
        before: { workflowState: ctx.workspace.workflowState },
        after: { workflowState: "preparing" },
      });
    }
  }
  return events;
}
