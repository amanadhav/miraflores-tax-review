import Link from "next/link";
import { RefInline } from "@/components/line-refs";
import { formatLineValue, SeverityBadge } from "@/components/line-value";
import { RefLink } from "@/components/ref-link";
import { Amount, LineFact, LineKey, LineTableCompact, Panel, RecordsHeader, Statement, StatusCell } from "@/components/records-shared";
import { dateOnly } from "@/lib/format";
import { californiaView, type LineCellWithSources, type ValueView } from "@/server/queries/records-a";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function Cell({ cell }: { cell: LineCellWithSources | null }) {
  if (!cell) return <span className="text-xs text-stone-300">no line</span>;
  const changed = cell.baseline !== cell.effective;
  return (
    <div className="space-y-0.5">
      <div className={`num text-right ${changed ? "font-medium" : ""}`}>
        <Link href={`/review/line/${encodeURIComponent(cell.key)}`} className="hover:underline" title={cell.label}>
          {formatLineValue(cell.effective)}
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1">
        <StatusCell cell={cell} />
      </div>
      <div className="text-right text-[11px] text-stone-500">
        <span className="num" title={cell.ruleText}>
          {cell.rule}
        </span>
      </div>
      {cell.sources.length > 0 ? (
        <div className="text-right text-[11px]">
          <RefInline items={cell.sources} />
        </div>
      ) : null}
      {cell.note ? <div className="text-right text-[11px] text-stone-500">{cell.note}</div> : null}
    </div>
  );
}

function Value({ value, missing = "not read" }: { value: ValueView | null; missing?: string }) {
  if (!value) return <span className="text-xs text-stone-400">{missing}</span>;
  return <RefLink refId={value.ref.ref} label={value.display} className="num text-sm text-blue-700 hover:underline" />;
}

/** California: residency, Schedule CA by column, Form 540NR, wage sourcing, AMT and depreciation differences. */
export default async function CaliforniaPage() {
  const ctx = await requireSessionContext();
  const v = await californiaView(ctx);

  return (
    <div className="space-y-6">
      <RecordsHeader
        current="california"
        title="California"
        intro="The part-year residency split, Schedule CA (540NR) with its five columns side by side, Form 540NR, the supporting California forms, the wage-sourcing question, the AMT gap and the depreciation differences the engine carries."
        meta={v}
      />

      <Panel id="residency" title="Residency timeline" hint="From the household record and the engine's parameters.">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="px-3 py-1.5 font-normal">State</th>
              <th className="px-3 py-1.5 font-normal">From</th>
              <th className="px-3 py-1.5 font-normal">To</th>
              <th className="px-3 py-1.5 text-right font-normal">Days</th>
              <th className="px-3 py-1.5 font-normal">Status</th>
              <th className="px-3 py-1.5 font-normal">Address</th>
            </tr>
          </thead>
          <tbody>
            {v.residency.periods.map((p) => (
              <tr key={`${p.state}-${p.from}`} className="border-t border-stone-100">
                <td className="px-3 py-1.5 font-medium">{p.state}</td>
                <td className="num px-3 py-1.5">{p.from}</td>
                <td className="num px-3 py-1.5">{p.to}</td>
                <td className="num px-3 py-1.5 text-right">{p.days}</td>
                <td className="px-3 py-1.5">{p.status}</td>
                <td className="px-3 py-1.5 text-xs text-stone-600">{p.address ?? "not recorded"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-sm text-stone-700">{v.residency.statement}</p>
        <p className="mt-1 text-xs text-stone-500">
          Engine parameters: ca_resident_days <span className="num">{v.residency.caDays ?? "unknown"}</span>, year_days <span className="num">{v.residency.yearDays ?? "unknown"}</span>.{" "}
          <RefInline items={v.residency.parameters} />
        </p>
      </Panel>

      <Panel id="schedule-ca" title="Schedule CA (540NR)" count={v.scheduleCA.rows.length} hint="Each cell is a return line of the active version: effective value, status, engine rule and sources. Empty columns are lines the engine did not produce.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-2 py-2 font-normal">Line</th>
                {v.scheduleCA.columns.map((c) => (
                  <th key={c.id} className="px-2 py-2 text-right font-normal">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.scheduleCA.rows.map((r) => (
                <tr key={r.line} className="border-t border-stone-100 align-top">
                  <td className="px-2 py-2">
                    <div className="font-medium">{r.label}</div>
                    <div className="num text-[11px] text-stone-500">line {r.line}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
                      {v.scheduleCA.columns.map((c) => (r.cells[c.id] ? <LineKey key={c.id} cell={r.cells[c.id]!} /> : null))}
                    </div>
                  </td>
                  {v.scheduleCA.columns.map((c) => (
                    <td key={c.id} className="px-2 py-2 text-right">
                      <Cell cell={r.cells[c.id]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {v.scheduleCA.other.length > 0 ? (
          <div className="mt-3">
            <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Other Schedule CA lines</h3>
            <LineTableCompact cells={v.scheduleCA.other} showSources />
          </div>
        ) : null}
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-stone-600">California rules the engine used ({v.scheduleCA.rules.length})</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {v.scheduleCA.rules.map((r) => (
              <div key={r.id} className="contents">
                <dt className="num text-stone-500">{r.id}</dt>
                <dd className="text-stone-700">{r.description}</dd>
              </div>
            ))}
          </dl>
        </details>
      </Panel>

      <Panel id="f540nr" title="Form 540NR" count={v.f540nr.length}>
        <LineTableCompact cells={v.f540nr} showSources />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel id="schedule-s" title="Schedule S" count={v.scheduleS.length}>
          <LineTableCompact cells={v.scheduleS} showSources showRule={false} empty="No Schedule S line in this version." />
        </Panel>
        <Panel id="ftb3885a" title="FTB 3885A depreciation" count={v.ftb3885a.length}>
          <LineTableCompact cells={v.ftb3885a} showSources showRule={false} empty="No FTB 3885A line in this version." />
        </Panel>
        <Panel id="ftb5805" title="FTB 5805 underpayment penalty" count={v.ftb5805.length}>
          <LineTableCompact cells={v.ftb5805} showSources showRule={false} empty="No FTB 5805 line in this version." />
        </Panel>
      </div>

      <Panel id="wage-sourcing" title="Wage sourcing" hint="The engine's California-source wages beside the paystub and the client's answer. A judgment item, not an automatic correction.">
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Engine: California-source wages</h3>
            <div className="mt-1">
              <LineFact cell={v.wageSourcing.engine} />
            </div>
            {v.wageSourcing.engine ? (
              <p className="mt-1 text-xs text-stone-500">
                Rule <span className="num">{v.wageSourcing.engine.rule}</span>: {v.wageSourcing.engine.ruleText} Sources: <RefInline items={v.wageSourcing.engine.sources} />
              </p>
            ) : null}
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="px-2 py-1 font-normal">Form W-2</th>
                  <th className="px-2 py-1 text-right font-normal">Box 1 wages</th>
                  <th className="px-2 py-1 text-right font-normal">Box 16 CA wages</th>
                  <th className="px-2 py-1 text-right font-normal">Box 17 CA withheld</th>
                  <th className="px-2 py-1 text-right font-normal">Box 12 W</th>
                </tr>
              </thead>
              <tbody>
                {v.wageSourcing.w2.map((w) => (
                  <tr key={w.document.ref} className="border-t border-stone-100">
                    <td className="px-2 py-1">
                      <RefLink refId={w.document.ref} label={w.employer} className="text-sm text-blue-700 hover:underline" /> <span className="num text-[11px] text-stone-400">{w.document.ref}</span>
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Value value={w.box1} />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Value value={w.box16} />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Value value={w.box17} />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Value value={w.box12W} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="mt-4 text-xs font-medium tracking-wide text-stone-500 uppercase">Withholding stays separate</h3>
            <div className="mt-1">
              <LineFact cell={v.wageSourcing.withholding} />
            </div>
          </div>
          <div>
            <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">Paystub through the move</h3>
            {v.wageSourcing.paystub ? (
              <div className="mt-1 text-sm">
                <RefLink refId={v.wageSourcing.paystub.document.ref} label={v.wageSourcing.paystub.document.label} className="text-sm text-blue-700 hover:underline" />{" "}
                <span className="num text-[11px] text-stone-400">{v.wageSourcing.paystub.document.ref}</span>
                {!v.wageSourcing.paystub.document.available ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">arrives {dateOnly(v.wageSourcing.paystub.document.availableAt)}</span> : null}
                <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
                  {v.wageSourcing.paystub.values.map((val) => (
                    <div key={val.ref.ref} className="contents">
                      <dt className="text-stone-600">{val.label}</dt>
                      <dd className="text-right">
                        <Value value={val} />
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-1 text-xs text-stone-500">Printed: {v.wageSourcing.paystub.printed}</p>
              </div>
            ) : (
              <p className="text-sm text-stone-500">No paystub in the packet.</p>
            )}
            <h3 className="mt-4 text-xs font-medium tracking-wide text-stone-500 uppercase">Client answer</h3>
            {v.wageSourcing.questionnaire ? (
              <p className="mt-1 text-sm">
                <RefLink refId={v.wageSourcing.questionnaire.ref.ref} label={v.wageSourcing.questionnaire.id} /> {v.wageSourcing.questionnaire.question}{" "}
                <span className="text-stone-800">&quot;{v.wageSourcing.questionnaire.answer}&quot;</span>{" "}
                <span className="text-xs text-stone-500">
                  ({v.wageSourcing.questionnaire.answeredBy}, {dateOnly(v.wageSourcing.questionnaire.answeredAt)})
                </span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {v.wageSourcing.statements.map((s, i) => (
            <Statement key={i} tone={i === v.wageSourcing.statements.length - 1 ? "amber" : "stone"}>
              {s}
            </Statement>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="amt" title="California AMT" hint="Schedule P (540NR) is outside the engine.">
          {v.amt.line ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/review/line/${encodeURIComponent(v.amt.line.key)}`} className="font-medium hover:underline">
                {v.amt.line.label}
              </Link>
              <span className="num text-[11px] text-stone-500">{v.amt.line.key}</span>
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">not computed by the engine, review required</span>
              <span className="text-xs text-stone-500">
                engine shows <Amount value={v.amt.line.effective} />, rule <span className="num">{v.amt.line.rule}</span>
              </span>
            </div>
          ) : (
            <p className="text-sm text-stone-500">No Form 540NR line 61 in this version.</p>
          )}
          <div className="mt-2">
            <Statement tone="amber">{v.amt.statement}</Statement>
          </div>
          <div className="mt-2 text-sm">
            <span className="text-xs text-stone-500">Item to allocate: </span>
            <LineFact cell={v.amt.isoLine} />
          </div>
          <h3 className="mt-3 text-xs font-medium tracking-wide text-stone-500 uppercase">Findings ({v.amt.findings.length})</h3>
          {v.amt.findings.length === 0 ? (
            <p className="text-xs text-stone-400">No finding references this line.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {v.amt.findings.map((f) => (
                <li key={f.id}>
                  <SeverityBadge severity={f.severity} blocksFiling={f.blocksFiling} />{" "}
                  <Link href={`/review?area=${encodeURIComponent(f.area)}&finding=${encodeURIComponent(f.id)}`} className="font-medium hover:underline">
                    {f.title}
                  </Link>{" "}
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600">{f.status}</span>
                  <p className="text-xs text-stone-600">{f.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="depreciation" title="California depreciation differences" count={v.depreciation.rows.length} hint={v.depreciation.note}>
          {v.depreciation.rows.length === 0 ? (
            <p className="text-sm text-stone-500">The engine carries no California basis differences.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="px-2 py-1 font-normal">Asset</th>
                  <th className="px-2 py-1 text-right font-normal">Remaining CA basis difference</th>
                  <th className="px-2 py-1 font-normal">FTB 3885A line</th>
                </tr>
              </thead>
              <tbody>
                {v.depreciation.rows.map((d) => (
                  <tr key={d.assetId} className="border-t border-stone-100">
                    <td className="px-2 py-1">
                      <RefLink refId={d.asset.ref} label={d.description} className="text-sm text-blue-700 hover:underline" /> <span className="num text-[11px] text-stone-400">{d.assetId}</span>
                    </td>
                    <td className="num px-2 py-1 text-right">{formatLineValue(d.difference)}</td>
                    <td className="px-2 py-1 text-xs">
                      <LineFact cell={d.line} missing="no 2025 line" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
