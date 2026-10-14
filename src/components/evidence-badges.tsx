import type { LineStatus } from "@/domain/effective";
import type { Disposition } from "@/server/queries/evidence";

export function DispositionBadge({ disposition, label }: { disposition: Disposition; label: string }) {
  const tone =
    disposition === "used"
      ? "bg-emerald-100 text-emerald-800"
      : disposition === "superseded"
        ? "bg-amber-100 text-amber-800"
        : disposition === "not_yet_available"
          ? "bg-stone-200 text-stone-700"
          : disposition === "not_extracted"
            ? "bg-stone-100 text-stone-600"
            : "bg-rose-100 text-rose-800";
  return <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${tone}`}>{label}</span>;
}

export function LineStatusBadge({ status }: { status: LineStatus | "missing" }) {
  const tone =
    status === "baseline"
      ? "bg-stone-100 text-stone-600"
      : status === "adjusted"
        ? "bg-blue-100 text-blue-800"
        : status === "recomputed"
          ? "bg-emerald-100 text-emerald-800"
          : status === "stale"
            ? "bg-amber-100 text-amber-800"
            : "bg-rose-100 text-rose-800";
  return <span className={`rounded px-1.5 py-0.5 text-xs ${tone}`}>{status}</span>;
}

export function RecordStatusBadge({ status }: { status: string }) {
  const tone =
    status === "accepted" || status === "agrees" || status === "resolved"
      ? "bg-emerald-100 text-emerald-800"
      : status === "rejected" || status === "disagrees" || status === "dismissed"
        ? "bg-rose-100 text-rose-800"
        : status === "open" || status === "proposed" || status === "unresolved"
          ? "bg-amber-100 text-amber-800"
          : "bg-stone-100 text-stone-600";
  return <span className={`rounded px-1.5 py-0.5 text-xs ${tone}`}>{status.replace(/_/g, " ")}</span>;
}
