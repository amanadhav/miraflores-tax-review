import Link from "next/link";
import { RefInline } from "@/components/line-refs";
import { formatLineValue, LineStatusBadge } from "@/components/line-value";
import { RefLink } from "@/components/ref-link";
import { Availability, ClientItems, FindingChip, Note, PendingCell, ValueRows } from "@/components/recordsb-shell";
// Group headings read the broker and accountLabel; the field is not named "account" because the redactor masks that key.
import { dateOnly, money } from "@/lib/format";
import type { BoxSummaryView, LotFlag, LotGroupView, LotView, SalesView, UnmatchedLot } from "@/server/queries/records-b";

function cents(n: number | null): string {
  return n === null ? "n/a" : money(n, { cents: true });
}

export function BoxSummaryTable({ boxes }: { boxes: BoxSummaryView[] }) {
  if (boxes.length === 0) return <p className="text-xs text-stone-500">No Form 8949 box totals in this version.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="py-1 pr-3 font-normal">Box</th>
            <th className="py-1 pr-3 text-right font-normal">Lots</th>
            <th className="py-1 pr-3 text-right font-normal">Proceeds</th>
            <th className="py-1 pr-3 text-right font-normal">Basis</th>
            <th className="py-1 pr-3 text-right font-normal">Adjustments</th>
            <th className="py-1 pr-3 text-right font-normal">Gain or (loss)</th>
            <th className="py-1 pr-3 font-normal">Status</th>
            <th className="py-1 font-normal">Carries to</th>
          </tr>
        </thead>
        <tbody>
          {boxes.map((b) => (
            <tr key={b.box} id={`box-${b.box}`} className="border-t border-stone-100 align-top">
              <td className="py-1.5 pr-3">
                <Link href={b.total.href} className="font-medium hover:underline">
                  Box {b.box}
                </Link>
                <span className="ml-2 text-xs text-stone-500">{b.holdingLabel}</span>
                <div className="num text-[11px] text-stone-500">{b.total.key}</div>
              </td>
              <td className="num py-1.5 pr-3 text-right">{b.lotCount}</td>
              <td className="num py-1.5 pr-3 text-right whitespace-nowrap">{cents(b.proceeds)}</td>
              <td className="num py-1.5 pr-3 text-right whitespace-nowrap">{cents(b.basis)}</td>
              <td className="num py-1.5 pr-3 text-right whitespace-nowrap">{cents(b.adjustments)}</td>
              <td className={`num py-1.5 pr-3 text-right whitespace-nowrap ${b.total.baseline !== b.total.effective ? "font-medium" : ""}`}>{formatLineValue(b.total.effective)}</td>
              <td className="py-1.5 pr-3">
                <LineStatusBadge status={b.total.status} reason={b.total.statusReason} changedInputs={b.total.changedInputs} inline />
              </td>
              <td className="py-1.5 text-xs">
                {b.carriesTo ? (
                  <span>
                    <Link href={b.carriesTo.href} className="hover:underline">
                      {b.carriesTo.label}
                    </Link>{" "}
                    <span className="num text-stone-500">{b.carriesTo.key}</span>
                  </span>
                ) : (
                  <span className="text-stone-400">no Schedule D line carries it</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-stone-500">Proceeds, basis and adjustments are parsed from the engine&apos;s box-total labels; the gain is the box total line as it stands now.</p>
    </div>
  );
}

function FlagList({ flags }: { flags: LotFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="mt-1 space-y-1">
      {flags.map((f, i) => (
        <div key={i} className={`rounded border p-2 text-xs ${f.kind === "supplement_matched" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <span className="font-medium">{f.label}</span>
          <p className="mt-0.5">{f.detail}</p>
          {f.evidence.length > 0 ? (
            <div className="mt-1 rounded bg-white/70 p-1">
              <ValueRows values={f.evidence} />
            </div>
          ) : null}
          {f.refs.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-x-2">
              {f.refs.map((r) => (
                <RefLink key={r.ref} refId={r.ref} label={r.label} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function LotTable({ lots }: { lots: LotView[] }) {
  if (lots.length === 0) return <p className="px-3 py-2 text-xs text-stone-500">No lots on this page.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="px-3 py-1 font-normal">Lot</th>
            <th className="px-3 py-1 font-normal">Box</th>
            <th className="px-3 py-1 font-normal">Acquired</th>
            <th className="px-3 py-1 font-normal">Sold</th>
            <th className="px-3 py-1 text-right font-normal">Proceeds</th>
            <th className="px-3 py-1 text-right font-normal">Basis</th>
            <th className="px-3 py-1 text-right font-normal">Adj.</th>
            <th className="px-3 py-1 text-right font-normal">Gain or (loss)</th>
            <th className="px-3 py-1 font-normal">Status</th>
            <th className="px-3 py-1 font-normal">Sources</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((l) => (
            <tr key={l.key} id={l.key} className={`border-t border-stone-100 align-top ${l.flags.length ? "bg-amber-50/40" : ""}`}>
              <td className="px-3 py-1.5">
                <Link href={l.href} className="font-medium hover:underline">
                  {l.description}
                </Link>
                <div className="num text-[11px] text-stone-500">
                  {l.lotId} <span className="text-stone-400">{l.key}</span>
                </div>
                <FlagList flags={l.flags} />
                <PendingCell line={l} />
              </td>
              <td className="px-3 py-1.5 text-xs">
                <span className="num">{l.box}</span> <span className="text-stone-500">{l.holdingLabel}</span>
              </td>
              <td className="num px-3 py-1.5 text-xs whitespace-nowrap">{l.acquired ?? "n/a"}</td>
              <td className="num px-3 py-1.5 text-xs whitespace-nowrap">{l.sold ?? "n/a"}</td>
              <td className="num px-3 py-1.5 text-right whitespace-nowrap">{cents(l.proceeds)}</td>
              <td className={`num px-3 py-1.5 text-right whitespace-nowrap ${l.basis === 0 ? "text-amber-800" : ""}`}>{cents(l.basis)}</td>
              <td className="num px-3 py-1.5 text-right text-xs whitespace-nowrap">{l.adjustment ? `${l.adjustment.code} ${money(l.adjustment.amount, { cents: true })}` : ""}</td>
              <td className={`num px-3 py-1.5 text-right whitespace-nowrap ${l.baseline !== l.gain ? "font-medium" : ""}`}>{formatLineValue(l.gain)}</td>
              <td className="px-3 py-1.5">
                <LineStatusBadge status={l.status} reason={l.statusReason} />
              </td>
              <td className="px-3 py-1.5 text-xs">
                <RefInline items={l.sources} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnmatchedRow({ lot }: { lot: UnmatchedLot }) {
  return (
    <Note
      tone="red"
      title={`${lot.lotId}: ${lot.status}`}
      actions={[
        { label: `Open ${lot.documentId} page ${lot.page}`, href: lot.href },
        { label: "Anchor the printed text", href: lot.anchorHref },
      ]}
    >
      {lot.available ? (
        <>
          <p>
            Printed on <RefLink refId={`doc:${lot.documentId}#page${lot.page}`} label={`${lot.documentId} page ${lot.page}`} />: {lot.printed}
          </p>
          {lot.parsed.description ? (
            <p className="mt-1">
              Read here from the printed text: {lot.parsed.description}, acquired <span className="num">{lot.parsed.acquired}</span>, sold <span className="num">{lot.parsed.sold}</span>, proceeds{" "}
              <span className="num">{cents(lot.parsed.proceeds)}</span>, basis <span className="num">{cents(lot.parsed.basis)}</span>. No return line carries it and no extracted value exists for it.
            </p>
          ) : null}
          {lot.extractionReason ? <p className="mt-1">Pipeline extraction note: {lot.extractionReason}</p> : null}
        </>
      ) : (
        <p>
          The statement arrives on <span className="num">{dateOnly(lot.availableAt)}</span>; its content is not shown at the current replay clock.
        </p>
      )}
    </Note>
  );
}

function pageHref(group: LotGroupView, page: number, q: string): string {
  const params = new URLSearchParams();
  params.set("group", group.id);
  params.set("page", String(page));
  if (q) params.set("q", q);
  return `/review/sales?${params.toString()}#group-${group.id}`;
}

export function LotGroupSection({ group, q, open }: { group: LotGroupView; q: string; open: boolean }) {
  return (
    <details id={`group-${group.id}`} open={open} className="rounded-lg border border-stone-200 bg-white">
      <summary className="cursor-pointer px-5 py-3">
        <span className="font-medium">{group.label}</span>
        <span className="ml-2 text-xs text-stone-500">
          <span className="num">{group.lotCount}</span> lot{group.lotCount === 1 ? "" : "s"} on the return
          {q ? (
            <>
              , <span className="num">{group.matched}</span> match the search
            </>
          ) : null}
          {group.unmatched.length > 0 ? (
            <>
              , <span className="num text-red-700">{group.unmatched.length}</span> printed but not on the return
            </>
          ) : null}
          {group.washSale.count > 0 ? (
            <>
              , wash sales on <span className="num">{group.washSale.count}</span> lot{group.washSale.count === 1 ? "" : "s"} totalling <span className="num">{money(group.washSale.amount, { cents: true })}</span>{" "}
              (summed here from the lot labels)
            </>
          ) : null}
        </span>
      </summary>
      <div className="border-t border-stone-200">
        <div className="space-y-3 px-5 py-3">
          {group.documents.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span className="text-stone-500">Statements:</span>
              {group.documents.map((d) => (
                <span key={d.id}>
                  <Link href={d.href} className="text-blue-700 hover:underline">
                    {d.title}
                  </Link>{" "}
                  <span className="num text-stone-400">{d.id}</span> <Availability available={d.available} availableAt={d.receivedAt} />
                </span>
              ))}
            </div>
          ) : null}
          {group.passthroughHref ? (
            <p className="text-xs">
              This line comes from the stock basis computation.{" "}
              <Link href={group.passthroughHref} className="text-blue-700 hover:underline">
                See pass-throughs and basis
              </Link>
              .
            </p>
          ) : null}
          {group.summaryCheck && group.summaryCheck.diagnostic ? (
            <div className="space-y-2">
              <FindingChip finding={group.summaryCheck.diagnostic} />
              <Note tone="amber" title="Summary versus detail, as computed here">
                <p>
                  Broker summary proceeds{" "}
                  {group.summaryCheck.summaryValue ? (
                    <Link href={group.summaryCheck.summaryValue.href} className="num text-blue-800 hover:underline">
                      {group.summaryCheck.summaryValue.display}
                    </Link>
                  ) : (
                    <span className="num">unknown</span>
                  )}
                  ; sum of the <span className="num">{group.summaryCheck.lotCount}</span> lots on the return <span className="num">{money(group.summaryCheck.lotProceeds, { cents: true })}</span> (added here from the
                  lot labels); difference <span className="num font-medium">{cents(group.summaryCheck.difference)}</span>. {group.summaryCheck.message}
                </p>
              </Note>
            </div>
          ) : null}
          {group.unmatched.map((u) => (
            <UnmatchedRow key={u.lotId} lot={u} />
          ))}
          {group.clientItems.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs text-stone-600">Client answers and messages mentioning this account ({group.clientItems.length})</summary>
              <div className="mt-1">
                <ClientItems items={group.clientItems} />
              </div>
            </details>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 px-5 py-2 text-xs text-stone-500">
          <span>{group.matched === 0 ? "No lots match." : `Lots ${group.from} to ${group.to} of ${group.matched}, 50 per page.`}</span>
          {group.pageCount > 1 ? (
            <nav className="flex items-center gap-1" aria-label={`${group.label} pages`}>
              {group.page > 1 ? (
                <Link href={pageHref(group, group.page - 1, q)} className="rounded border border-stone-300 px-2 py-0.5 hover:bg-stone-100">
                  previous
                </Link>
              ) : null}
              {Array.from({ length: group.pageCount }, (_, i) => i + 1).map((p) => (
                <Link key={p} href={pageHref(group, p, q)} className={`num rounded px-2 py-0.5 ${p === group.page ? "bg-stone-800 text-white" : "border border-stone-300 hover:bg-stone-100"}`} aria-current={p === group.page ? "page" : undefined}>
                  {p}
                </Link>
              ))}
              {group.page < group.pageCount ? (
                <Link href={pageHref(group, group.page + 1, q)} className="rounded border border-stone-300 px-2 py-0.5 hover:bg-stone-100">
                  next
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
        <LotTable lots={group.lots} />
      </div>
    </details>
  );
}

export function LotGroups({ view }: { view: SalesView }) {
  return (
    <div className="space-y-4">
      {view.groups.map((g) => (
        <LotGroupSection key={g.id} group={g} q={view.query} open={view.group === null || view.group === g.id || Boolean(view.query)} />
      ))}
    </div>
  );
}
