import Link from "next/link";
import { RaiseFindingForm } from "@/components/finding-forms";
import { RefInline } from "@/components/line-refs";
import { formatLineValue, LineStatusBadge } from "@/components/line-value";
import { RefLink } from "@/components/ref-link";
import { ClientItems, DocCard, DocList, JudgmentList, LineAmount, LineName, LineRows, Note, Panel, PendingCell, RecordHeader, RefChips, SubHeading, ValueRows, WhatIfBox } from "@/components/recordsb-shell";
import { money } from "@/lib/format";
import { rentalsView } from "@/server/queries/records-b";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

/**
 * Schedule E property by property with the books behind each column, the
 * HVAC repair question, the condo sale on Form 4797, the passive loss
 * computation and a link to depreciation by asset.
 */
export default async function RentalsPage() {
  const ctx = await requireSessionContext();
  const v = await rentalsView(ctx);
  const cols = v.properties.map((p) => p.column);

  return (
    <div className="space-y-6">
      <RecordHeader
        title="Rentals and the condo sale"
        lead="Schedule E per property with the books behind each column, the HVAC question, Form 4797 for the condo sale, Form 8582 and the rental depreciation totals."
        header={v}
        current="/review/rentals"
      />
      <Panel id="schedule-e" title="Schedule E, income and expenses side by side" hint="One column per property, in the engine's key order (SchE.3A, SchE.3B). Each amount opens its inspector; the status words match the review screens.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1 pr-3 font-normal">Line</th>
                {v.properties.map((p) => (
                  <th key={p.column} className="py-1 pr-3 text-right font-normal">
                    <span className="font-medium text-stone-700">{p.column}</span> {p.address}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.grid.map((row) => (
                <tr key={row.lineNo} className="border-t border-stone-100 align-top">
                  <td className="py-1.5 pr-3">
                    <span className="num mr-2 text-xs text-stone-500">{row.lineNo}</span>
                    {row.label}
                  </td>
                  {row.cells.map((cell, i) => (
                    <td key={cols[i]} className="py-1.5 pr-3 text-right">
                      {cell ? (
                        <div className="inline-flex flex-col items-end gap-0.5">
                          <Link href={cell.href} className={`num hover:underline ${cell.baseline !== cell.effective ? "font-medium" : ""}`}>
                            {formatLineValue(cell.effective)}
                          </Link>
                          <span className="inline-flex flex-wrap items-center justify-end gap-1 text-[11px]">
                            <span className="num text-stone-400">{cell.key}</span>
                            <LineStatusBadge status={cell.status} reason={cell.statusReason} />
                            <PendingCell line={cell} />
                          </span>
                          <span className="text-[11px]">
                            <RefInline items={cell.sources} />
                          </span>
                          {cell.note ? <span className="max-w-xs text-right text-[11px] text-amber-800">{cell.note}</span> : null}
                        </div>
                      ) : (
                        <span className="text-xs text-stone-300">none</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SubHeading>Schedule E totals</SubHeading>
        <LineRows lines={v.totals} notes={false} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        {v.properties.map((p) => (
          <Panel key={p.column} id={`property-${p.column}`} title={`Property ${p.column}: ${p.address}`} hint={p.days ? `Rental days: ${formatLineValue(p.days.effective)} (${p.days.key}).` : "No rental days line."}>
            {p.days ? (
              <p className="mb-2 text-xs text-stone-600">
                <LineName line={p.days} /> <LineAmount line={p.days} /> <RefInline items={p.days.sources} />
              </p>
            ) : null}
            <SubHeading>Books of the property</SubHeading>
            {p.book ? <DocCard doc={p.book} role="books" /> : <p className="text-xs text-stone-500">No owner statement or ledger in the packet for this property.</p>}
            <SubHeading>Other documents for this property</SubHeading>
            <DocList docs={p.supporting} />
          </Panel>
        ))}
      </div>

      <Panel id="hvac" title="HVAC replacement inside repairs" hint="The engine kept the HVAC inside repairs and said so in its note. The what-if below is the engine's own result for treating it as an improvement; nothing here changes the line.">
        {v.hvac.line ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <LineName line={v.hvac.line} />
              <LineAmount line={v.hvac.line} />
              <PendingCell line={v.hvac.line} />
            </div>
            {v.hvac.note ? <Note tone="amber" title="Engine note">{v.hvac.note}</Note> : null}
            <SubHeading>Evidence for the HVAC amount</SubHeading>
            <ValueRows values={v.hvac.evidence} />
            {v.hvac.invoice ? (
              <div className="mt-2">
                <DocCard doc={v.hvac.invoice} role="invoice" values={false} />
              </div>
            ) : null}
            {v.hvac.whatIf ? <WhatIfBox note={v.hvac.whatIf} /> : <p className="text-xs text-stone-500">No engine what-if touches this line.</p>}
            <SubHeading>Judgment</SubHeading>
            <p className="text-xs text-stone-600">Repair or improvement is a judgment call with authority, applicability and a conclusion. It is recorded on the judgments screen, not decided by this page.</p>
            <JudgmentList items={v.hvac.judgments} href={v.hvac.judgmentHref} subject={v.hvac.line.key} />
            <SubHeading>What the client said</SubHeading>
            <ClientItems items={v.hvac.clientItems} />
            <p className="text-xs">
              <Link href={`${v.hvac.line.href}#propose`} className="text-blue-700 hover:underline">
                Propose an adjustment on {v.hvac.line.key}
              </Link>
            </p>
          </div>
        ) : (
          <p className="text-xs text-stone-500">No repairs line with an HVAC note in this version.</p>
        )}
      </Panel>

      <Panel id="sale" title="Sale of the Austin condo (Form 4797)" hint="Lines in the engine's order: Part III (lines 20 to 32) then Part I (lines 7 to 9). The closing statement and Form 1099-S are the sources.">
        <LineRows lines={v.sale.lines} />
        <SubHeading>Depreciation recapture and unrecaptured section 1250 gain</SubHeading>
        <LineRows lines={v.sale.recapture} />
        {v.sale.notes.length > 0 ? (
          <div className="mt-3 space-y-1">
            {v.sale.notes.map((n) => (
              <Note key={n.key} tone="stone" title={`Engine note on ${n.key}`}>
                {n.note}
              </Note>
            ))}
          </div>
        ) : null}
        <SubHeading>Assets disposed</SubHeading>
        <RefChips refs={v.sale.assets} />
        <p className="mt-1 text-xs">
          <Link href={v.depreciation.href} className="text-blue-700 hover:underline">
            Depreciation by asset, with each asset&apos;s disposition details
          </Link>
        </p>
        <SubHeading>Sources</SubHeading>
        <DocList docs={v.sale.docs} />
      </Panel>

      <Panel id="passive" title="Passive activity losses (Form 8582)" hint="Prior-year unallowed losses come from the carryover records; the allowed amounts are the Schedule E line 22 results.">
        <LineRows lines={v.passive.lines} />
        {v.passive.note ? <div className="mt-2"><Note tone="stone" title="Engine note">{v.passive.note}</Note></div> : null}
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <div>
            <SubHeading>Prior suspended losses</SubHeading>
            <ul className="mt-1 space-y-0.5 text-xs">
              {v.passive.prior.map((p) => (
                <li key={p.ref.ref} className="flex flex-wrap items-baseline gap-2">
                  <span>{p.label}</span>
                  <span className="num font-medium">{p.amount === null ? "unknown" : money(p.amount)}</span>
                  <RefLink refId={p.ref.ref} label={p.ref.label} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <SubHeading>Allowed this year</SubHeading>
            <ul className="mt-1 space-y-0.5 text-xs">
              {v.passive.allowed.map((l) => (
                <li key={l.key} className="flex flex-wrap items-baseline gap-2">
                  <LineName line={l} />
                  <LineAmount line={l} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <SubHeading>Unallowed, carried out</SubHeading>
            <ul className="mt-1 space-y-0.5 text-xs">
              {v.passive.out.map((o) => (
                <li key={o.label} className="flex flex-wrap items-baseline gap-2">
                  <span>{o.label}</span>
                  <span className="num font-medium">{o.amount === null ? "not supplied" : money(o.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel id="depreciation" title="Depreciation" hint="Rental depreciation totals per property; the schedule by asset is its own screen.">
        <LineRows lines={v.depreciation.lines} />
        <p className="mt-2 text-xs">
          <Link href={v.depreciation.href} className="text-blue-700 hover:underline">
            Open depreciation by asset
          </Link>
        </p>
      </Panel>

      <Panel id="raise" title="Raise a finding" hint="Findings raised here land in the rentals and property sale area with the refs you list.">
        <RaiseFindingForm areaId={v.area.id} areaLabel={v.area.label} revision={v.revision} canRaise={v.actor.canRaise} actorRole={v.actor.role} owners={v.owners} />
      </Panel>
    </div>
  );
}
