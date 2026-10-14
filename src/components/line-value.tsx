import type { LineStatus } from "@/domain/effective";
import type { LineValue } from "@/server/queries/review";

/** Format a return line value: money for whole or cent amounts, ratios to four places, text as is. */
export function formatLineValue(value: LineValue | undefined): string {
  if (value === null || value === undefined) return "blank";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    const abs = Math.abs(value);
    const ratio = abs < 1 && abs !== 0 && !Number.isInteger(value);
    const digits = ratio ? 4 : Number.isInteger(value) ? 0 : 2;
    const text = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return value < 0 ? `(${text})` : text;
  }
  return String(value);
}

export const STATUS_LABEL: Record<LineStatus, string> = {
  baseline: "baseline",
  adjusted: "adjusted",
  recomputed: "recomputed",
  stale: "stale",
};

const STATUS_TONE: Record<LineStatus, string> = {
  baseline: "bg-stone-100 text-stone-700",
  adjusted: "bg-blue-100 text-blue-800",
  recomputed: "bg-emerald-100 text-emerald-800",
  stale: "bg-amber-100 text-amber-800",
};

/**
 * Status badge for a line. The reason is always available on hover; for
 * recomputed and stale lines the changed inputs can also be shown inline.
 */
export function LineStatusBadge({
  status,
  reason,
  changedInputs,
  inline = false,
}: {
  status: LineStatus;
  reason: string;
  changedInputs?: { key: string; label: string }[];
  inline?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[status]}`} title={reason}>
        {STATUS_LABEL[status]}
      </span>
      {inline && changedInputs && changedInputs.length > 0 ? (
        <span className="text-xs text-stone-500" title={reason}>
          {status === "stale" ? "input changed: " : "from: "}
          {changedInputs.map((c, i) => (
            <span key={c.key}>
              {i > 0 ? ", " : ""}
              <span className="num">{c.key}</span>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function SeverityBadge({ severity, blocksFiling }: { severity: string; blocksFiling: boolean }) {
  const tone = severity === "blocker" ? "bg-red-100 text-red-800" : severity === "warning" ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-700";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`rounded px-2 py-0.5 text-xs ${tone}`}>{severity}</span>
      {blocksFiling ? <span className="rounded border border-red-300 px-1.5 py-0.5 text-xs text-red-700">blocks filing</span> : null}
    </span>
  );
}

export function SignoffStatusBadge({ status }: { status: string }) {
  if (status === "active") return <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">active</span>;
  if (status === "stale") return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">reopened</span>;
  return <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{status}</span>;
}

export function AdjustmentStatusBadge({ status }: { status: string }) {
  const tone =
    status === "accepted"
      ? "bg-emerald-100 text-emerald-800"
      : status === "proposed"
        ? "bg-blue-100 text-blue-800"
        : status === "rejected"
          ? "bg-red-100 text-red-800"
          : "bg-stone-100 text-stone-600";
  return <span className={`rounded px-2 py-0.5 text-xs ${tone}`}>{status}</span>;
}
