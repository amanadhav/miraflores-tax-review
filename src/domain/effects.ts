/**
 * Estimated tax effect of a change, following the packet README: multiply the
 * change in a category's economic measure by that version's supplied
 * per-dollar rate. Credits and payments move tax or balance due one for one.
 * An estimate is never a recomputed return; limitations travel with it.
 */
import type { ReturnVersion } from "@/packet/types";

export const EFFECT_CATEGORIES = [
  "wages",
  "interest",
  "schc_profit",
  "stcg",
  "ltcg",
  "ordinary_income",
  "adjustment",
  "salt",
  "itemized",
  "ca_source_income",
  "credit",
  "payment",
  "none",
] as const;

export type EffectCategory = (typeof EFFECT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<EffectCategory, string> = {
  wages: "Wages (federal and California-source)",
  interest: "Interest and dividends",
  schc_profit: "Schedule C profit (also drives SE tax and QBI)",
  stcg: "Short-term capital gain",
  ltcg: "Long-term capital gain",
  ordinary_income: "Other ordinary income",
  adjustment: "Adjustment to income",
  salt: "State and local taxes (subject to the cap)",
  itemized: "Other itemized deductions",
  ca_source_income: "California-source amount only",
  credit: "Tax credit (changes tax one for one)",
  payment: "Payment or withholding (changes balance due one for one)",
  none: "No tax effect (descriptive or evidence-only change)",
};

export interface EffectInput {
  category: EffectCategory;
  /** Signed change in the category's economic measure (for example profit up 100 is +100). */
  measureDelta: number;
  /** Item is fully California-source (sale during residency, Sacramento rental). */
  caSource: boolean;
  /** Jurisdiction of a credit or payment line. */
  jurisdiction: "federal" | "california";
  version: ReturnVersion;
}

export interface EffectEstimate {
  federal: number | null;
  california: number | null;
  balanceFederal: number | null;
  balanceCalifornia: number | null;
  status: "estimated" | "exact_local" | "none" | "unknown";
  basis: string;
  limitations: string[];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function estimateEffect(input: EffectInput): EffectEstimate {
  const { category, measureDelta, caSource, jurisdiction, version } = input;
  const v = version.version;
  if (category === "none") {
    return { federal: 0, california: 0, balanceFederal: 0, balanceCalifornia: 0, status: "none", basis: "Descriptive or evidence-only change; no amount moved.", limitations: [] };
  }
  if (category === "credit") {
    const tax = round2(-measureDelta);
    return {
      federal: jurisdiction === "federal" ? tax : 0,
      california: jurisdiction === "california" ? tax : 0,
      balanceFederal: jurisdiction === "federal" ? tax : 0,
      balanceCalifornia: jurisdiction === "california" ? tax : 0,
      status: "exact_local",
      basis: `A ${jurisdiction} credit changes ${jurisdiction} tax one for one (README: credits change tax 1:1).`,
      limitations: ["Credit limits and phase-outs are not re-evaluated."],
    };
  }
  if (category === "payment") {
    const balance = round2(-measureDelta);
    return {
      federal: 0,
      california: 0,
      balanceFederal: jurisdiction === "federal" ? balance : 0,
      balanceCalifornia: jurisdiction === "california" ? balance : 0,
      status: "exact_local",
      basis: `A ${jurisdiction} payment changes balance due one for one and leaves tax unchanged.`,
      limitations: ["Underpayment penalty and interest are not recomputed."],
    };
  }
  const rates = version.tax_effect_rates[category];
  if (!rates) {
    return { federal: null, california: null, balanceFederal: null, balanceCalifornia: null, status: "unknown", basis: `No ${v} rate supplied for ${category}.`, limitations: ["Effect cannot be estimated from the supplied rates."] };
  }
  const caRate = caSource ? version.tax_effect_rates.ca_source_income?.california_per_dollar ?? rates.california_per_dollar : rates.california_per_dollar;
  const federal = round2(measureDelta * rates.federal_per_dollar);
  const california = round2(measureDelta * caRate);
  const limitations: string[] = [`Estimate at ${v} supplied per-dollar rates (federal ${rates.federal_per_dollar}, California ${caRate}); not a recomputed return.`];
  if (category === "schc_profit") limitations.push("SE tax, SEP limit, self-employed health insurance and QBI interactions are not recomputed.");
  if (category === "adjustment") limitations.push("Business-tied adjustments also change the QBI deduction, which the adjustment rate does not capture.");
  if (category === "salt") limitations.push("SALT cap interaction is not re-evaluated; the federal rate is zero only while the cap binds.");
  if (category === "itemized") limitations.push("Itemized versus standard deduction choice is not re-evaluated.");
  if (caSource) limitations.push("California effect uses the California-source rate because the item is fully California-source during residency.");
  else if (category !== "wages" && category !== "ordinary_income") limitations.push("California rate assumes residency-day proration.");
  if (Math.abs(measureDelta) >= 10000) limitations.push("Large change may cross a bracket, phase-out or cap threshold; the real system recomputes.");
  return {
    federal,
    california,
    balanceFederal: federal,
    balanceCalifornia: california,
    status: "estimated",
    basis: `${measureDelta >= 0 ? "+" : ""}${measureDelta} ${category} x ${v} rates.`,
    limitations,
  };
}
