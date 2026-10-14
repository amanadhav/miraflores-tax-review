import Link from "next/link";
import { RefInline } from "@/components/line-refs";
import { formatLineValue, LineStatusBadge } from "@/components/line-value";
import { RefLink } from "@/components/ref-link";
import { dateOnly } from "@/lib/format";
import type { LineCell, LineCellWithSources, ViewMeta } from "@/server/queries/records-a";

/** The CPA record views, in the order a reviewer walks them. */
export const RECORD_VIEWS = [
  { id: "summary", href: "/review/summary", label: "Summary vs last year" },
  { id: "variance", href: "/review/variance", label: "Variance" },
  { id: "bridge", href: "/review/bridge", label: "Books to tax" },
  { id: "california", href: "/review/california", label: "California" },
  { id: "payments", href: "/review/payments", label: "Payments" },
  { id: "carryovers", href: "/review/carryovers", label: "Carryovers" },
] as const;

export type RecordViewId = (typeof RECORD_VIEWS)[number]["id"];

export function lineHref(key: string): string {
  return `/review/line/${encodeURIComponent(key)}`;
}

/** Breadcrumb, title, the replay meta line and the strip of sibling record views. */
export function RecordsHeader({ current, title, intro, meta }: { current: RecordViewId; title: string; intro: string; meta: ViewMeta }) {
  return (
    <section>
      <div className="text-xs text-stone-500">
        <Link href="/review" className="hover:underline">
          Review
        </Link>{" "}
        / Records / {title}
      </div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-stone-600">{intro}</p>
      <p className="mt-1 text-xs text-stone-500">
        Return version <span className="num">{meta.version}</span> computed <span className="num">{dateOnly(meta.computedAt)}</span>, replay clock{" "}
        <span className="num">{dateOnly(meta.asOf)}</span>, revision <span className="num">{meta.revision}</span>, acting as {meta.actor.name} ({meta.actor.role}).
      </p>
      <nav className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="Record views">
        {RECORD_VIEWS.map((r) => {
          const active = r.id === current;
          return (
            <Link
              key={r.id}
              href={r.href}
              aria-current={active ? "page" : undefined}
              className={`rounded border px-2 py-1 ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"}`}
            >
              {r.label}
            </Link>
          );
        })}
        <Link href="/review/assets" className="rounded border border-stone-200 bg-white px-2 py-1 text-stone-700 hover:bg-stone-50">
          Depreciation by asset
        </Link>
      </nav>
    </section>
  );
}

export function Panel({ id, title, hint, children, count }: { id: string; title: string; hint?: string; children: React.ReactNode; count?: number | string }) {
  return (
    <section id={id} className="rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="font-medium">
        {title}
        {count !== undefined ? <span className="num ml-2 text-sm font-normal text-stone-500">{count}</span> : null}
      </h2>
      {hint ? <p className="mt-0.5 text-xs text-stone-500">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A statement the reviewer must not miss: amber for caution, emerald for agreement, stone for plain facts. */
export function Statement({ tone = "stone", children }: { tone?: "amber" | "emerald" | "red" | "stone"; children: React.ReactNode }) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-900"
          : "border-stone-200 bg-stone-50 text-stone-800";
  return <div className={`rounded border p-3 text-sm ${cls}`}>{children}</div>;
}

export function Amount({ value, className = "" }: { value: number | string | boolean | null | undefined; className?: string }) {
  return <span className={`num ${className}`}>{formatLineValue(value)}</span>;
}

export function Unknown({ text = "unknown" }: { text?: string }) {
  return <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600">{text}</span>;
}

/** Plain name first, key second: the label links to the line inspector. */
export function LineName({ cell, showForm = false }: { cell: Pick<LineCell, "key" | "label" | "form" | "line">; showForm?: boolean }) {
  return (
    <span>
      <Link href={lineHref(cell.key)} className="font-medium hover:underline">
        {cell.label}
      </Link>
      <span className="num ml-2 text-[11px] text-stone-500">
        {cell.key}
        {showForm ? ` (${cell.form} line ${cell.line})` : ""}
      </span>
    </span>
  );
}

/** Key-only link for a line, when the label is already shown or too long. */
export function LineKey({ cell }: { cell: Pick<LineCell, "key" | "label"> }) {
  return <RefLink refId={cell.key} label={cell.key} className="num text-xs text-blue-700 hover:underline" />;
}

export function StatusCell({ cell }: { cell: Pick<LineCell, "status" | "statusReason" | "changedInputs"> }) {
  return <LineStatusBadge status={cell.status} reason={cell.statusReason} changedInputs={cell.changedInputs} inline />;
}

const th = "px-3 py-2 font-normal";
const td = "px-3 py-1.5 align-top";

/** Compact table of lines: name, baseline, effective, status, rule and (optionally) sources. */
export function LineTableCompact({
  cells,
  empty = "No lines in this version.",
  showSources = false,
  showRule = true,
  showJurisdiction = false,
}: {
  cells: (LineCell | LineCellWithSources)[];
  empty?: string;
  showSources?: boolean;
  showRule?: boolean;
  showJurisdiction?: boolean;
}) {
  if (cells.length === 0) return <p className="px-3 py-3 text-sm text-stone-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className={th}>Line</th>
            <th className={`${th} text-right`}>Baseline</th>
            <th className={`${th} text-right`}>Effective</th>
            <th className={th}>Status</th>
            {showRule ? <th className={th}>Rule</th> : null}
            {showJurisdiction ? <th className={th}>Juris.</th> : null}
            {showSources ? <th className={th}>Sources</th> : null}
          </tr>
        </thead>
        <tbody>
          {cells.map((c) => {
            const changed = c.baseline !== c.effective;
            return (
              <tr key={c.key} id={c.key} className="border-t border-stone-100 hover:bg-stone-50">
                <td className={td}>
                  <LineName cell={c} />
                  {c.note ? <div className="mt-0.5 text-[11px] text-stone-500">{c.note}</div> : null}
                </td>
                <td className={`${td} num text-right whitespace-nowrap text-stone-500`}>{formatLineValue(c.baseline)}</td>
                <td className={`${td} num text-right whitespace-nowrap ${changed ? "font-medium" : ""}`}>{formatLineValue(c.effective)}</td>
                <td className={td}>
                  <StatusCell cell={c} />
                </td>
                {showRule ? (
                  <td className={`${td} text-xs text-stone-600`}>
                    <span className="num" title={c.ruleText}>
                      {c.rule}
                    </span>
                  </td>
                ) : null}
                {showJurisdiction ? <td className={`${td} text-xs text-stone-600`}>{c.jurisdiction === "california" ? "CA" : "Fed"}</td> : null}
                {showSources ? <td className={td}>{"sources" in c ? <RefInline items={c.sources} /> : null}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One line as a short inline fact: label, key, effective value and status. */
export function LineFact({ cell, missing = "not in this version" }: { cell: LineCell | null; missing?: string }) {
  if (!cell) return <span className="text-xs text-stone-400">{missing}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <LineName cell={cell} />
      <Amount value={cell.effective} />
      <StatusCell cell={cell} />
    </span>
  );
}
