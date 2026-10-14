import Link from "next/link";
import { RefBadge, RefInline } from "@/components/line-refs";
import { formatLineValue, LineStatusBadge, SeverityBadge } from "@/components/line-value";
import { RefLink } from "@/components/ref-link";
import { dateOnly } from "@/lib/format";
import type {
  ClientItemView,
  DiagnosticTrail,
  DocView,
  FindingNote,
  JudgmentNote,
  ParamView,
  RbHeader,
  RbLine,
  TimelineNote,
  ValueView,
  VersionChange,
  WhatIfNote,
} from "@/server/queries/records-b";
import type { RefView } from "@/server/queries/review";

/**
 * Shared building blocks for the CPA record views. Every line key, document
 * and value is a link; every table keeps numbers in the num class; every
 * callout describes an evidence conflict and points at the inspector or the
 * evidence page instead of asserting a tax conclusion.
 */

export const RECORD_VIEWS = [
  { href: "/review/sales", label: "Sales" },
  { href: "/review/rentals", label: "Rentals" },
  { href: "/review/passthroughs", label: "Pass-throughs" },
  { href: "/review/retirement-foreign", label: "Retirement and foreign" },
  { href: "/review/deductions-credits", label: "Deductions and credits" },
  { href: "/review/assets", label: "Depreciation" },
];

export function RecordHeader({ title, lead, header, current }: { title: string; lead: string; header: RbHeader; current: string }) {
  return (
    <section>
      <div className="text-xs text-stone-500">
        <Link href="/review" className="hover:underline">
          Review
        </Link>{" "}
        /{" "}
        <Link href={`/review?area=${encodeURIComponent(header.area.id)}`} className="hover:underline">
          {header.area.label}
        </Link>{" "}
        / {title}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <span className="text-xs text-stone-500">
          Return <span className="num">{header.version}</span> computed <span className="num">{dateOnly(header.computedAt)}</span>, replay clock <span className="num">{dateOnly(header.asOf)}</span>, revision{" "}
          <span className="num">{header.revision}</span>, acting as {header.actor.name} ({header.actor.role})
        </span>
      </div>
      <p className="mt-1 text-sm text-stone-600">{lead}</p>
      <nav className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Record views">
        {RECORD_VIEWS.map((v) => (
          <Link key={v.href} href={v.href} className={v.href === current ? "font-medium text-stone-900 underline" : "text-blue-700 hover:underline"} aria-current={v.href === current ? "page" : undefined}>
            {v.label}
          </Link>
        ))}
      </nav>
    </section>
  );
}

export function Panel({ id, title, hint, children, className }: { id: string; title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`rounded-lg border border-stone-200 bg-white p-5 ${className ?? ""}`}>
      <h2 className="font-medium">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-stone-500">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-4 text-xs font-medium tracking-wide text-stone-500 uppercase first:mt-0">{children}</h3>;
}

const TONES = {
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  red: "border-red-200 bg-red-50 text-red-900",
  blue: "border-blue-200 bg-blue-50 text-blue-900",
  stone: "border-stone-200 bg-stone-50 text-stone-800",
  green: "border-emerald-200 bg-emerald-50 text-emerald-900",
} as const;

export function Note({ tone = "stone", title, children, actions }: { tone?: keyof typeof TONES; title?: string; children: React.ReactNode; actions?: { label: string; href: string }[] }) {
  return (
    <div className={`rounded border p-3 text-sm ${TONES[tone]}`}>
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={title ? "mt-1 text-xs" : "text-xs"}>{children}</div>
      {actions && actions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {actions.map((a) => (
            <Link key={a.href + a.label} href={a.href} className="rounded border border-current/30 bg-white/70 px-2 py-0.5 hover:underline">
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Plain words first, key second. */
export function LineName({ line, note = false }: { line: RbLine; note?: boolean }) {
  return (
    <span>
      <Link href={line.href} className="font-medium hover:underline">
        {line.label}
      </Link>
      <span className="num ml-2 text-[11px] text-stone-500">{line.key}</span>
      {note && line.note ? <span className="mt-0.5 block text-xs text-stone-600">Engine note: {line.note}</span> : null}
    </span>
  );
}

export function LineAmount({ line }: { line: RbLine | null }) {
  if (!line) return <span className="text-xs text-stone-400">not in this version</span>;
  const changed = line.baseline !== line.effective;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`num ${changed ? "font-medium" : ""}`}>{formatLineValue(line.effective)}</span>
      <LineStatusBadge status={line.status} reason={line.statusReason} />
    </span>
  );
}

export function PendingCell({ line }: { line: { href: string; pendingProposals: number; openFindings: number } }) {
  return (
    <span className="num text-xs">
      {line.pendingProposals > 0 ? (
        <Link href={`${line.href}#history`} className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800 hover:underline">
          {line.pendingProposals} proposed
        </Link>
      ) : null}
      {line.openFindings > 0 ? (
        <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800" title={`${line.openFindings} open finding(s) reference this line`}>
          {line.openFindings} finding{line.openFindings === 1 ? "" : "s"}
        </span>
      ) : null}
    </span>
  );
}

/** Compact lines table: label and key, baseline, effective, status, sources, pending. */
export function LineRows({ lines, notes = true, empty = "No lines in this version." }: { lines: RbLine[]; notes?: boolean; empty?: string }) {
  if (lines.length === 0) return <p className="text-xs text-stone-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="py-1 pr-3 font-normal">Line</th>
            <th className="py-1 pr-3 text-right font-normal">Baseline</th>
            <th className="py-1 pr-3 text-right font-normal">Effective</th>
            <th className="py-1 pr-3 font-normal">Status</th>
            <th className="py-1 pr-3 font-normal">Sources</th>
            <th className="py-1 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const changed = l.baseline !== l.effective;
            return (
              <tr key={l.key} id={l.key} className="border-t border-stone-100 align-top">
                <td className="py-1.5 pr-3">
                  <LineName line={l} note={notes} />
                </td>
                <td className="num py-1.5 pr-3 text-right whitespace-nowrap text-stone-500">{formatLineValue(l.baseline)}</td>
                <td className={`num py-1.5 pr-3 text-right whitespace-nowrap ${changed ? "font-medium" : ""}`}>{formatLineValue(l.effective)}</td>
                <td className="py-1.5 pr-3">
                  <LineStatusBadge status={l.status} reason={l.statusReason} changedInputs={l.changedInputs} inline />
                </td>
                <td className="py-1.5 pr-3 text-xs">
                  <RefInline items={l.sources} />
                </td>
                <td className="py-1.5 text-right">
                  <PendingCell line={l} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Availability({ available, availableAt }: { available: boolean; availableAt: string | null }) {
  if (available) return null;
  return (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800" title="Not usable at the current replay clock">
      arrives on {dateOnly(availableAt)}
    </span>
  );
}

export function ValueRows({ values, empty = "No extracted values." }: { values: ValueView[]; empty?: string }) {
  if (values.length === 0) return <p className="text-xs text-stone-500">{empty}</p>;
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-stone-500">
        <tr>
          <th className="py-1 pr-2 font-normal">Value</th>
          <th className="py-1 pr-2 text-right font-normal">Read as</th>
          <th className="py-1 pr-2 text-right font-normal">Conf.</th>
          <th className="py-1 font-normal">Used by</th>
        </tr>
      </thead>
      <tbody>
        {values.map((v) => (
          <tr key={v.id} className="border-t border-stone-100 align-top">
            <td className="py-1 pr-2">
              <Link href={v.href} className="text-blue-700 hover:underline">
                {v.label}
              </Link>
              <span className="num ml-1 text-[11px] text-stone-400">
                {v.id}, p{v.page}
              </span>
            </td>
            <td className="num py-1 pr-2 text-right whitespace-nowrap">{v.available ? v.display : <Availability available={false} availableAt={v.availableAt} />}</td>
            <td className={`num py-1 pr-2 text-right ${v.confidence < 0.7 ? "font-medium text-red-700" : "text-stone-500"}`}>{v.available ? v.confidence.toFixed(2) : ""}</td>
            <td className="py-1">
              {v.usedBy.length === 0 ? (
                <span className="text-stone-400">no line cites it</span>
              ) : (
                v.usedBy.map((k, i) => (
                  <span key={k}>
                    {i > 0 ? ", " : ""}
                    <RefLink refId={k} />
                  </span>
                ))
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DocCard({ doc, values = true, pages = false, role }: { doc: DocView; values?: boolean; pages?: boolean; role?: string }) {
  return (
    <div id={`doc-${doc.id}`} className="rounded border border-stone-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Link href={doc.href} className="font-medium hover:underline">
            {doc.title}
          </Link>
          <span className="num ml-2 text-[11px] text-stone-500">{doc.id}</span>
          {role ? <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-700">{role}</span> : null}
          {doc.markedCorrected ? <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] text-blue-800">corrected</span> : null}
        </div>
        <Availability available={doc.available} availableAt={doc.receivedAt} />
      </div>
      <p className="mt-0.5 text-xs text-stone-500">
        {doc.typeLabel}, {doc.issuer}, {doc.belongsTo}. Received <span className="num">{dateOnly(doc.receivedAt)}</span>, <span className="num">{doc.pageCount}</span> page{doc.pageCount === 1 ? "" : "s"}, extraction{" "}
        {doc.extraction.status} ({doc.extraction.values} values){doc.extraction.reason ? `: ${doc.extraction.reason}` : ""}.
      </p>
      {!doc.available ? (
        <p className="mt-1 text-xs text-amber-800">Content is not shown: this document arrives after the replay clock.</p>
      ) : (
        <>
          {pages && doc.pages.length > 0 ? (
            <div className="mt-2 space-y-1">
              {doc.pages.map((p) => (
                <p key={p.page} className="rounded bg-stone-50 p-2 text-xs text-stone-700">
                  <Link href={p.href} className="num mr-1 text-blue-700 hover:underline">
                    p{p.page}
                  </Link>
                  {p.text}
                </p>
              ))}
            </div>
          ) : null}
          {values ? (
            <div className="mt-2">
              <ValueRows values={doc.values} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function DocList({ docs, values = true, roles }: { docs: DocView[]; values?: boolean; roles?: Record<string, string> }) {
  if (docs.length === 0) return <p className="text-xs text-stone-500">No documents.</p>;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {docs.map((d) => (
        <DocCard key={d.id} doc={d} values={values} role={roles?.[d.id]} />
      ))}
    </div>
  );
}

export function ParamChips({ params }: { params: ParamView[] }) {
  if (params.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {params.map((p) => (
        <span key={p.name} className="inline-flex items-baseline gap-1 rounded border border-stone-200 bg-stone-50 px-2 py-0.5">
          <span className="text-stone-600">{p.label}</span>
          <span className="num font-medium">{p.display}</span>
          <RefLink refId={p.ref} label={p.ref} className="num text-[11px] text-blue-700 hover:underline" />
        </span>
      ))}
    </div>
  );
}

export function FindingChip({ finding }: { finding: FindingNote }) {
  return (
    <div className="rounded border border-stone-200 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={finding.severity} blocksFiling={finding.blocksFiling} />
        <Link href={finding.href} className="font-medium hover:underline">
          {finding.title}
        </Link>
        {finding.code ? <span className="num text-stone-400">{finding.code}</span> : null}
        <span className={`rounded px-1.5 py-0.5 ${finding.status === "open" ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-600"}`}>{finding.status}</span>
      </div>
      <p className="mt-1 text-stone-700">{finding.detail}</p>
      {finding.refs.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {finding.refs.map((r) => (
            <RefBadge key={r.ref} item={r} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ClientItemCard({ item }: { item: ClientItemView }) {
  return (
    <div id={`client-${item.id}`} className="rounded border border-stone-200 p-2 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <Link href={item.href} className="font-medium hover:underline">
            {item.label}
          </Link>
          <span className="num ml-2 text-[11px] text-stone-400">{item.id}</span>
          {item.by ? <span className="ml-2 text-stone-500">{item.by}</span> : null}
          {item.at ? <span className="num ml-2 text-stone-500">{dateOnly(item.at)}</span> : null}
        </span>
        <Availability available={item.available} availableAt={item.at} />
      </div>
      {item.text !== null ? <p className="mt-1 text-stone-700">{item.text}</p> : <p className="mt-1 text-amber-800">Content not shown until the replay clock reaches it.</p>}
    </div>
  );
}

export function ClientItems({ items, empty = "No client items." }: { items: ClientItemView[]; empty?: string }) {
  if (items.length === 0) return <p className="text-xs text-stone-500">{empty}</p>;
  return (
    <div className="space-y-1.5">
      {items.map((i) => (
        <ClientItemCard key={i.id} item={i} />
      ))}
    </div>
  );
}

export function TrailTable({ trail }: { trail: DiagnosticTrail }) {
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="num font-medium">{trail.code}</span>
        <span className={`rounded px-1.5 py-0.5 ${trail.active ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{trail.active ? "raised in the active version" : "not raised in the active version"}</span>
        {trail.finding ? (
          <Link href={trail.finding.href} className="text-blue-700 hover:underline">
            finding {trail.finding.id} is {trail.finding.status}
          </Link>
        ) : (
          <span className="text-stone-500">no finding seeded in this workspace</span>
        )}
      </div>
      <table className="mt-1 w-full">
        <thead className="text-left text-stone-500">
          <tr>
            <th className="py-0.5 pr-2 font-normal">Version</th>
            <th className="py-0.5 pr-2 font-normal">Computed</th>
            <th className="py-0.5 pr-2 font-normal">Diagnostic</th>
          </tr>
        </thead>
        <tbody>
          {trail.versions.map((v) => (
            <tr key={v.version} className="border-t border-stone-100 align-top">
              <td className="num py-0.5 pr-2">
                <RefLink refId={v.version} label={v.version} className="num text-blue-700 hover:underline" />
              </td>
              <td className="num py-0.5 pr-2">{dateOnly(v.computedAt)}</td>
              <td className="py-0.5 pr-2">
                {v.present ? (
                  <span>
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">raised</span> {v.message}
                    {v.refs.length > 0 ? (
                      <span className="ml-1">
                        {v.refs.map((r) => (
                          <span key={r.ref} className="mr-2">
                            <RefLink refId={r.ref} />
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">not raised</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function JudgmentList({ items, href, subject }: { items: JudgmentNote[]; href: string; subject: string }) {
  return (
    <div className="text-xs">
      {items.length === 0 ? (
        <p className="text-stone-500">No judgment recorded on {subject} yet.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((j) => (
            <li key={j.id} className="rounded border border-stone-200 p-2">
              <span className="rounded bg-stone-100 px-1.5 py-0.5">{j.kind.replace(/_/g, " ")}</span> <span className="font-medium">{j.title}</span>
              <span className="ml-2 text-stone-500">
                {j.decidedBy?.name ?? "unknown"}, revision <span className="num">{j.createdRevision}</span>, {j.status}
              </span>
              <p className="mt-1 text-stone-700">{j.conclusion}</p>
            </li>
          ))}
        </ul>
      )}
      <Link href={href} className="mt-1 inline-block text-blue-700 hover:underline">
        Record or review judgments on <span className="num">{subject}</span>
      </Link>
    </div>
  );
}

export function TimelineList({ events }: { events: TimelineNote[] }) {
  if (events.length === 0) return <p className="text-xs text-stone-500">No timeline events.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {events.map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline gap-2">
          <span className="num text-stone-500">{dateOnly(e.at)}</span>
          <RefLink refId={`timeline:${e.id}`} label={e.event} className="text-blue-700 hover:underline" />
          {e.detail ? <span className="text-stone-700">{e.detail}</span> : null}
          {e.refs.map((r) => (
            <RefLink key={r.ref} refId={r.ref} />
          ))}
          <Availability available={e.available} availableAt={e.at} />
        </li>
      ))}
    </ul>
  );
}

export function ChangeTable({ changes, caption }: { changes: VersionChange[]; caption?: string }) {
  if (changes.length === 0) return <p className="text-xs text-stone-500">No line changes.</p>;
  return (
    <table className="w-full text-xs">
      {caption ? <caption className="pb-1 text-left text-stone-500">{caption}</caption> : null}
      <thead className="text-left text-stone-500">
        <tr>
          <th className="py-0.5 pr-2 font-normal">Line</th>
          <th className="py-0.5 pr-2 font-normal">Change</th>
          <th className="py-0.5 pr-2 text-right font-normal">Before</th>
          <th className="py-0.5 text-right font-normal">After</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.key} className="border-t border-stone-100">
            <td className="py-0.5 pr-2">
              {c.label} <RefLink refId={c.key} />
            </td>
            <td className="py-0.5 pr-2">{c.change}</td>
            <td className="num py-0.5 pr-2 text-right">{c.old === null ? "" : formatLineValue(c.old)}</td>
            <td className="num py-0.5 text-right">{c.new === null ? "" : formatLineValue(c.new)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WhatIfBox({ note }: { note: WhatIfNote }) {
  return (
    <Note tone="blue" title={`Engine what-if (supplied): ${note.description}`} actions={[{ label: "Open the what-if comparison", href: note.href }]}>
      <p>
        Results as supplied by the engine for <span className="num">{note.id}</span> on {note.baseVersion}: federal tax change <span className="num font-medium">{formatLineValue(note.federalTaxChange)}</span>,
        California tax change <span className="num font-medium">{formatLineValue(note.californiaTaxChange)}</span>. Shown as supplied; not combined with any workpaper adjustment and not an estimate from the per-dollar
        rates.
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer text-blue-800">Lines the what-if changes ({note.changedLines.length})</summary>
        <div className="mt-1">
          <ChangeTable changes={note.changedLines} />
        </div>
      </details>
    </Note>
  );
}

export function RefChips({ refs }: { refs: RefView[] }) {
  if (refs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
      {refs.map((r) => (
        <RefBadge key={r.ref} item={r} />
      ))}
    </div>
  );
}

export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-stone-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Facts({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">{children}</dl>;
}
