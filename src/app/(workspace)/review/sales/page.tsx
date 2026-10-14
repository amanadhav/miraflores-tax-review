import Link from "next/link";
import { RaiseFindingForm } from "@/components/finding-forms";
import { RefLink } from "@/components/ref-link";
import { BoxSummaryTable, LotGroups } from "@/components/recordsb-lots";
import { LineRows, Panel, RecordHeader } from "@/components/recordsb-shell";
import { money } from "@/lib/format";
import { salesView } from "@/server/queries/records-b";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

/**
 * Form 8949 and Schedule D as a CPA reads them: box totals first, then every
 * lot grouped by broker account with search and paging, then the Schedule D
 * lines and the capital loss carryovers.
 */
export default async function SalesPage({ searchParams }: { searchParams: Promise<{ group?: string; page?: string; q?: string }> }) {
  const ctx = await requireSessionContext();
  const sp = await searchParams;
  const v = await salesView(ctx, { group: sp.group, page: Number(sp.page) || 1, q: sp.q });

  return (
    <div className="space-y-6">
      <RecordHeader
        title="Sales of capital assets"
        lead="Form 8949 lots by broker account, box totals, Schedule D and the capital loss carryovers. Every lot links to its inspector; evidence the pipeline missed is called out where it is printed."
        header={v}
        current="/review/sales"
      />

      <Panel id="boxes" title="Form 8949 box totals" hint="One row per box present in the active version, in box order. Short-term boxes carry to Schedule D Part I, long-term to Part II.">
        <BoxSummaryTable boxes={v.boxes} />
      </Panel>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">
            Lots by broker account <span className="num text-sm font-normal text-stone-500">{v.query ? `${v.matched} of ${v.lotCount} match` : `${v.lotCount} lots`}</span>
          </h2>
          <form method="get" action="/review/sales" className="flex items-center gap-2">
            <label htmlFor="q" className="text-xs text-stone-500">
              Search lot id or description
            </label>
            <input id="q" name="q" defaultValue={v.query} placeholder="X12, M18, Pinecrest" className="rounded border border-stone-300 px-2 py-1 text-sm" />
            <button type="submit" className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100">
              Filter
            </button>
            {v.query ? (
              <Link href="/review/sales" className="text-xs text-blue-700 hover:underline">
                clear
              </Link>
            ) : null}
          </form>
        </div>
        <LotGroups view={v} />
      </section>

      <Panel id="schedule-d" title="Schedule D" hint="Lines in packet order. Carryovers into 2025 come from the prior-year records; carryovers out are the engine's for the active version.">
        <LineRows lines={v.schD} />
        <div className="mt-4 grid gap-4 text-sm lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Carried into 2025</h3>
            <ul className="mt-1 space-y-0.5 text-xs">
              {v.carryovers.into.map((c) => (
                <li key={c.ref.ref} className="flex flex-wrap items-baseline gap-2">
                  <span>{c.label}</span>
                  <span className="num font-medium">{c.amount === null ? "unknown" : money(c.amount)}</span>
                  <RefLink refId={c.ref.ref} label={c.ref.label} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Carried out of 2025</h3>
            <ul className="mt-1 space-y-0.5 text-xs">
              {v.carryovers.out.map((c) => (
                <li key={c.label} className="flex flex-wrap items-baseline gap-2">
                  <span>{c.label}</span>
                  <span className="num font-medium">{c.amount === null ? "not supplied" : money(c.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel id="raise" title="Raise a finding" hint="Findings raised here land in the investments area with the refs you list.">
        <RaiseFindingForm areaId={v.area.id} areaLabel={v.area.label} revision={v.revision} canRaise={v.actor.canRaise} actorRole={v.actor.role} owners={v.owners} />
      </Panel>
    </div>
  );
}
