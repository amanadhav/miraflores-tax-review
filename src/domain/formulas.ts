/**
 * Supported calculations. The packet's `R-SUM` means "arithmetic combination",
 * not always addition (F1040.11 subtracts adjustments from income), and most
 * rules are opaque. A formula is only ever claimed when it reproduces the
 * engine's own baseline exactly; otherwise the line stays opaque and goes
 * stale when an input changes.
 */
import type { ReturnLine, ReturnVersion } from "@/packet/types";

export type Formula =
  | { kind: "sum"; terms: { key: string; sign: 1 | -1; signVerified: boolean }[]; rule: string }
  | { kind: "carry"; from: string; rule: string }
  | { kind: "multiply"; input: string; factor: number; factorRef: string; rounding: "whole"; rule: string }
  | { kind: "opaque"; rule: string; reason: string };

const CARRY_LIKE = new Set(["R-CARRY", "R-CA-DIVIDENDS", "R-CA-IRA", "R-CA-CAPGAIN"]);
const TOLERANCE = 0.51;

export function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function inferFormula(
  line: ReturnLine,
  lines: Map<string, ReturnLine>,
  parameters: Record<string, unknown>,
): Formula {
  const rule = line.rule;
  const value = numeric(line.value);
  if (value === null) return { kind: "opaque", rule, reason: "Line holds text, a date or a ratio." };
  if (line.inputs.length === 0) return { kind: "opaque", rule, reason: "No input lines; value comes from sources or the engine." };
  const inputs = line.inputs.map((k) => ({ key: k, value: numeric(lines.get(k)?.value) }));
  if (inputs.some((i) => i.value === null)) return { kind: "opaque", rule, reason: "An input line is missing or not numeric." };
  const vals = inputs as { key: string; value: number }[];

  if (CARRY_LIKE.has(rule) && vals.length === 1) {
    if (Math.abs(vals[0].value - value) <= TOLERANCE) return { kind: "carry", from: vals[0].key, rule };
    return { kind: "opaque", rule, reason: "Value does not equal the carried line." };
  }

  if (rule === "R-STANDARD-MILEAGE" && vals.length === 1) {
    const rate = numeric(parameters.mileage_rate);
    if (rate !== null && Math.abs(Math.round(vals[0].value * rate) - value) <= TOLERANCE) {
      return { kind: "multiply", input: vals[0].key, factor: rate, factorRef: "ref:param.mileage_rate", rounding: "whole", rule };
    }
    return { kind: "opaque", rule, reason: "Miles times the supplied rate does not reproduce the value." };
  }

  if (rule === "R-MEALS-50" && vals.length === 1) {
    if (Math.abs(Math.round(vals[0].value * 0.5) - value) <= TOLERANCE) {
      return { kind: "multiply", input: vals[0].key, factor: 0.5, factorRef: "rule:R-MEALS-50", rounding: "whole", rule };
    }
    return { kind: "opaque", rule, reason: "Half of the input does not reproduce the value." };
  }

  if (rule === "R-SUM" || rule === "R-CARRY") {
    if (vals.length > 16) return { kind: "opaque", rule, reason: "Too many inputs to verify sign combinations." };
    const matches: (1 | -1)[][] = [];
    const n = vals.length;
    for (let mask = 0; mask < 1 << n; mask++) {
      let total = 0;
      const signs: (1 | -1)[] = [];
      for (let i = 0; i < n; i++) {
        const sign: 1 | -1 = mask & (1 << i) ? -1 : 1;
        signs.push(sign);
        total += sign * vals[i].value;
      }
      if (Math.abs(total - value) <= TOLERANCE) matches.push(signs);
    }
    if (matches.length === 0) return { kind: "opaque", rule, reason: "No signed combination of the inputs reproduces the value." };
    const terms = vals.map((v, i) => {
      const seen = new Set(matches.map((m) => m[i]));
      const zero = Math.abs(v.value) <= TOLERANCE;
      if (seen.size === 1) return { key: v.key, sign: matches[0][i], signVerified: !zero };
      // Ambiguous sign: only acceptable when the input is zero (any sign works).
      return { key: v.key, sign: 1 as const, signVerified: false, ambiguous: !zero };
    });
    if (terms.some((t) => (t as { ambiguous?: boolean }).ambiguous)) {
      return { kind: "opaque", rule, reason: "More than one sign combination reproduces the value." };
    }
    return { kind: "sum", terms: terms.map(({ key, sign, signVerified }) => ({ key, sign, signVerified })), rule };
  }

  return { kind: "opaque", rule, reason: "Rule is not a supported arithmetic form." };
}

export function evaluateFormula(formula: Formula, values: Map<string, number | null>): number | null {
  switch (formula.kind) {
    case "sum": {
      let total = 0;
      for (const term of formula.terms) {
        const v = values.get(term.key);
        if (v === null || v === undefined) return null;
        total += term.sign * v;
      }
      return Math.round(total * 100) / 100;
    }
    case "carry": {
      const v = values.get(formula.from);
      return v === undefined ? null : v;
    }
    case "multiply": {
      const v = values.get(formula.input);
      if (v === null || v === undefined) return null;
      return Math.round(v * formula.factor);
    }
    case "opaque":
      return null;
  }
}

export function describeFormula(formula: Formula, labels: (key: string) => string): string {
  switch (formula.kind) {
    case "sum":
      return formula.terms
        .map((t, i) => `${i === 0 ? (t.sign < 0 ? "-" : "") : t.sign < 0 ? " - " : " + "}${labels(t.key)}`)
        .join("");
    case "carry":
      return `Carried from ${labels(formula.from)}`;
    case "multiply":
      return `${labels(formula.input)} x ${formula.factor}, rounded to whole dollars`;
    case "opaque":
      return `Engine rule ${formula.rule}: ${formula.reason}`;
  }
}

const formulaCache = new WeakMap<ReturnVersion, Map<string, Formula>>();

/** All verified formulas for a version, memoized per version object. */
export function formulasForVersion(version: ReturnVersion, parameters: Record<string, unknown>): Map<string, Formula> {
  const hit = formulaCache.get(version);
  if (hit) return hit;
  const lines = new Map(version.lines.map((l) => [l.key, l]));
  const out = new Map<string, Formula>();
  for (const line of version.lines) out.set(line.key, inferFormula(line, lines, parameters));
  formulaCache.set(version, out);
  return out;
}

/** Reverse index: input key -> lines that use it in this version. */
export function dependentsIndex(version: ReturnVersion): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of version.lines) {
    for (const input of line.inputs) {
      const list = out.get(input);
      if (list) list.push(line.key);
      else out.set(input, [line.key]);
    }
  }
  return out;
}
