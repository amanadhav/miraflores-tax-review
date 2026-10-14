/**
 * Prior-year swings. The firm standard flags a line when the change is over
 * the percentage AND over the amount threshold. A zero or missing prior value
 * has no percentage, so it is handled explicitly instead of dividing by zero.
 */
import type { EffectiveState } from "./effective";
import { numeric } from "./formulas";
import type { Packet, ReturnVersion } from "@/packet/types";
import { round2 } from "./effects";

export interface VarianceRow {
  key: string;
  label: string;
  prior: number | null;
  current: number | null;
  delta: number | null;
  percent: number | null; // absolute percent change, null when prior is zero or missing
  flagged: boolean;
  reason: string;
  status?: EffectiveState["lines"] extends Map<string, infer L> ? (L extends { status: infer S } ? S : never) : never;
  explained: boolean;
}

export interface VarianceReport {
  thresholdPercent: number;
  thresholdAmount: number;
  compared: VarianceRow[];
  onlyPrior: { key: string; label: string; prior: number | null }[];
  onlyCurrent: { key: string; label: string; current: number | null }[];
}

export function buildVariance(
  packet: Packet,
  version: ReturnVersion,
  effective: EffectiveState,
  explainedKeys: Set<string>,
): VarianceReport {
  const std = packet.firm.starter_standards.variance_review;
  const prior = packet.prior_years.return_2024 as { lines: Record<string, unknown>; line_labels: Record<string, string> };
  const current = new Map(version.lines.map((l) => [l.key, l]));
  const compared: VarianceRow[] = [];
  const onlyPrior: VarianceReport["onlyPrior"] = [];
  for (const [key, raw] of Object.entries(prior.lines)) {
    const priorValue = numeric(raw);
    const line = current.get(key);
    if (!line) {
      onlyPrior.push({ key, label: prior.line_labels[key] ?? key, prior: priorValue });
      continue;
    }
    const eff = effective.lines.get(key);
    const currentValue = numeric(eff?.effective ?? line.value);
    if (priorValue === null || currentValue === null) {
      compared.push({ key, label: line.label, prior: priorValue, current: currentValue, delta: null, percent: null, flagged: false, reason: "Not numeric on one side.", status: eff?.status, explained: explainedKeys.has(key) });
      continue;
    }
    const delta = round2(currentValue - priorValue);
    const overAmount = Math.abs(delta) > std.and_over_amount;
    if (priorValue === 0) {
      const flagged = overAmount;
      compared.push({
        key,
        label: line.label,
        prior: priorValue,
        current: currentValue,
        delta,
        percent: null,
        flagged,
        reason: flagged ? `No prior-year amount; change of ${Math.abs(delta).toLocaleString("en-US")} is over ${std.and_over_amount}.` : "No prior-year amount; change is under the amount threshold.",
        status: eff?.status,
        explained: explainedKeys.has(key),
      });
      continue;
    }
    const percent = round2((Math.abs(delta) / Math.abs(priorValue)) * 100);
    const flagged = overAmount && percent > std.flag_if_change_over_percent;
    compared.push({
      key,
      label: line.label,
      prior: priorValue,
      current: currentValue,
      delta,
      percent,
      flagged,
      reason: flagged
        ? `Change of ${Math.abs(delta).toLocaleString("en-US")} (${percent}%) is over both thresholds.`
        : !overAmount
          ? `Change under ${std.and_over_amount}.`
          : `Change of ${percent}% is under ${std.flag_if_change_over_percent}%.`,
      status: eff?.status,
      explained: explainedKeys.has(key),
    });
  }
  const onlyCurrent = version.lines
    .filter((l) => !(l.key in prior.lines) && l.form !== "F8949" && numeric(l.value) !== null && Math.abs(numeric(l.value)!) > std.and_over_amount)
    .map((l) => ({ key: l.key, label: l.label, current: numeric(effective.lines.get(l.key)?.effective ?? l.value) }));
  compared.sort((a, b) => Number(b.flagged) - Number(a.flagged) || Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
  return { thresholdPercent: std.flag_if_change_over_percent, thresholdAmount: std.and_over_amount, compared, onlyPrior, onlyCurrent };
}
