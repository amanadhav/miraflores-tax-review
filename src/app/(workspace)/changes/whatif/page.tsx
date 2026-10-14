import Link from "next/link";
import { Pager, withParams } from "@/components/changes-pager";
import { Value } from "@/components/changes-value";
import { RefLink } from "@/components/ref-link";
import { dateTime, money, signed } from "@/lib/format";
import { requireSessionContext } from "@/server/request";
import { whatIfView } from "@/server/queries/changes";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const FEDERAL_KEYS = ["agi", "taxable_income", "total_tax", "payments", "balance_due", "penalty"];
const CALIFORNIA_KEYS = ["total_agi", "ca_agi", "total_tax", "payments", "balance_due", "penalty"];

function BaseVsAlternative({ title, keys, base, alternative }: { title: string; keys: string[]; base: Record<string, number>; alternative: Record<string, number> }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-stone-500">
        <tr>
          <th className="px-3 py-2 font-normal">{title}</th>
          <th className="px-3 py-2 font-normal">Base</th>
          <th className="px-3 py-2 font-normal">Alternative</th>
          <th className="px-3 py-2 font-normal">Difference</th>
        </tr>
      </thead>
      <tbody>
        {keys
          .filter((k) => k in base || k in alternative)
          .map((k) => {
            const b = base[k];
            const a = alternative[k];
            const diff = typeof a === "number" && typeof b === "number" ? a - b : null;
            return (
              <tr key={k} className="border-t border-stone-100">
                <td className="px-3 py-1.5">{k.replace(/_/g, " ")}</td>
                <td className="num px-3 py-1.5">{money(b)}</td>
                <td className="num px-3 py-1.5">{money(a)}</td>
                <td className={`num px-3 py-1.5 ${diff ? "font-medium" : "text-stone-400"}`}>{diff === null ? "" : signed(diff)}</td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}

export default async function WhatIfPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireSessionContext();
  const sp = await searchParams;
  const altId = one(sp.alt) ?? null;
  const page = Number(one(sp.page) ?? 1) || 1;
  const w = await whatIfView(ctx, altId, page);
  const sel = w.selected;
  const ext = w.extension;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">What-ifs</h1>
        <p className="mt-1 text-sm text-stone-600">
          Five alternatives the engine computed and supplied with the packet. Each is an isolated branch of its base version; the engine cannot be rerun
          here, so nothing is recomputed against the workpaper&apos;s own changes.
        </p>
        <ul className="mt-2 list-disc space-y-1 rounded border border-stone-200 bg-stone-50 px-3 py-2 pl-7 text-xs text-stone-600">
          <li>Alternatives are never stacked: select one at a time, and read its figures as that single branch.</li>
          <li>The two equipment alternatives (section 179, elect out of special depreciation) are mutually exclusive choices for the same asset.</li>
          <li>The sum of several alternatives&apos; deltas is not an exact number and is never shown as one.</li>
          <li>
            The supplied result applies to the pristine base version only. Once the workpaper has accepted changes, no combined result exists: the deltas are
            not added to the workpaper&apos;s estimates.
          </li>
        </ul>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Supplied alternatives</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2 font-normal">Alternative</th>
                <th className="px-3 py-2 font-normal">Base</th>
                <th className="px-3 py-2 font-normal">Choices</th>
                <th className="px-3 py-2 font-normal">Federal tax change</th>
                <th className="px-3 py-2 font-normal">Federal penalty change</th>
                <th className="px-3 py-2 font-normal">California tax change</th>
                <th className="px-3 py-2 font-normal">Lines changed</th>
                <th className="px-3 py-2 font-normal">Exclusive with</th>
              </tr>
            </thead>
            <tbody>
              {w.alternatives.map((a) => (
                <tr key={a.id} className={`border-t border-stone-100 align-top ${a.isSelected ? "bg-stone-50" : ""}`}>
                  <td className="px-3 py-2">
                    <Link href={withParams("/changes/whatif", { alt: a.id }, "selected")} className="num font-medium text-blue-700 hover:underline">
                      {a.id}
                    </Link>
                    <div className="text-xs text-stone-600">{a.description}</div>
                  </td>
                  <td className="num px-3 py-2">{a.baseVersion}</td>
                  <td className="px-3 py-2 text-xs">
                    {Object.entries(a.choices).map(([k, v]) => (
                      <div key={k}>
                        {k}: <span className="num">{v}</span>
                      </div>
                    ))}
                  </td>
                  <td className="num px-3 py-2">{signed(a.federalTaxChange)}</td>
                  <td className="num px-3 py-2">{signed(a.federalPenaltyChange)}</td>
                  <td className="num px-3 py-2">{signed(a.californiaTaxChange)}</td>
                  <td className="num px-3 py-2">{a.changedLinesCount}</td>
                  <td className="px-3 py-2 text-xs">
                    {a.exclusiveWith.length ? a.exclusiveWith.map((id) => <div key={id} className="num">{id}</div>) : <span className="text-stone-400">none</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-xs text-stone-500">
          Changes are the engine&apos;s own total_tax_change and penalty_change for each branch. They are listed side by side for reading, not for adding
          up.
        </p>
      </section>

      <section id="selected" className="rounded-lg border border-stone-200 bg-white">
        {sel ? (
          <>
            <div className="border-b border-stone-200 px-5 py-3">
              <h2 className="font-medium">
                <span className="num">{sel.id}</span>: isolated branch of <span className="num">{sel.baseVersion}</span>
              </h2>
              <p className="mt-1 text-sm text-stone-600">{sel.description}</p>
              <p className="mt-1 text-xs">
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-700">{sel.suppliedLabel}</span>
                {sel.exclusiveWith.length ? (
                  <span className="ml-2 text-stone-500">
                    mutually exclusive with {sel.exclusiveWith.map((id, i) => (
                      <span key={id}>
                        {i > 0 ? ", " : ""}
                        <Link href={withParams("/changes/whatif", { alt: id }, "selected")} className="num text-blue-700 hover:underline">
                          {id}
                        </Link>
                      </span>
                    ))}
                  </span>
                ) : null}
              </p>
            </div>
            <div className={`mx-5 mt-4 rounded border px-3 py-2 text-sm ${w.combined.available ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
              {w.combined.available ? (
                <>
                  The workpaper has no accepted changes and its baseline is <span className="num">{w.activeVersion}</span>, so the supplied figures below are
                  the result for this branch as it stands. They are still the engine&apos;s numbers for pristine {sel.baseVersion}, not a recomputation.
                </>
              ) : (
                w.combined.reason
              )}
            </div>
            <div className="grid gap-6 px-5 py-4 lg:grid-cols-2">
              <div>
                <BaseVsAlternative title="Federal" keys={FEDERAL_KEYS} base={sel.federal.base} alternative={sel.federal.alternative} />
                <p className="mt-2 text-xs text-stone-600">
                  total_tax_change <span className="num font-medium">{signed(sel.federalTaxChange)}</span>, penalty_change{" "}
                  <span className="num font-medium">{signed(sel.federalPenaltyChange)}</span>
                </p>
              </div>
              <div>
                <BaseVsAlternative title="California" keys={CALIFORNIA_KEYS} base={sel.california.base} alternative={sel.california.alternative} />
                <p className="mt-2 text-xs text-stone-600">
                  total_tax_change <span className="num font-medium">{signed(sel.californiaTaxChange)}</span>
                </p>
              </div>
            </div>
            <div className="border-t border-stone-200 px-5 py-3">
              <h3 className="text-sm font-medium">
                Lines this branch changes (<span className="num">{sel.changedLines.total}</span>)
              </h3>
              <div className="mt-2 space-y-3">
                <Pager
                  page={sel.changedLines.page}
                  pageCount={sel.changedLines.pageCount}
                  total={sel.changedLines.total}
                  pageSize={sel.changedLines.pageSize}
                  noun="Lines"
                  hrefFor={(p) => withParams("/changes/whatif", { alt: sel.id, page: p }, "selected")}
                />
                {sel.changedLines.rows.length === 0 ? (
                  <p className="text-sm text-stone-500">The engine reported no line changes for this branch.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-stone-500">
                      <tr>
                        <th className="px-3 py-2 font-normal">Line</th>
                        <th className="px-3 py-2 font-normal">Change</th>
                        <th className="px-3 py-2 font-normal">Base</th>
                        <th className="px-3 py-2 font-normal">Alternative</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sel.changedLines.rows.map((r) => (
                        <tr key={`${r.change}-${r.key}`} className="border-t border-stone-100 align-top">
                          <td className="px-3 py-1.5">
                            <RefLink refId={r.key} label={r.key} className="num text-sm text-blue-700 hover:underline" />
                            <div className="text-xs text-stone-500">{r.label}</div>
                          </td>
                          <td className="px-3 py-1.5 text-xs">{r.change}</td>
                          <td className="num px-3 py-1.5 text-stone-500">{r.change === "added" ? "" : <Value value={r.old} className="num" />}</td>
                          <td className="num px-3 py-1.5">{r.change === "removed" ? "" : <Value value={r.new} className="num" />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <Pager
                  page={sel.changedLines.page}
                  pageCount={sel.changedLines.pageCount}
                  total={sel.changedLines.total}
                  pageSize={sel.changedLines.pageSize}
                  noun="Lines"
                  hrefFor={(p) => withParams("/changes/whatif", { alt: sel.id, page: p }, "selected")}
                />
              </div>
            </div>
          </>
        ) : (
          <p className="px-5 py-4 text-sm text-stone-600">
            {altId ? `There is no supplied alternative called ${altId}. ` : ""}Select one alternative above to see it as an isolated branch of its base version.
          </p>
        )}
      </section>

      <section id="extension" className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Extension estimate (April, from {ext.basedOnVersion})</h2>
          <p className="mt-1 text-xs text-stone-500">
            Computed <span className="num">{dateTime(ext.computedAt)}</span> from <span className="num">{ext.basedOnVersion}</span>, the version in force when the
            extension was filed. This is what_if.extension as supplied; it is not an alternative and is never combined with one. The filing itself is timeline
            event{" "}
            <RefLink refId="timeline:extension-2026-04-14" label="extension-2026-04-14" />.
          </p>
        </div>
        <div className="grid gap-6 px-5 py-4 lg:grid-cols-2">
          {(
            [
              ["Federal", ext.federal],
              ["California", ext.california],
            ] as const
          ).map(([title, box]) => (
            <div key={title}>
              <h3 className="text-sm font-medium">{title}</h3>
              <table className="mt-1 w-full text-sm">
                <tbody>
                  {Object.entries(box)
                    .filter(([k]) => k !== "rule")
                    .map(([k, v]) => (
                      <tr key={k} className="border-t border-stone-100">
                        <td className="px-3 py-1.5 text-stone-600">{k.replace(/_/g, " ")}</td>
                        <td className="num px-3 py-1.5">{typeof v === "number" ? money(v) : String(v)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {typeof box.rule === "string" ? <p className="mt-2 text-xs text-stone-500">Rule: {box.rule}.</p> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
