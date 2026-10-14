import { RefLink } from "@/components/ref-link";
import { SearchBox } from "@/components/search-box";
import { search, type SearchHit, type SearchHitType } from "@/server/queries/search";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

const GROUPS: { type: SearchHitType; label: string }[] = [
  { type: "document", label: "Documents" },
  { type: "page", label: "Printed pages" },
  { type: "value", label: "Extracted values" },
  { type: "line", label: "Return lines" },
  { type: "finding", label: "Findings" },
  { type: "adjustment", label: "Changes" },
  { type: "client", label: "Client answers, messages and calls" },
];

/**
 * Search results grouped by type. Everything here was redacted and filtered
 * on the server; the page only lays it out and links each hit to its home.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const ctx = await requireSessionContext();
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const q = (raw ?? "").slice(0, 200);
  const result = q.trim() ? await search(ctx, q) : null;
  const byType = new Map<SearchHitType, SearchHit[]>();
  for (const hit of result?.hits ?? []) {
    const list = byType.get(hit.type);
    if (list) list.push(hit);
    else byType.set(hit.type, [hit]);
  }
  return (
    <div className="max-w-4xl space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="mt-1 text-sm text-stone-600">
          Matches what you are allowed to see, as it was available on {ctx.workspace.asOf.slice(0, 10)}. Sensitive values stay masked and
          cannot be searched for.
        </p>
        <SearchBox initialQuery={result?.query ?? ""} autoFocus className="mt-3 flex items-center gap-2" />
      </section>

      {result?.message ? (
        <p className={`rounded border p-3 text-sm ${result.refused ? "border-red-200 bg-red-50 text-red-800" : "border-stone-200 bg-white text-stone-600"}`} role="status">
          {result.message}
        </p>
      ) : null}

      {result && result.hits.length > 0 ? (
        <p className="text-xs text-stone-500">
          {result.hits.length} result(s){Object.keys(result.more).length ? `, more exist in ${Object.keys(result.more).length} group(s)` : ""}; limited to 20 per
          group.
        </p>
      ) : null}

      {GROUPS.map((g) => {
        const hits = byType.get(g.type);
        if (!hits?.length) return null;
        const extra = result?.more[g.type];
        return (
          <section key={g.type} className="rounded-lg border border-stone-200 bg-white">
            <div className="flex items-baseline justify-between border-b border-stone-200 px-5 py-3">
              <h2 className="font-medium">{g.label}</h2>
              <span className="text-xs text-stone-500">
                {hits.length}
                {extra ? ` shown, ${extra} more` : ""}
              </span>
            </div>
            <ul className="divide-y divide-stone-100">
              {hits.map((h) => (
                <li key={`${h.type}:${h.ref}`} className="px-5 py-2 text-sm">
                  <Hit hit={h} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Hit({ hit }: { hit: SearchHit }) {
  switch (hit.type) {
    case "document":
      return (
        <div>
          <RefLink refId={hit.ref} label={`${hit.documentId}: ${hit.title}`} className="font-medium text-blue-700 hover:underline" />
          <div className="text-xs text-stone-500">{hit.snippet}</div>
        </div>
      );
    case "page":
      return (
        <div>
          <RefLink refId={hit.ref} label={hit.title} className="font-medium text-blue-700 hover:underline" />
          <div className="mt-0.5 whitespace-pre-wrap text-xs text-stone-600">{hit.snippet}</div>
        </div>
      );
    case "value":
      return (
        <div className="flex flex-wrap items-baseline gap-x-3">
          <RefLink refId={hit.ref} label={hit.label} className="font-medium text-blue-700 hover:underline" />
          <span className="num">{hit.value}</span>
          <span className="text-xs text-stone-500">
            {hit.valueId}, {hit.documentId} page {hit.page}, field {hit.field.replace(/_/g, " ")}
          </span>
        </div>
      );
    case "line":
      return (
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <RefLink refId={hit.ref} label={hit.title} className="font-medium text-blue-700 hover:underline" />
            <span className="num">{hit.value}</span>
            <span className="num text-xs text-stone-500">{hit.key}</span>
          </div>
          {hit.via ? <div className="text-xs text-stone-500">{hit.via}</div> : <div className="text-xs text-stone-600">{hit.snippet}</div>}
        </div>
      );
    case "finding":
      return (
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <RefLink refId={hit.ref} label={hit.title} className="font-medium text-blue-700 hover:underline" />
            <span className="text-xs text-stone-500">
              {hit.severity}, {hit.status}
            </span>
          </div>
          <div className="text-xs text-stone-600">{hit.snippet}</div>
        </div>
      );
    case "adjustment":
      return (
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <RefLink refId={hit.ref} label={hit.title} className="font-medium text-blue-700 hover:underline" />
            <RefLink refId={hit.target} />
          </div>
          <div className="text-xs text-stone-600">{hit.snippet}</div>
        </div>
      );
    case "client":
      return (
        <div>
          <RefLink refId={hit.ref} label={hit.title} className="font-medium text-blue-700 hover:underline" />
          <div className="text-xs text-stone-600">{hit.snippet}</div>
        </div>
      );
  }
}
