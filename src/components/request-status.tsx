/** Status pill for a request (open, answered, resolved, withdrawn) with an overdue marker judged at the replay clock. */
export function RequestStatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  const tone =
    status === "open" ? "bg-amber-100 text-amber-800" : status === "answered" ? "bg-blue-100 text-blue-800" : status === "resolved" ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`rounded px-1.5 py-0.5 text-xs ${tone}`}>{status}</span>
      {overdue ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">overdue</span> : null}
    </span>
  );
}
