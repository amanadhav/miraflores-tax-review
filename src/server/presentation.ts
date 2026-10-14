/**
 * The frozen presentation of a return: every line's effective value and
 * status, the accepted changes with their estimated effects, active sign-offs
 * and recorded judgments. Its hash is what client approvals and submission
 * attempts bind to, so any later change is detectable.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as t from "@/db/schema";
import type { SessionContext } from "./context";
import type { WorkspaceState } from "./state";

export interface SnapshotPayload {
  version: string;
  revision: number;
  asOf: string;
  standardsVersion: string;
  baselineSummary: unknown;
  lines: { key: string; jurisdiction: string; form: string; line: string; label: string; baseline: unknown; effective: unknown; status: string }[];
  acceptedAdjustments: unknown[];
  estimatedEffects: { federal: number; california: number; balanceFederal: number; balanceCalifornia: number; limitations: string[] };
  signoffs: unknown[];
  judgments: unknown[];
  openFindings: number;
  presentationNote: string;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildSnapshotPayload(ctx: SessionContext, state: WorkspaceState, standardsVersion: string): { payload: SnapshotPayload; hash: string } {
  const accepted = state.accepted;
  let federal = 0;
  let california = 0;
  let balanceFederal = 0;
  let balanceCalifornia = 0;
  const limitations = new Set<string>();
  for (const a of accepted) {
    federal += Number(a.effectFederal ?? 0);
    california += Number(a.effectCalifornia ?? 0);
    balanceFederal += Number(a.balanceFederal ?? 0);
    balanceCalifornia += Number(a.balanceCalifornia ?? 0);
    for (const l of a.limitations) limitations.add(l);
  }
  const judgments = state.judgments.filter((j) => j.status === "recorded").map((j) => ({ id: j.id, kind: j.kind, subjectRef: j.subjectRef, title: j.title, authority: j.authority, conclusion: j.conclusion }));
  const payload: SnapshotPayload = {
    version: state.version.version,
    revision: ctx.workspace.revision,
    asOf: new Date(ctx.workspace.asOf).toISOString(),
    standardsVersion,
    baselineSummary: state.version.summary,
    lines: state.version.lines.map((l) => {
      const e = state.effective.lines.get(l.key)!;
      return { key: l.key, jurisdiction: l.jurisdiction, form: l.form, line: l.line, label: l.label, baseline: e.baseline, effective: e.effective, status: e.status };
    }),
    acceptedAdjustments: accepted.map((a) => ({
      id: a.id,
      targetRef: a.targetRef,
      kind: a.kind,
      priorValue: a.priorValue,
      proposedValue: a.proposedValue,
      proposedLabel: a.proposedLabel,
      reason: a.reason,
      evidenceRefs: a.evidenceRefs,
      effectFederal: a.effectFederal,
      effectCalifornia: a.effectCalifornia,
      balanceFederal: a.balanceFederal,
      balanceCalifornia: a.balanceCalifornia,
      effectStatus: a.effectStatus,
      limitations: a.limitations,
      authorId: a.authorId,
      decidedBy: a.decidedBy,
      decidedRevision: a.decidedRevision,
    })),
    estimatedEffects: { federal: round(federal), california: round(california), balanceFederal: round(balanceFederal), balanceCalifornia: round(balanceCalifornia), limitations: [...limitations] },
    signoffs: state.signoffs.filter((s) => s.status === "active").map((s) => ({ id: s.id, scopeType: s.scopeType, scopeId: s.scopeId, level: s.level, actorId: s.actorId, revision: s.revision, fingerprint: s.fingerprint })),
    judgments,
    openFindings: state.findings.filter((f) => f.status === "open").length,
    presentationNote:
      "Engine baseline totals are shown as computed; accepted workpaper changes are listed with estimated effects at the version's supplied rates. The engine was not rerun, so no recomputed final tax is claimed; stale lines are marked.",
  };
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        v: payload.version,
        s: payload.standardsVersion,
        lines: payload.lines.map((l) => [l.key, l.effective, l.status]),
        adj: payload.acceptedAdjustments,
        judgments: judgments.map((j) => [j.id, j.conclusion]),
      }),
    )
    .digest("hex");
  return { payload, hash };
}

export async function activeApprovals(db: Db, workspaceId: string) {
  return db.select().from(t.clientApprovals).where(and(eq(t.clientApprovals.workspaceId, workspaceId), eq(t.clientApprovals.status, "approved")));
}
