import Link from "next/link";
import { formatLineValue, LineStatusBadge } from "@/components/line-value";
import type { LineRowView } from "@/server/queries/review";

function lineHref(key: string): string {
  return `/review/line/${encodeURIComponent(key)}`;
}

export function LineRow({ row, showForm = true }: { row: LineRowView; showForm?: boolean }) {
  const changed = row.baseline !== row.effective;
  return (
    <tr id={row.key} className="border-t border-stone-100 align-top hover:bg-stone-50">
      <td className="px-3 py-1.5">
        <Link href={lineHref(row.key)} className="font-medium hover:underline">
          {row.label}
        </Link>
        <div className="num text-[11px] text-stone-500">
          {row.key}
          {showForm ? ` (${row.form} line ${row.line})` : ""}
        </div>
      </td>
      <td className="num px-3 py-1.5 text-right whitespace-nowrap text-stone-500">{formatLineValue(row.baseline)}</td>
      <td className={`num px-3 py-1.5 text-right whitespace-nowrap ${changed ? "font-medium" : ""}`}>{formatLineValue(row.effective)}</td>
      <td className="px-3 py-1.5">
        <LineStatusBadge status={row.status} reason={row.statusReason} changedInputs={row.changedInputs} inline />
      </td>
      <td className="px-3 py-1.5 text-xs text-stone-600">{row.jurisdiction === "california" ? "CA" : "Fed"}</td>
      <td className="num px-3 py-1.5 text-right text-xs">
        {row.pendingProposals > 0 ? (
          <Link href={`${lineHref(row.key)}#history`} className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800 hover:underline">
            {row.pendingProposals}
          </Link>
        ) : (
          <span className="text-stone-300">0</span>
        )}
        {row.openFindings > 0 ? (
          <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800" title={`${row.openFindings} open finding(s) reference this line`}>
            {row.openFindings} finding{row.openFindings === 1 ? "" : "s"}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

export function LineTableHead() {
  return (
    <thead className="text-left text-xs text-stone-500">
      <tr>
        <th className="px-3 py-2 font-normal">Line</th>
        <th className="px-3 py-2 text-right font-normal">Baseline</th>
        <th className="px-3 py-2 text-right font-normal">Effective</th>
        <th className="px-3 py-2 font-normal">Status</th>
        <th className="px-3 py-2 font-normal">Juris.</th>
        <th className="px-3 py-2 text-right font-normal">Pending</th>
      </tr>
    </thead>
  );
}

/** Plain lines table for an area; Form 8949 lots are rendered separately. */
export function LineTable({ rows, empty }: { rows: LineRowView[]; empty: string }) {
  if (rows.length === 0) return <p className="px-3 py-4 text-sm text-stone-500">{empty}</p>;
  return (
    <table className="w-full text-sm">
      <LineTableHead />
      <tbody>
        {rows.map((r) => (
          <LineRow key={r.key} row={r} />
        ))}
      </tbody>
    </table>
  );
}
