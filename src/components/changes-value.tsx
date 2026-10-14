import { money } from "@/lib/format";

/** Plain-text rendering of a line value, an adjustment value or audit metadata. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "blank";
  if (typeof value === "number") return money(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatValue(v)}`)
      .join("; ");
  }
  return String(value);
}

export function Value({ value, className }: { value: unknown; className?: string }) {
  const numeric = typeof value === "number";
  return <span className={className ?? (numeric ? "num" : "")}>{formatValue(value)}</span>;
}

/** Compact "key: value" pairs for before/after audit metadata; nested objects are flattened one level. */
export function MetaPairs({ label, data }: { label: string; data: Record<string, unknown> | null }) {
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <div className="mt-1 text-xs text-stone-600">
      <span className="mr-1 rounded bg-stone-100 px-1 py-0.5 text-[11px] uppercase tracking-wide text-stone-500">{label}</span>
      {Object.entries(data).map(([k, v], i) => (
        <span key={k}>
          {i > 0 ? <span className="text-stone-400"> | </span> : null}
          <span className="text-stone-500">{k}:</span> <Value value={v} className={typeof v === "number" ? "num" : ""} />
        </span>
      ))}
    </div>
  );
}
