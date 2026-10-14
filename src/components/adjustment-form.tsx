"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";
import { parseRefs } from "@/components/finding-forms";
import { formatLineValue } from "@/components/line-value";
import { signed } from "@/lib/format";
import type { EffectEstimate } from "@/domain/effects";
import type { LineValue, ProposeDefaults, RefView } from "@/server/queries/review";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";

/** Numbers typed with commas become numbers; anything else stays text; blank is null. */
export function parseProposedValue(text: string): LineValue {
  const t = text.trim();
  if (t === "") return null;
  const bare = t.replace(/,/g, "");
  if (/^-?\d*\.?\d+$/.test(bare)) return Number(bare);
  if (/^\(\d[\d,]*(\.\d+)?\)$/.test(t)) return -Number(t.slice(1, -1).replace(/,/g, ""));
  return t;
}

interface ProposeResult {
  adjustmentId: string;
  effect: EffectEstimate;
  requiresPartner: boolean;
}

/**
 * Propose a change to one line (command propose_adjustment). The engine value
 * is never edited: a proposal records the proposed value, the reason, the
 * evidence and an estimated effect that a reviewer or partner then decides.
 */
export function AdjustmentForm({
  targetRef,
  lineLabel,
  currentValue,
  jurisdiction,
  revision,
  sources,
  defaults,
  categories,
  canPropose,
  actorRole,
}: {
  targetRef: string;
  lineLabel: string;
  currentValue: LineValue;
  jurisdiction: string;
  revision: number;
  sources: RefView[];
  defaults: ProposeDefaults;
  categories: { value: string; label: string }[];
  canPropose: boolean;
  actorRole: string;
}) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [kind, setKind] = useState<"value" | "label" | "evidence">("value");
  const [proposedValue, setProposedValue] = useState("");
  const [proposedLabel, setProposedLabel] = useState(lineLabel);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string[]>(sources.filter((s) => s.found && s.available).map((s) => s.ref));
  const [extraRefs, setExtraRefs] = useState("");
  const [category, setCategory] = useState<string>(defaults.category);
  const [caSource, setCaSource] = useState(defaults.caSource);
  const [measureDelta, setMeasureDelta] = useState("");
  const [result, setResult] = useState<ProposeResult | null>(null);

  const toggle = (ref: string) => setSelected((cur) => (cur.includes(ref) ? cur.filter((r) => r !== ref) : [...cur, ref]));
  const evidenceRefs = [...new Set([...selected, ...parseRefs(extraRefs)])];
  const numericCurrent = typeof currentValue === "number";
  const parsed = parseProposedValue(proposedValue);
  const lineDelta = kind === "value" && numericCurrent && typeof parsed === "number" ? parsed - currentValue : null;

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setResult(null);
        const r = await send("propose_adjustment", {
          targetRef,
          kind,
          proposedValue: kind === "value" ? parsed : undefined,
          proposedLabel: kind === "label" ? proposedLabel : undefined,
          reason,
          evidenceRefs,
          category: kind === "value" ? category : "none",
          measureDelta: kind === "value" && measureDelta.trim() !== "" ? Number(measureDelta) : undefined,
          caSource,
        });
        if (r.ok) {
          setResult(r.result as ProposeResult);
          setReason("");
          setProposedValue("");
          setMeasureDelta("");
        }
      }}
    >
      {!canPropose ? <p className="text-xs text-amber-800">A {actorRole} cannot propose adjustments; the server will refuse this.</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={label}>
          What changes
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as "value" | "label" | "evidence")}>
            <option value="value">The amount (value)</option>
            <option value="label">The description (label)</option>
            <option value="evidence">Only the evidence links</option>
          </select>
        </label>
        {kind === "value" ? (
          <label className={label}>
            Proposed value (now {formatLineValue(currentValue)})
            <input className={`${input} num`} required value={proposedValue} onChange={(e) => setProposedValue(e.target.value)} placeholder={numericCurrent ? "151,300" : "text"} />
            {lineDelta !== null ? (
              <span className="mt-0.5 block text-[11px] text-stone-500">
                Line change <span className="num">{signed(lineDelta)}</span>
              </span>
            ) : null}
          </label>
        ) : null}
        {kind === "label" ? (
          <label className={`${label} sm:col-span-2`}>
            Corrected description
            <input className={input} required maxLength={400} value={proposedLabel} onChange={(e) => setProposedLabel(e.target.value)} />
          </label>
        ) : null}
      </div>

      <label className={label}>
        Reason
        <textarea className={input} rows={2} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What the evidence shows and why the engine value should change" />
      </label>

      <fieldset>
        <legend className="text-xs text-stone-500">Evidence (at least one reference; unavailable or unresolved sources cannot be cited)</legend>
        {sources.length === 0 ? <p className="mt-1 text-xs text-stone-400">This line has no packet sources; cite evidence below.</p> : null}
        <ul className="mt-1 space-y-0.5">
          {sources.map((s) => (
            <li key={s.ref}>
              <label className={`flex items-start gap-2 text-xs ${s.found && s.available ? "text-stone-700" : "text-stone-400"}`}>
                <input type="checkbox" className="mt-0.5" checked={selected.includes(s.ref)} disabled={!s.found || !s.available} onChange={() => toggle(s.ref)} />
                <span>
                  {s.label} <span className="num text-stone-400">{s.ref}</span>
                  {!s.found ? " (unresolved)" : !s.available ? " (not yet available)" : ""}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <label className={`${label} mt-2`}>
          Additional references (comma separated, for example doc:D15#page3, ev-0103, call-01, qa-14)
          <input className={`${input} num`} value={extraRefs} onChange={(e) => setExtraRefs(e.target.value)} />
        </label>
      </fieldset>

      {kind === "value" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Tax effect category
            <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="mt-0.5 block text-[11px] text-stone-500">
              Categories refer to the economic measure, not the line: reducing an expense increases profit.
              {defaults.schcExpense ? " This is a Schedule C expense line, so the profit change is the opposite of the line change." : ""}
            </span>
          </label>
          <label className={label}>
            Measure change override (optional)
            <input className={`${input} num`} value={measureDelta} onChange={(e) => setMeasureDelta(e.target.value)} placeholder="signed amount, for example -12400" />
            <span className="mt-0.5 block text-[11px] text-stone-500">
              Leave blank to derive it from the line change. Set it when the line change is not the measure change (for example a lot where only the basis moved).
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-stone-700 sm:col-span-2">
            <input type="checkbox" className="mt-0.5" checked={caSource} onChange={(e) => setCaSource(e.target.checked)} />
            <span>
              Fully California-source during residency: use the California-source rate instead of the residency-day proration (for example a sale during residency or the Sacramento rental).
              {jurisdiction === "california" ? " This is a California line." : ""}
            </span>
          </label>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50">
          {pending ? "Saving" : "Propose adjustment"}
        </button>
        <span className="text-xs text-stone-400">The engine value stays as the baseline; nothing changes until a reviewer or partner accepts.</span>
      </div>
      <CommandErrorBox error={error} onDismiss={clearError} />

      {result ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p>
            Proposed as <span className="num">{result.adjustmentId}</span>.{" "}
            {result.requiresPartner ? (
              <span className="font-medium">Partner approval is required: the estimated effect is over the 1,000 threshold or unknown.</span>
            ) : (
              "A reviewer or partner can accept it."
            )}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <dt className="text-emerald-800">Est. federal tax</dt>
            <dd className="num">{signed(result.effect.federal)}</dd>
            <dt className="text-emerald-800">Est. California tax</dt>
            <dd className="num">{signed(result.effect.california)}</dd>
            <dt className="text-emerald-800">Federal balance due</dt>
            <dd className="num">{signed(result.effect.balanceFederal)}</dd>
            <dt className="text-emerald-800">California balance due</dt>
            <dd className="num">{signed(result.effect.balanceCalifornia)}</dd>
          </dl>
          <p className="mt-2 text-xs">
            Status <span className="font-medium">{result.effect.status}</span>: {result.effect.basis}
          </p>
          {result.effect.limitations.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {result.effect.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1 text-xs text-emerald-800">This is an estimate at the supplied per-dollar rates, not a recomputed return.</p>
        </div>
      ) : null}
    </form>
  );
}
