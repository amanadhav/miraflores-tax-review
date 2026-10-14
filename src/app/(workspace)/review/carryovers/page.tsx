import Link from "next/link";
import { RefInline } from "@/components/line-refs";
import { formatLineValue } from "@/components/line-value";
import { RefLink } from "@/components/ref-link";
import { Amount, LineFact, LineName, LineTableCompact, Panel, RecordsHeader, Statement, StatusCell, Unknown } from "@/components/records-shared";
import { carryoversView, type CarryoverRow, type PriorItem } from "@/server/queries/records-a";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function signedText(n: number | null): string {
  if (n === null) return "";
  const text = formatLineValue(Math.abs(n));
  return n < 0 ? `-${text}` : n > 0 ? `+${text}` : "0";
}

function CarryoverTable({ rows, empty }: { rows: CarryoverRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-stone-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="px-3 py-2 font-normal">Carryover</th>
            <th className="px-3 py-2 text-right font-normal">Into 2025 (from 2024)</th>
            <th className="px-3 py-2 text-right font-normal">Out of 2025 (engine)</th>
            <th className="px-3 py-2 text-right font-normal">Difference</th>
            <th className="px-3 py-2 font-normal">Used by 2025 lines</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-stone-100 align-top">
              <td className="px-3 py-1.5">
                <div className="font-medium">{r.label}</div>
                <div className="num text-[11px] text-stone-500">{r.key}</div>
                {r.note ? <div className="mt-0.5 text-[11px] text-stone-500">{r.note}</div> : null}
              </td>
              <td className="num px-3 py-1.5 text-right whitespace-nowrap">
                {r.into === null ? (
                  <Unknown text={r.intoRef ? "unknown" : "no 2024 record"} />
                ) : r.intoRef ? (
                  <RefLink refId={`py:${r.intoRef}`} label={formatLineValue(r.into)} className="num text-blue-700 hover:underline" />
                ) : (
                  formatLineValue(r.into)
                )}
              </td>
              <td className="num px-3 py-1.5 text-right whitespace-nowrap">{r.out === null ? <Unknown text="not reported" /> : formatLineValue(r.out)}</td>
              <td className="num px-3 py-1.5 text-right whitespace-nowrap">{r.difference === null ? <span className="text-xs text-stone-400">not compared</span> : signedText(r.difference)}</td>
              <td className="px-3 py-1.5 text-xs">
                {r.usedBy.length === 0 ? (
                  <span className="text-stone-400">no line cites it</span>
                ) : (
                  <ul className="space-y-0.5">
                    {r.usedBy.map((l) => (
                      <li key={l.key} className="flex flex-wrap items-center gap-2">
                        <LineName cell={l} />
                        <Amount value={l.effective} />
                        <StatusCell cell={l} />
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ITEM_STATUS: Record<PriorItem["status"], { label: string; tone: string }> = {
  addressed: { label: "addressed", tone: "bg-emerald-100 text-emerald-800" },
  in_progress: { label: "in progress", tone: "bg-blue-100 text-blue-800" },
  not_yet_addressed: { label: "not yet addressed", tone: "bg-amber-100 text-amber-800" },
};

function PriorItemCard({ item }: { item: PriorItem }) {
  const s = ITEM_STATUS[item.status];
  return (
    <li id={item.id} className="rounded border border-stone-100 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600">{item.kind === "open_item" ? "open item" : "note"}</span>
        <span className={`rounded px-2 py-0.5 text-xs ${s.tone}`}>{s.label}</span>
        <p className="min-w-0 flex-1 text-sm">{item.text}</p>
      </div>
      <p className="mt-1 text-xs text-stone-600">{item.summary}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        <span className="text-stone-500">About: {item.subjects.join(", ")}</span>
        <RefInline items={item.documents} />
      </div>
      {item.lines.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          <span className="text-stone-500">2025 lines:</span>
          {item.lines.map((l) => (
            <span key={l.key} className="inline-flex items-center gap-1">
              <Link href={`/review/line/${encodeURIComponent(l.key)}`} className="num text-blue-700 hover:underline">
                {l.key}
              </Link>
              <Amount value={l.effective} />
            </span>
          ))}
        </div>
      ) : null}
      {item.workpaper.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs">
          {item.workpaper.map((w) => (
            <li key={w.ref} className="flex flex-wrap items-baseline gap-2">
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-600">{w.ref.split(":")[0]}</span>
              <span className="rounded border border-stone-200 px-1.5 py-0.5 text-stone-600">{w.status}</span>
              <RefLink refId={w.ref} label={w.subjectLabel} className="text-xs text-blue-700 hover:underline" />
              <span className="text-stone-600">{w.detail}</span>
              <span className="text-stone-400">
                {w.actor.name}, revision <span className="num">{w.createdRevision}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Carryovers into and out of 2025, basis records by year, and the prior preparer's notes paired with this workpaper's response. */
export default async function CarryoversPage() {
  const ctx = await requireSessionContext();
  const v = await carryoversView(ctx);

  return (
    <div className="space-y-6">
      <RecordsHeader
        current="carryovers"
        title="Carryovers and basis"
        intro="What came into 2025 from the 2024 return, what the engine carries out, which lines use each amount, the basis records by year, and every note or open item the prior preparer left paired with what this workpaper did about it."
        meta={v}
      />

      <Statement tone="stone">
        <span className="font-medium">Unknown stays unknown.</span> {v.unknownNote} Sources of the 2024 carryovers: {v.sourcesNote}.
      </Statement>

      <Panel id="federal" title="Federal carryovers" count={v.federal.length}>
        <CarryoverTable rows={v.federal} empty="No federal carryovers recorded." />
      </Panel>

      <Panel id="california" title="California carryovers" count={v.california.length} hint="Same as federal except depreciation: the 2024 record says the 2021 appliances keep California basis because California did not allow the federal special depreciation.">
        <CarryoverTable rows={v.california} empty="No California carryovers recorded." />
        {v.depreciationDifferences.length > 0 ? (
          <div className="mt-3">
            <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">California depreciation basis differences carried out (engine)</h3>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {v.depreciationDifferences.map((d) => (
                <li key={d.assetId}>
                  <RefLink refId={d.asset.ref} label={d.description} className="text-sm text-blue-700 hover:underline" /> <Amount value={d.difference} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Panel id="carry-lines" title="2025 lines carried from prior-year records" count={v.carryLines.length} hint="Every line the engine computed with rule R-PRIOR-YEAR-CARRY, with the prior-year record it cites.">
        <LineTableCompact cells={v.carryLines} showSources showRule={false} empty="No line carries from the prior year." />
      </Panel>

      <Panel id="basis" title="Basis records by year" hint="The prior records exactly as supplied, beside the engine's 2025 lines that roll them forward.">
        <div className="grid gap-5 lg:grid-cols-2">
          {v.basis.map((g) => (
            <section key={g.id} id={`basis-${g.id}`} className="rounded border border-stone-100 p-3">
              <h3 className="font-medium">{g.title}</h3>
              <p className="text-[11px] text-stone-500">
                <RefLink refId={g.pointer} label={g.pointer} />
              </p>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.period} className="border-t border-stone-100 align-top">
                      <td className="num py-1 pr-3 font-medium whitespace-nowrap">{r.period}</td>
                      <td className="py-1 pr-3">
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                          {r.fields.map((f) => (
                            <div key={f.label} className="contents">
                              <dt className="text-stone-500">{f.label}</dt>
                              <dd className="num">{f.unknown ? <Unknown text="unknown (stays unknown)" /> : f.value}</dd>
                            </div>
                          ))}
                        </dl>
                        <div className="mt-0.5 text-[11px] text-stone-500">
                          Source: {r.source} <RefInline items={r.refs} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {g.filledBy ? (
                <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                  <p>
                    <span className="font-medium">Gap filled later:</span> <RefLink refId={g.filledBy.document.ref} label={g.filledBy.document.label} className="text-xs text-blue-700 hover:underline" />{" "}
                    <span className="num text-stone-500">{g.filledBy.document.ref}</span>. {g.filledBy.note}
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-x-4">
                    {g.filledBy.values.map((val) => (
                      <li key={val.ref.ref}>
                        {val.label}: <RefLink refId={val.ref.ref} label={val.display} className="num text-xs text-blue-700 hover:underline" />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {g.engineLines.length > 0 ? (
                <div className="mt-2">
                  <h4 className="text-[11px] font-medium tracking-wide text-stone-500 uppercase">Engine lines, 2025</h4>
                  <ul className="mt-0.5 space-y-0.5 text-xs">
                    {g.engineLines.map((l) => (
                      <li key={l.key} className="flex flex-wrap items-center gap-2">
                        <LineFact cell={l} />
                        <RefInline items={l.sources} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {g.carryoverOut.length > 0 ? (
                <p className="mt-2 text-xs text-stone-600">
                  Engine carryover out:{" "}
                  {g.carryoverOut.map((c, i) => (
                    <span key={c.key}>
                      {i > 0 ? "; " : ""}
                      <span className="num">{c.key}</span> {c.value === null ? <Unknown /> : <Amount value={c.value} />}
                    </span>
                  ))}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-stone-600">{g.note}</p>
            </section>
          ))}
        </div>
      </Panel>

      <Panel id="prior-preparer" title="Prior preparer's notes and open items" count={v.priorPreparer.items.length} hint="Each paired with the judgments, findings, tasks, verifications or adjustments in this workpaper that touch it.">
        <p className="text-sm text-stone-700">
          <RefLink refId={v.priorPreparer.document.ref} label={v.priorPreparer.document.label} className="text-sm text-blue-700 hover:underline" />{" "}
          <span className="num text-[11px] text-stone-400">{v.priorPreparer.document.ref}</span>
        </p>
        <p className="mt-1 text-xs text-stone-600">Summary memo: {v.priorPreparer.memo}</p>
        <ul className="mt-3 space-y-2">
          {v.priorPreparer.items.map((item) => (
            <PriorItemCard key={item.id} item={item} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}
