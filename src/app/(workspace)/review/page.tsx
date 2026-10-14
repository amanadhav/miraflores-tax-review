import Link from "next/link";
import { FindingFocus } from "@/components/finding-focus";
import { RaiseFindingForm } from "@/components/finding-forms";
import { FindingList } from "@/components/finding-list";
import { LineLots } from "@/components/line-lots";
import { LineTable } from "@/components/line-table";
import { SignoffPanel } from "@/components/signoff-panel";
import { dateOnly } from "@/lib/format";
import { areaView, type AreaSummary } from "@/server/queries/review";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function SignDots({ signoffs }: { signoffs: AreaSummary["signoffs"] }) {
  const tone = (s: "active" | "stale" | "none") => (s === "active" ? "bg-emerald-500" : s === "stale" ? "bg-amber-500" : "bg-stone-300");
  return (
    <span className="inline-flex items-center gap-1" title={`Sign-offs: preparer ${signoffs.preparer}, reviewer ${signoffs.reviewer}, partner ${signoffs.partner}`}>
      {(["preparer", "reviewer", "partner"] as const).map((l) => (
        <span key={l} className={`inline-block h-2 w-2 rounded-full ${tone(signoffs[l])}`} />
      ))}
    </span>
  );
}

/**
 * The review workspace: areas on the left, and for the selected area its
 * findings, sign-offs and lines. Every number opens its own inspector.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string; finding?: string; q?: string; page?: string }>;
}) {
  const ctx = await requireSessionContext();
  const sp = await searchParams;
  const v = await areaView(ctx, sp.area, { q: sp.q, page: Number(sp.page) || 1, finding: sp.finding });
  const focusId = sp.finding ?? null;
  const baseHref = `/review?area=${encodeURIComponent(v.area.id)}${v.query ? `&q=${encodeURIComponent(v.query)}` : ""}`;
  const selected = v.areas.find((a) => a.id === v.area.id)!;
  const shownLines = v.lines.length + (v.lots ? v.lots.totals.length + v.lots.lotCount : 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[270px_minmax(0,1fr)]">
      <FindingFocus findingId={focusId} />
      <aside className="space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">Review</h1>
        <nav className="space-y-1" aria-label="Review areas">
          {v.areas.map((a) => {
            const active = a.id === v.area.id;
            return (
              <Link
                key={a.id}
                href={`/review?area=${encodeURIComponent(a.id)}`}
                className={`block rounded border px-3 py-2 ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white hover:bg-stone-50"}`}
                aria-current={active ? "page" : undefined}
              >
                <div className="flex items-center justify-between gap-2 text-sm font-medium">
                  <span>{a.label}</span>
                  <SignDots signoffs={a.signoffs} />
                </div>
                <div className={`mt-0.5 flex flex-wrap gap-x-2 text-[11px] ${active ? "text-stone-300" : "text-stone-500"}`}>
                  <span className="num">{a.lines} lines</span>
                  <span className={a.blockers > 0 && !active ? "text-red-700" : ""}>
                    <span className="num">{a.openFindings}</span> open{a.blockers > 0 ? ` (${a.blockers} block)` : ""}
                  </span>
                  {a.proposed > 0 ? (
                    <span>
                      <span className="num">{a.proposed}</span> proposed
                    </span>
                  ) : null}
                  {a.accepted > 0 ? (
                    <span>
                      <span className="num">{a.accepted}</span> accepted
                    </span>
                  ) : null}
                  {a.stale > 0 ? (
                    <span className={active ? "" : "text-amber-700"}>
                      <span className="num">{a.stale}</span> stale
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </nav>
        <Link href="/review/assets" className="block px-3 py-1 text-xs text-blue-700 hover:underline">
          Depreciation by asset
        </Link>
      </aside>

      <div className="min-w-0 space-y-6">
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{v.area.label}</h2>
            <span className="text-xs text-stone-500">
              Replay clock <span className="num">{dateOnly(v.asOf)}</span>, revision <span className="num">{v.revision}</span>, acting as {v.actor.name} ({v.actor.role})
            </span>
          </div>
          <p className="mt-1 text-sm text-stone-600">{v.area.description}</p>
          <p className="mt-1 text-xs text-stone-500">
            <span className="num">{selected.lines}</span> lines, <span className="num">{selected.openFindings}</span> open findings
            {selected.blockers > 0 ? ` (${selected.blockers} block filing)` : ""}, <span className="num">{selected.proposed}</span> proposed,{" "}
            <span className="num">{selected.accepted}</span> accepted, <span className="num">{selected.stale}</span> stale.
          </p>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">
              Findings <span className="num text-sm font-normal text-stone-500">{v.openFindings} open of {v.findings.length}</span>
            </h3>
            <RaiseFindingForm areaId={v.area.id} areaLabel={v.area.label} revision={v.revision} canRaise={v.actor.canRaise} actorRole={v.actor.role} owners={v.owners} />
          </div>
          <div className="mt-3">
            <FindingList findings={v.findings} focusId={focusId} revision={v.revision} canResolve={v.actor.canResolve} actorRole={v.actor.role} />
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5">
          <h3 className="font-medium">Area sign-offs</h3>
          <div className="mt-3">
            <SignoffPanel panel={v.signoffs} revision={v.revision} />
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-3">
            <h3 className="font-medium">
              Lines{" "}
              <span className="num text-sm font-normal text-stone-500">
                {v.query ? `${shownLines} of ${v.lineCount} match` : v.lineCount}
              </span>
            </h3>
            <form method="get" action="/review" className="flex items-center gap-2">
              <input type="hidden" name="area" value={v.area.id} />
              <label htmlFor="q" className="text-xs text-stone-500">
                Search
              </label>
              <input id="q" name="q" defaultValue={v.query} placeholder="key or label" className="rounded border border-stone-300 px-2 py-1 text-sm" />
              <button type="submit" className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100">
                Filter
              </button>
              {v.query ? (
                <Link href={`/review?area=${encodeURIComponent(v.area.id)}`} className="text-xs text-blue-700 hover:underline">
                  clear
                </Link>
              ) : null}
            </form>
          </div>
          <LineTable
            rows={v.lines}
            empty={v.query ? (v.lots ? "No lines outside Form 8949 match the search." : "No lines match the search.") : "No lines in this area for the active version."}
          />
          {v.lots ? (
            <div className="border-t border-stone-200">
              <h4 className="px-5 pt-4 font-medium">Form 8949 lots</h4>
              <LineLots lots={v.lots} baseHref={baseHref} />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
