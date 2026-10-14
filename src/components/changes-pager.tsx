import Link from "next/link";

/** Previous / next links for a server-paginated list. `hrefFor` builds the URL for a page number. */
export function Pager({ page, pageCount, total, pageSize, hrefFor, noun }: { page: number; pageCount: number; total: number; pageSize: number; hrefFor: (page: number) => string; noun: string }) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
      <span>
        {noun} <span className="num">{first}</span> to <span className="num">{last}</span> of <span className="num">{total}</span>, page <span className="num">{page}</span> of{" "}
        <span className="num">{pageCount}</span>
      </span>
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="text-blue-700 hover:underline">
          previous
        </Link>
      ) : null}
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} className="text-blue-700 hover:underline">
          next
        </Link>
      ) : null}
    </div>
  );
}

/** Build a query string from the given params, dropping blanks, so pager links keep the current filters. */
export function withParams(path: string, params: Record<string, string | number | undefined>, hash?: string): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || v === null) continue;
    q.set(k, String(v));
  }
  const qs = q.toString();
  return `${path}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}
