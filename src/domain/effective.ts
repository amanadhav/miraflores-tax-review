/**
 * Three layers, kept apart: the engine baseline (immutable), the effective
 * workpaper facts (baseline plus accepted adjustments), and whatever can be
 * recomputed from verified formulas. Anything downstream of a change that has
 * no verified formula is marked stale rather than silently left looking current.
 */
import type { ReturnVersion } from "@/packet/types";
import { dependentsIndex, evaluateFormula, formulasForVersion, numeric, type Formula } from "./formulas";

export type LineStatus = "baseline" | "adjusted" | "recomputed" | "stale";

export interface EffectiveLine {
  key: string;
  baseline: number | string | boolean | null;
  effective: number | string | boolean | null;
  status: LineStatus;
  /** Id of the accepted adjustment that set this value directly. */
  adjustmentId?: string;
  formula: Formula;
  /** For stale lines: which upstream change made the engine value untrustworthy. */
  staleBecause?: string[];
  /** For recomputed lines: the inputs whose change was propagated. */
  recomputedFrom?: string[];
}

export interface AcceptedAdjustment {
  id: string;
  targetRef: string;
  kind: string; // value | label | evidence
  proposedValue: unknown;
}

export interface EffectiveState {
  version: string;
  lines: Map<string, EffectiveLine>;
  adjustedKeys: string[];
  staleKeys: string[];
  recomputedKeys: string[];
}

export function computeEffective(
  version: ReturnVersion,
  parameters: Record<string, unknown>,
  accepted: AcceptedAdjustment[],
): EffectiveState {
  const formulas = formulasForVersion(version, parameters);
  const byKey = new Map(version.lines.map((l) => [l.key, l]));
  const lines = new Map<string, EffectiveLine>();
  for (const l of version.lines) {
    lines.set(l.key, { key: l.key, baseline: l.value, effective: l.value, status: "baseline", formula: formulas.get(l.key)! });
  }

  // Direct value adjustments win over anything propagated into them.
  const direct = new Map<string, AcceptedAdjustment>();
  for (const adj of accepted) {
    if (adj.kind !== "value") continue;
    if (!byKey.has(adj.targetRef)) continue;
    direct.set(adj.targetRef, adj); // callers pass adjustments in acceptance order; last wins
  }
  for (const [key, adj] of direct) {
    const line = lines.get(key)!;
    line.effective = adj.proposedValue as EffectiveLine["effective"];
    line.status = "adjusted";
    line.adjustmentId = adj.id;
  }

  // Propagate in dependency order (inputs before dependents).
  const order = topologicalOrder(version);
  const numericValues = new Map<string, number | null>();
  for (const key of order) numericValues.set(key, numeric(lines.get(key)!.effective));

  for (const key of order) {
    const line = lines.get(key)!;
    const src = byKey.get(key)!;
    if (line.status === "adjusted") {
      numericValues.set(key, numeric(line.effective));
      continue;
    }
    const changedInputs = src.inputs.filter((i) => {
      const dep = lines.get(i);
      return dep && dep.status !== "baseline";
    });
    if (changedInputs.length === 0) continue;
    const staleInputs = changedInputs.filter((i) => lines.get(i)!.status === "stale");
    if (staleInputs.length > 0 || line.formula.kind === "opaque") {
      line.status = "stale";
      line.staleBecause = staleInputs.length > 0 ? staleInputs : changedInputs;
      // Keep the baseline number visible but never trust it downstream.
      numericValues.set(key, numeric(line.baseline));
      continue;
    }
    const value = evaluateFormula(line.formula, numericValues);
    if (value === null) {
      line.status = "stale";
      line.staleBecause = changedInputs;
      continue;
    }
    line.effective = value;
    line.status = "recomputed";
    line.recomputedFrom = changedInputs;
    numericValues.set(key, value);
  }

  const adjustedKeys: string[] = [];
  const staleKeys: string[] = [];
  const recomputedKeys: string[] = [];
  for (const l of lines.values()) {
    if (l.status === "adjusted") adjustedKeys.push(l.key);
    else if (l.status === "stale") staleKeys.push(l.key);
    else if (l.status === "recomputed") recomputedKeys.push(l.key);
  }
  return { version: version.version, lines, adjustedKeys, staleKeys, recomputedKeys };
}

const orderCache = new WeakMap<ReturnVersion, string[]>();

/** Inputs before dependents. Rejects cycles explicitly instead of looping. */
export function topologicalOrder(version: ReturnVersion): string[] {
  const hit = orderCache.get(version);
  if (hit) return hit;
  const byKey = new Map(version.lines.map((l) => [l.key, l]));
  const state = new Map<string, 1 | 2>(); // 1 visiting, 2 done
  const out: string[] = [];
  const visit = (key: string, path: string[]) => {
    const s = state.get(key);
    if (s === 2) return;
    if (s === 1) throw new Error(`Dependency cycle in ${version.version}: ${[...path, key].join(" -> ")}`);
    state.set(key, 1);
    const line = byKey.get(key);
    if (line) for (const input of line.inputs) if (byKey.has(input)) visit(input, [...path, key]);
    state.set(key, 2);
    out.push(key);
  };
  for (const l of version.lines) visit(l.key, []);
  orderCache.set(version, out);
  return out;
}

/** Transitive upstream closure of a set of line keys (inputs of inputs). */
export function upstreamClosure(version: ReturnVersion, keys: Iterable<string>): Set<string> {
  const byKey = new Map(version.lines.map((l) => [l.key, l]));
  const seen = new Set<string>();
  const stack = [...keys];
  while (stack.length) {
    const k = stack.pop()!;
    const line = byKey.get(k);
    if (!line) continue;
    for (const input of line.inputs) {
      if (!seen.has(input)) {
        seen.add(input);
        stack.push(input);
      }
    }
  }
  return seen;
}

/** Transitive downstream closure (everything that uses these lines). */
export function downstreamClosure(version: ReturnVersion, keys: Iterable<string>): Set<string> {
  const dependents = dependentsIndex(version);
  const seen = new Set<string>();
  const stack = [...keys];
  while (stack.length) {
    const k = stack.pop()!;
    for (const d of dependents.get(k) ?? []) {
      if (!seen.has(d)) {
        seen.add(d);
        stack.push(d);
      }
    }
  }
  return seen;
}
