import Link from "next/link";
import { RaiseFindingForm } from "@/components/finding-forms";
import { formatLineValue } from "@/components/line-value";
import { RefLink } from "@/components/ref-link";
import { ChangeTable, ClientItems, DocCard, DocList, Fact, Facts, LineAmount, LineName, LineRows, Note, Panel, RecordHeader, RefChips, SubHeading, TimelineList, TrailTable, ValueRows } from "@/components/recordsb-shell";
import { dateOnly, money } from "@/lib/format";
import { passthroughsView } from "@/server/queries/records-b";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function amount(n: number | null): string {
  return n === null ? "unknown" : money(n);
}

/**
 * K-1 items, the S corporation stock basis roll-forward, the partnership
 * capital account versus outside basis, the state supplement, related returns
 * as external stubs and the late K-1 timeline.
 */
export default async function PassthroughsPage() {
  const ctx = await requireSessionContext();
  const v = await passthroughsView(ctx);
  const s = v.scorpBasis;
  const p = v.partnership;

  return (
    <div className="space-y-6">
      <RecordHeader
        title="Pass-throughs and basis"
        lead="Schedule K-1 lines for each entity with their documents, the S corporation stock basis by year, the partnership capital account against an outside basis nobody has computed, and the late K-1 story across engine versions."
        header={v}
        current="/review/passthroughs"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {v.entities.map((e) => (
          <Panel key={e.id} id={e.id} title={`${e.name} (${e.kind})`} hint="Return lines sourced from this entity's K-1, then the K-1 documents.">
            <LineRows lines={e.lines} />
            <SubHeading>Documents</SubHeading>
            <DocList docs={e.docs} />
            {e.related ? (
              <div className="mt-3">
                <Note tone="stone" title={`Related return, prepared elsewhere: ${e.related.return}`}>
                  Prepared by {e.related.preparedBy}; {e.related.inPacket}; {e.related.contents}. Nothing from that return is assumed here beyond the K-1 pages in the packet.
                </Note>
              </div>
            ) : null}
          </Panel>
        ))}
      </div>

      <Panel id="scorp-basis" title="S corporation stock basis (Form 7203)" hint="Basis records by year as the packet holds them, a roll-forward reproduced here from those records and the K-1 documents, and the engine's beginning basis across versions.">
        <SubHeading>Basis records in the packet</SubHeading>
        <table className="w-full text-xs">
          <thead className="text-left text-stone-500">
            <tr>
              <th className="py-0.5 pr-2 font-normal">Year</th>
              <th className="py-0.5 pr-2 text-right font-normal">K-1 income</th>
              <th className="py-0.5 pr-2 text-right font-normal">Distributions</th>
              <th className="py-0.5 pr-2 text-right font-normal">Ending stock basis</th>
              <th className="py-0.5 font-normal">Source</th>
            </tr>
          </thead>
          <tbody>
            {s.records.map((r) => (
              <tr key={r.year} className="border-t border-stone-100">
                <td className="num py-0.5 pr-2">{r.year}</td>
                <td className="num py-0.5 pr-2 text-right">{r.k1Income === null ? "" : money(r.k1Income)}</td>
                <td className="num py-0.5 pr-2 text-right">{r.distributions === null ? "" : money(r.distributions)}</td>
                <td className={`num py-0.5 pr-2 text-right ${r.endingStockBasis === null ? "text-amber-800" : ""}`}>{r.endingStockBasis === null ? "not recorded" : money(r.endingStockBasis)}</td>
                <td className="py-0.5">{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <SubHeading>Roll-forward reproduced here</SubHeading>
        <table className="w-full text-xs">
          <thead className="text-left text-stone-500">
            <tr>
              <th className="py-0.5 pr-2 font-normal">Year</th>
              <th className="py-0.5 pr-2 text-right font-normal">Beginning</th>
              <th className="py-0.5 pr-2 text-right font-normal">Income</th>
              <th className="py-0.5 pr-2 text-right font-normal">Interest</th>
              <th className="py-0.5 pr-2 text-right font-normal">Distributions</th>
              <th className="py-0.5 pr-2 text-right font-normal">Ending</th>
              <th className="py-0.5 font-normal">From</th>
            </tr>
          </thead>
          <tbody>
            {s.rollforward.map((r) => (
              <tr key={r.year} className={`border-t border-stone-100 align-top ${r.basis === "gap" ? "bg-amber-50" : ""}`}>
                <td className="num py-0.5 pr-2">{r.year}</td>
                <td className="num py-0.5 pr-2 text-right">{r.beginning === null ? "" : money(r.beginning)}</td>
                <td className="num py-0.5 pr-2 text-right">{r.income === null ? (r.basis === "gap" ? "unknown" : "") : money(r.income)}</td>
                <td className="num py-0.5 pr-2 text-right">{r.interest === null ? "" : money(r.interest)}</td>
                <td className="num py-0.5 pr-2 text-right">{r.distributions === null ? (r.basis === "gap" ? "unknown" : "") : money(r.distributions)}</td>
                <td className="num py-0.5 pr-2 text-right font-medium">{r.ending === null ? "unknown" : money(r.ending)}</td>
                <td className="py-0.5">
                  <span className={`mr-1 rounded px-1.5 py-0.5 ${r.basis === "document" ? "bg-blue-100 text-blue-800" : r.basis === "record" ? "bg-stone-100 text-stone-700" : "bg-amber-100 text-amber-800"}`}>{r.basis}</span>
                  {r.source}{" "}
                  {r.refs.map((ref) => (
                    <span key={ref.ref} className="mr-1">
                      <RefLink refId={ref.ref} />
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2">
          {s.engineBeginning ? (
            <Note tone={s.matches === true ? "green" : s.matches === false ? "amber" : "stone"} title="Engine beginning basis versus the roll-forward">
              <p>
                <LineName line={s.engineBeginning} /> <LineAmount line={s.engineBeginning} />. Roll-forward computed here: <span className="num font-medium">{amount(s.computedBeginning)}</span>.{" "}
                {s.matches === true ? "They agree." : s.matches === false ? "They differ; review the inputs above before relying on either." : "The roll-forward could not be completed from the records."}
              </p>
              <p className="mt-1">
                Across versions:{" "}
                {s.versions.map((ver, i) => (
                  <span key={ver.version}>
                    {i > 0 ? "; " : ""}
                    <RefLink refId={ver.version} label={ver.version} className="num text-blue-800 hover:underline" /> ({dateOnly(ver.computedAt)}) <span className="num">{ver.value === null ? "not present" : formatLineValue(ver.value)}</span>
                    {ver.note ? ` (engine note: ${ver.note})` : ""}
                  </span>
                ))}
                .
              </p>
            </Note>
          ) : null}
        </div>
        <SubHeading>Engine diagnostic across versions</SubHeading>
        <TrailTable trail={s.diagnostic} />
        {s.priorNotes.length > 0 ? (
          <>
            <SubHeading>Prior preparer notes on basis</SubHeading>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-stone-700">
              {s.priorNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            {s.priorDoc ? (
              <p className="mt-1 text-xs">
                From{" "}
                <Link href={s.priorDoc.href} className="text-blue-700 hover:underline">
                  {s.priorDoc.title}
                </Link>{" "}
                <span className="num text-stone-400">{s.priorDoc.id}</span>
              </p>
            ) : null}
          </>
        ) : null}

        <SubHeading>Form 7203 lines in the active version</SubHeading>
        <LineRows lines={s.f7203} />
        <SubHeading>Distributions versus basis</SubHeading>
        <Facts>
          <Fact label="Stock basis before distributions">
            <LineAmount line={s.distributions.basisBefore} />
          </Fact>
          <Fact label="Distributions">
            <LineAmount line={s.distributions.distributions} />
          </Fact>
          <Fact label="Distributions in excess of basis">
            <LineAmount line={s.distributions.excess} />
          </Fact>
          <Fact label="Reported as capital gain on">
            {s.distributions.gainLine ? (
              <span>
                <LineName line={s.distributions.gainLine} /> <LineAmount line={s.distributions.gainLine} />
              </span>
            ) : (
              <span className="text-xs text-stone-400">no Form 8949 line</span>
            )}
          </Fact>
        </Facts>
      </Panel>

      <Panel id="partnership" title={`${p.name}: capital account versus outside basis`} hint="The K-1 capital account is a known number. Outside basis is a different number that nobody has computed; it is shown as unknown, never as zero and never as the capital account.">
        <Facts>
          <Fact label="Ending capital account (K-1)">
            <span className="num font-medium">{amount(p.capitalAccount.amount)}</span> <span className="ml-2 text-xs text-stone-500">{p.capitalAccount.carryoverLabel}</span>
            <div className="mt-0.5">
              <RefChips refs={p.capitalAccount.refs} />
            </div>
          </Fact>
          <Fact label="Outside basis">
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{p.outsideBasis.label}</span>
            {p.outsideBasis.record ? <span className="ml-2 text-xs text-stone-600">Prior record: {p.outsideBasis.record}.</span> : null}
            <p className="mt-0.5 text-xs text-stone-600">Not derived from the capital account here. Computing it needs the partner&apos;s contributions, share of liabilities and prior distributions; record the computation as a judgment when it is done.</p>
          </Fact>
          {p.record ? (
            <Fact label={`Capital account record, ${p.record.year}`}>
              <span className="num">{amount(p.record.endingStockBasis)}</span> <span className="ml-2 text-xs text-stone-500">{p.record.source}</span>
            </Fact>
          ) : null}
        </Facts>
        {p.k1 ? (
          <div className="mt-3">
            <DocCard doc={p.k1} role="K-1" />
          </div>
        ) : null}
        <SubHeading>State supplement</SubHeading>
        {p.stateSupplement.doc ? (
          <div className="space-y-2">
            <DocCard doc={p.stateSupplement.doc} role="state supplement" pages />
            <Note tone="stone" title="Composite return facts, as printed">
              {p.stateSupplement.note}
            </Note>
          </div>
        ) : (
          <p className="text-xs text-stone-500">No state supplement in the packet.</p>
        )}
      </Panel>

      <Panel id="related" title="Related returns prepared elsewhere" hint="External stubs from the household record. Each names who prepared it and whether anything from it is in this packet; the rest of its contents are unknown here.">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="py-1 pr-3 font-normal">Who</th>
              <th className="py-1 pr-3 font-normal">Return</th>
              <th className="py-1 pr-3 font-normal">Prepared by</th>
              <th className="py-1 pr-3 font-normal">In this packet</th>
              <th className="py-1 font-normal">Contents</th>
            </tr>
          </thead>
          <tbody>
            {v.relatedReturns.map((r) => (
              <tr key={r.who} className="border-t border-stone-100 align-top">
                <td className="py-1.5 pr-3 font-medium">{r.who}</td>
                <td className="py-1.5 pr-3 text-xs">{r.return}</td>
                <td className="py-1.5 pr-3 text-xs">{r.preparedBy}</td>
                <td className="py-1.5 pr-3 text-xs">
                  {r.inPacket}
                  {r.docs.length > 0 ? (
                    <span className="ml-1">
                      {r.docs.map((d) => (
                        <span key={d.id} className="mr-1">
                          <RefLink refId={d.id} label={d.id} />
                        </span>
                      ))}
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5">
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-700">{r.contents}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel id="late-k1" title="The late K-1" hint="When the Ridgeline K-1 arrived, which version first included it, and the diagnostic that tracked it.">
        <SubHeading>Timeline</SubHeading>
        <TimelineList events={v.lateK1.events} />
        <SubHeading>Engine diagnostic across versions</SubHeading>
        <TrailTable trail={v.lateK1.diagnostic} />
        <SubHeading>Lines the active version changed for this entity</SubHeading>
        <ChangeTable changes={v.lateK1.changes} />
        <SubHeading>What the client said</SubHeading>
        <ClientItems items={v.lateK1.clientItems} />
        {p.stateSupplement.facts.length > 0 ? (
          <>
            <SubHeading>State apportionment values</SubHeading>
            <ValueRows values={p.stateSupplement.facts} />
          </>
        ) : null}
      </Panel>

      <Panel id="raise" title="Raise a finding" hint="Findings raised here land in the pass-throughs and basis area with the refs you list.">
        <RaiseFindingForm areaId={v.area.id} areaLabel={v.area.label} revision={v.revision} canRaise={v.actor.canRaise} actorRole={v.actor.role} owners={v.owners} />
      </Panel>
    </div>
  );
}
