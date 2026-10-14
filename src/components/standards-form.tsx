"use client";

import { useState } from "react";
import { CommandErrorBox, useCommand } from "@/components/command-client";

const input = "mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm";
const label = "block text-xs text-stone-500";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50";
const secondary = "rounded border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50";

export interface StandardsDraft {
  rules: string[];
  requiredSteps: string[];
  verificationTypes: string[];
  reviewLevels: string[];
  variance: { compareTo: string; percent: number; amount: number };
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Publish a new version of the firm standards (command update_standards).
 * Lists are edited one item per line. Publishing reopens every active
 * sign-off and client approval, because they were given under the old version.
 */
export function StandardsEditForm({ revision, canEdit, actorRole, current, activeSignoffs, activeApprovals }: { revision: number; canEdit: boolean; actorRole: string; current: StandardsDraft; activeSignoffs: number; activeApprovals: number }) {
  const { send, pending, error, clearError } = useCommand(revision);
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState(current.rules.join("\n"));
  const [steps, setSteps] = useState(current.requiredSteps.join("\n"));
  const [types, setTypes] = useState(current.verificationTypes.join("\n"));
  const [levels, setLevels] = useState(current.reviewLevels.join("\n"));
  const [compareTo, setCompareTo] = useState(current.variance.compareTo);
  const [percent, setPercent] = useState(String(current.variance.percent));
  const [amount, setAmount] = useState(String(current.variance.amount));
  const [note, setNote] = useState("");
  const [published, setPublished] = useState<number | null>(null);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondary} onClick={() => setOpen(true)} disabled={!canEdit}>
          Edit and publish a new version
        </button>
        {!canEdit ? <span className="text-xs text-stone-500">Only the firm administrator changes standards; a {actorRole} cannot.</span> : null}
        {published ? <span className="text-xs text-emerald-700">Version {published} is now in force.</span> : null}
      </div>
    );
  }

  const nextVariance = { compare_to: compareTo.trim(), flag_if_change_over_percent: Number(percent), and_over_amount: Number(amount) };
  const varianceChanged = nextVariance.compare_to !== current.variance.compareTo || nextVariance.flag_if_change_over_percent !== current.variance.percent || nextVariance.and_over_amount !== current.variance.amount;

  return (
    <form
      className="space-y-3 rounded border border-stone-200 bg-stone-50 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const payload: Record<string, unknown> = { note };
        const r1 = lines(rules);
        const r2 = lines(steps);
        const r3 = lines(types);
        const r4 = lines(levels);
        if (!same(r1, current.rules)) payload.rules = r1;
        if (!same(r2, current.requiredSteps)) payload.requiredSteps = r2;
        if (!same(r3, current.verificationTypes)) payload.verificationTypes = r3;
        if (!same(r4, current.reviewLevels)) payload.reviewLevels = r4;
        if (varianceChanged) payload.varianceReview = nextVariance;
        const summary = `Publish a new standards version?\n\nThis reopens ${activeSignoffs} active sign-off(s) and ${activeApprovals} client approval(s): each was given under the current version and must be given again.`;
        if (!window.confirm(summary)) return;
        const r = await send("update_standards", payload);
        if (r.ok) {
          setPublished((r.result as { version: number }).version);
          setNote("");
          setOpen(false);
        }
      }}
    >
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
        <p className="font-medium">Publishing reopens every active sign-off and client approval.</p>
        <p className="mt-1 text-xs">
          Sign-offs and approvals are fingerprinted over the standard in force. A new version changes that fingerprint, so {activeSignoffs} active sign-off(s) and {activeApprovals} client approval(s) will be marked reopened with the reason
          &quot;the firm standard in force changed&quot;. Nothing is deleted; each has to be given again under the new version. The old version stays in the history.
        </p>
      </div>
      {!canEdit ? <p className="text-xs text-amber-800">A {actorRole} cannot change standards; the server will refuse this.</p> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <label className={label}>
          Rules (one per line)
          <textarea className={input} rows={9} value={rules} onChange={(e) => setRules(e.target.value)} />
        </label>
        <label className={label}>
          Required steps before filing (one per line, in order)
          <textarea className={input} rows={9} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </label>
        <label className={label}>
          Verification types (one per line; these are the methods a verification may name)
          <textarea className={`${input} num`} rows={6} value={types} onChange={(e) => setTypes(e.target.value)} />
        </label>
        <label className={label}>
          Review levels (one per line)
          <textarea className={input} rows={6} value={levels} onChange={(e) => setLevels(e.target.value)} />
        </label>
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="text-xs text-stone-500">Variance review: flag a line that moved more than both thresholds against the comparison</legend>
        <label className={label}>
          Compare to
          <input className={input} value={compareTo} onChange={(e) => setCompareTo(e.target.value)} required />
        </label>
        <label className={label}>
          Percent change over
          <input type="number" className={`${input} num`} min={0} step={0.5} value={percent} onChange={(e) => setPercent(e.target.value)} required />
        </label>
        <label className={label}>
          And amount over
          <input type="number" className={`${input} num`} min={0} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
      </fieldset>
      <label className={label}>
        Note for this version (what changed and why; shown in the history)
        <textarea className={input} rows={2} required minLength={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Publishing" : "Publish new version"}
        </button>
        <button type="button" className={secondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <CommandErrorBox error={error} onDismiss={clearError} />
    </form>
  );
}
