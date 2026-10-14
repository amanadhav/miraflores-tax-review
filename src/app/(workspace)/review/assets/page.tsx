import Link from "next/link";
import { RefInline } from "@/components/line-refs";
import { money } from "@/lib/format";
import { assetsView } from "@/server/queries/review";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function amount(v: number | null): string {
  return v === null ? "n/a" : money(v, { cents: true });
}

/**
 * Depreciation by asset for the active version, with each asset's prior-year
 * history. Element ids equal the asset ids so asset:<id> references land here.
 */
export default async function AssetsPage() {
  const ctx = await requireSessionContext();
  const v = await assetsView(ctx);
  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs text-stone-500">
          <Link href="/review" className="hover:underline">
            Review
          </Link>{" "}
          / Depreciation by asset
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Depreciation by asset</h1>
        <p className="mt-1 text-sm text-stone-600">
          {v.assets.length} assets in return version <span className="num">{v.version}</span> computed {v.computedAt.slice(0, 10)}. Figures are the engine&apos;s as
          supplied; the workpaper does not recompute depreciation.
        </p>
      </section>

      <section className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="px-3 py-2 font-normal">Asset</th>
              <th className="px-3 py-2 text-right font-normal">Cost</th>
              <th className="px-3 py-2 text-right font-normal">Land (not depreciated)</th>
              <th className="px-3 py-2 font-normal">In service</th>
              <th className="px-3 py-2 font-normal">Method / life</th>
              <th className="px-3 py-2 text-right font-normal">Federal 2025</th>
              <th className="px-3 py-2 text-right font-normal">California 2025</th>
              <th className="px-3 py-2 text-right font-normal">AMT 2025</th>
              <th className="px-3 py-2 font-normal">Disposed</th>
            </tr>
          </thead>
          <tbody>
            {v.assets.map((a) => (
              <tr key={a.id} className="border-t border-stone-100">
                <td className="px-3 py-1.5">
                  <a href={`#${a.id}`} className="font-medium hover:underline">
                    {a.description}
                  </a>
                  <div className="num text-[11px] text-stone-500">{a.id}</div>
                </td>
                <td className="num px-3 py-1.5 text-right">{money(a.cost)}</td>
                <td className="num px-3 py-1.5 text-right">{a.landValue === null ? "n/a" : money(a.landValue)}</td>
                <td className="num px-3 py-1.5">{a.placedInService}</td>
                <td className="px-3 py-1.5 text-xs">
                  {a.method}, <span className="num">{a.lifeYears}</span> yrs
                </td>
                <td className="num px-3 py-1.5 text-right">{amount(a.federal.depreciation2025)}</td>
                <td className="num px-3 py-1.5 text-right">{amount(a.california.depreciation2025)}</td>
                <td className="num px-3 py-1.5 text-right">{amount(a.amt.depreciation2025)}</td>
                <td className="num px-3 py-1.5 text-xs">{a.disposed ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {v.assets.map((a) => (
          <section key={a.id} id={a.id} className="rounded-lg border border-stone-200 bg-white p-5">
            <h2 className="font-medium">{a.description}</h2>
            <p className="text-xs text-stone-500">
              <span className="num">{a.id}</span>, {a.activity}
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-stone-500">Cost</dt>
              <dd className="num">{money(a.cost)}</dd>
              <dt className="text-stone-500">Land not depreciated</dt>
              <dd className="num">{a.landValue === null ? "n/a" : money(a.landValue)}</dd>
              <dt className="text-stone-500">Placed in service</dt>
              <dd className="num">{a.placedInService}</dd>
              <dt className="text-stone-500">Method, life</dt>
              <dd>
                {a.method}, <span className="num">{a.lifeYears}</span> years
              </dd>
              <dt className="text-stone-500">Sources</dt>
              <dd>
                <RefInline items={a.sources} />
              </dd>
            </dl>

            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="py-1 font-normal"></th>
                  <th className="py-1 text-right font-normal">Prior accumulated</th>
                  <th className="py-1 text-right font-normal">2025</th>
                  <th className="py-1 text-right font-normal">Accumulated end</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-stone-100">
                  <td className="py-1">Federal</td>
                  <td className="num py-1 text-right">{amount(a.federal.priorAccumulated)}</td>
                  <td className="num py-1 text-right">{amount(a.federal.depreciation2025)}</td>
                  <td className="num py-1 text-right">{amount(a.federal.accumulatedEnd)}</td>
                </tr>
                <tr className="border-t border-stone-100">
                  <td className="py-1">California</td>
                  <td className="num py-1 text-right">{amount(a.california.priorAccumulated)}</td>
                  <td className="num py-1 text-right">{amount(a.california.depreciation2025)}</td>
                  <td className="num py-1 text-right">{amount(a.california.accumulatedEnd)}</td>
                </tr>
                <tr className="border-t border-stone-100">
                  <td className="py-1">AMT</td>
                  <td className="py-1 text-right text-xs text-stone-400">n/a</td>
                  <td className="num py-1 text-right">{amount(a.amt.depreciation2025)}</td>
                  <td className="py-1 text-right text-xs text-stone-500">
                    difference from regular <span className="num">{amount(a.amt.differenceFromRegular)}</span>
                  </td>
                </tr>
              </tbody>
            </table>

            {a.disposed ? (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-900">
                  Disposed <span className="num">{a.disposed}</span>
                </p>
                {a.disposition.length > 0 ? (
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs text-amber-900">
                    {a.disposition.map((d) => (
                      <div key={d.label} className="contents">
                        <dt>{d.label}</dt>
                        <dd className="num">{d.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            ) : null}

            <h3 className="mt-4 text-xs font-medium text-stone-500 uppercase tracking-wide">Prior-year history</h3>
            {a.prior ? (
              <div className="mt-1">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-stone-500">
                    <tr>
                      <th className="py-1 font-normal">Year</th>
                      <th className="py-1 text-right font-normal">Federal</th>
                      <th className="py-1 text-right font-normal">California</th>
                      <th className="py-1 text-right font-normal">AMT difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.prior.years.map((y) => (
                      <tr key={y.year} className="border-t border-stone-100">
                        <td className="num py-1">{y.year}</td>
                        <td className="num py-1 text-right">{amount(y.federal)}</td>
                        <td className="num py-1 text-right">{amount(y.california)}</td>
                        <td className="num py-1 text-right">{y.amtDifference === null ? "" : amount(y.amtDifference)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-xs text-stone-500">
                  Prior record: {a.prior.method}, cost <span className="num">{money(a.prior.cost)}</span>, in service <span className="num">{a.prior.placedInService}</span>; source{" "}
                  {a.prior.sources.join(", ") || "not stated"}.
                </p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-stone-500">No prior-year record: placed in service in 2025.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
