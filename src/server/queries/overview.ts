import { AREAS } from "@/domain/areas";
import { round2 } from "@/domain/effects";
import type { SessionContext } from "@/server/context";
import { linesInArea, loadWorkspaceState, type WorkspaceState } from "@/server/state";

export interface AreaStatus {
  id: string;
  label: string;
  lines: number;
  openFindings: number;
  blockers: number;
  proposals: number;
  accepted: number;
  stale: number;
  signoffs: Record<"preparer" | "reviewer" | "partner", "active" | "stale" | "none">;
}

export interface Overview {
  state: WorkspaceState;
  baseline: { federal: Record<string, number>; california: Record<string, number> };
  effect: {
    federal: number;
    california: number;
    balanceFederal: number;
    balanceCalifornia: number;
    count: number;
    unknownCount: number;
    limitations: string[];
  };
  proposals: number;
  blockers: WorkspaceState["findings"];
  areas: AreaStatus[];
}

export async function loadOverview(ctx: SessionContext): Promise<Overview> {
  const state = await loadWorkspaceState(ctx.db, ctx);
  const accepted = state.accepted;
  const limitations = new Set<string>();
  let federal = 0;
  let california = 0;
  let balanceFederal = 0;
  let balanceCalifornia = 0;
  let unknownCount = 0;
  for (const a of accepted) {
    if (a.effectStatus === "unknown") unknownCount += 1;
    federal += Number(a.effectFederal ?? 0);
    california += Number(a.effectCalifornia ?? 0);
    balanceFederal += Number(a.balanceFederal ?? 0);
    balanceCalifornia += Number(a.balanceCalifornia ?? 0);
    for (const l of a.limitations) limitations.add(l);
  }
  const areas: AreaStatus[] = AREAS.map((area) => {
    const keys = new Set(linesInArea(state.version, area.id));
    const sig = (level: "preparer" | "reviewer" | "partner") => {
      const rows = state.signoffs.filter((s) => s.scopeType === "area" && s.scopeId === area.id && s.level === level);
      if (rows.some((r) => r.status === "active")) return "active" as const;
      if (rows.some((r) => r.status === "stale")) return "stale" as const;
      return "none" as const;
    };
    return {
      id: area.id,
      label: area.label,
      lines: keys.size,
      openFindings: state.findings.filter((f) => f.status === "open" && f.area === area.id).length,
      blockers: state.findings.filter((f) => f.status === "open" && f.blocksFiling && f.area === area.id).length,
      proposals: state.adjustments.filter((a) => a.status === "proposed" && a.area === area.id).length,
      accepted: accepted.filter((a) => a.area === area.id).length,
      stale: state.effective.staleKeys.filter((k) => keys.has(k)).length,
      signoffs: { preparer: sig("preparer"), reviewer: sig("reviewer"), partner: sig("partner") },
    };
  });
  return {
    state,
    baseline: state.version.summary,
    effect: {
      federal: round2(federal),
      california: round2(california),
      balanceFederal: round2(balanceFederal),
      balanceCalifornia: round2(balanceCalifornia),
      count: accepted.length,
      unknownCount,
      limitations: [...limitations],
    },
    proposals: state.adjustments.filter((a) => a.status === "proposed").length,
    blockers: state.findings.filter((f) => f.status === "open" && f.blocksFiling),
    areas,
  };
}
