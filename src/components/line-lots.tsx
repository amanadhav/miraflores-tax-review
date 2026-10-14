import Link from "next/link";
import { LineRow, LineTableHead } from "@/components/line-table";
import { formatLineValue, LineStatusBadge } from "@/components/line-value";
import type { LotsView } from "@/server/queries/review";

function pageHref(base: string, page: number): string {
  return `${base}&page=${page}`;
}

/**
 * Form 8949 lots grouped by box with the box totals first and fifty lots per
 * page, so a 300-lot schedule can be reviewed box by box.
 */
export function LineLots({ lots, baseHref }: { lots: LotsView; baseHref: string }) {
  return (
    <div className="space-y-4">
      {lots.totals.length > 0 ? (
        <div>
          <h4 className="px-3 pt-3 text-xs font-medium text-stone-500 uppercase tracking-wide">Box totals</h4>
          <table className="w-full text-sm">
            <LineTableHead />
            <tbody>
              {lots.totals.map((t) => (
                <LineRow key={t.key} row={t} showForm={false} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 text-xs text-stone-500">
        <span>
          {lots.lotCount === 0 ? "No lots match." : `Lots ${lots.from} to ${lots.to} of ${lots.lotCount}, grouped by box, ${lots.pageSize} per page.`}
        </span>
        {lots.pageCount > 1 ? (
          <nav className="flex items-center gap-1" aria-label="Lot pages">
            {lots.page > 1 ? (
              <Link href={pageHref(baseHref, lots.page - 1)} className="rounded border border-stone-300 px-2 py-0.5 hover:bg-stone-100">
                previous
              </Link>
            ) : null}
            {Array.from({ length: lots.pageCount }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={pageHref(baseHref, p)}
                className={`num rounded px-2 py-0.5 ${p === lots.page ? "bg-stone-800 text-white" : "border border-stone-300 hover:bg-stone-100"}`}
                aria-current={p === lots.page ? "page" : undefined}
              >
                {p}
              </Link>
            ))}
            {lots.page < lots.pageCount ? (
              <Link href={pageHref(baseHref, lots.page + 1)} className="rounded border border-stone-300 px-2 py-0.5 hover:bg-stone-100">
                next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>

      {lots.groups.map((g) => (
        <section key={g.box} id={`box-${g.box}`} className="border-t border-stone-200">
          <div className="flex flex-wrap items-baseline justify-between gap-2 bg-stone-50 px-3 py-2">
            <div>
              <span className="font-medium">{g.label}</span>
              <span className="ml-2 text-xs text-stone-500">
                {g.holdingLabel}; {g.lotCount} lot{g.lotCount === 1 ? "" : "s"}
                {g.lotCount > g.lots.length ? `, showing ${g.from} to ${g.to}` : ""}
              </span>
            </div>
            <div className="text-xs text-stone-600">
              {g.total ? (
                <span className="inline-flex items-center gap-2">
                  <span>
                    Box total <span className="num font-medium">{formatLineValue(g.total.effective)}</span>
                  </span>
                  <LineStatusBadge status={g.total.status} reason={g.total.statusReason} />
                </span>
              ) : g.totalKey ? (
                <Link href={`/review/line/${encodeURIComponent(g.totalKey)}`} className="text-blue-700 hover:underline" title={g.totalLabel ?? g.totalKey}>
                  Box total <span className="num">{g.totalKey}</span> is in Investments and digital assets
                </Link>
              ) : (
                <span className="text-stone-400">no box total line in this version</span>
              )}
            </div>
          </div>
          <table className="w-full text-sm">
            <LineTableHead />
            <tbody>
              {g.lots.map((r) => (
                <LineRow key={r.key} row={r} showForm={false} />
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
