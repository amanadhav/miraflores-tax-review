"use client";

/**
 * Search entry. A plain GET form to /search so a result page has a shareable
 * address; the server filters results by permission and the replay clock and
 * refuses queries that are themselves sensitive values.
 */
export function SearchBox({ initialQuery = "", autoFocus = false, className }: { initialQuery?: string; autoFocus?: boolean; className?: string }) {
  return (
    <form action="/search" method="get" role="search" className={className ?? "flex items-center gap-2"}>
      <label htmlFor="search-q" className="sr-only">
        Search the workpaper
      </label>
      <input
        id="search-q"
        name="q"
        type="search"
        defaultValue={initialQuery}
        autoFocus={autoFocus}
        placeholder="Search documents, pages, values, lines, findings"
        className="w-64 max-w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm"
        minLength={2}
        maxLength={120}
      />
      <button type="submit" className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100">
        Search
      </button>
    </form>
  );
}
