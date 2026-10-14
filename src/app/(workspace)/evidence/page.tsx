import Link from "next/link";
import { DispositionBadge } from "@/components/evidence-badges";
import { dateOnly } from "@/lib/format";
import { requireSessionContext } from "@/server/request";
import { DISPOSITION_LABELS, loadDocumentIndex, type Disposition, type DocumentIndexRow } from "@/server/queries/evidence";

export const dynamic = "force-dynamic";

const DISPOSITIONS = Object.keys(DISPOSITION_LABELS) as Disposition[];

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function href(params: { area?: string; disposition?: string; group?: string }): string {
  const q = new URLSearchParams();
  if (params.area) q.set("area", params.area);
  if (params.disposition) q.set("disposition", params.disposition);
  if (params.group) q.set("group", params.group);
  const s = q.toString();
  return s ? `/evidence?${s}` : "/evidence";
}

export default async function EvidenceIndexPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSessionContext();
  const sp = await searchParams;
  const area = one(sp.area);
  const disposition = one(sp.disposition) as Disposition | undefined;
  const group = one(sp.group) === "none" ? "none" : "area";
  const index = await loadDocumentIndex(ctx);
  const rows = index.rows.filter((r) => (!area || r.area === area) && (!disposition || r.disposition === disposition));
  const groups: { id: string; label: string; rows: DocumentIndexRow[] }[] =
    group === "area"
      ? index.areas.map((a) => ({ id: a.id, label: a.label, rows: rows.filter((r) => r.area === a.id) })).filter((g) => g.rows.length > 0)
      : [{ id: "all", label: "All documents", rows }];

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Evidence</h1>
          <p className="mt-1 text-sm text-stone-600">
            {index.rows.length} documents in the packet. Uses are counted against return version {index.version}; availability follows the replay
            clock <span className="num">{dateOnly(index.asOf)}</span>. Documents that arrive later are listed but their pages are not viewable.
          </p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href="/evidence/client" className="text-blue-700 hover:underline">
            Client answers, messages and calls
          </Link>
          <Link href="/evidence/records" className="text-blue-700 hover:underline">
            Prior years, agency and household records
          </Link>
          <span className="mx-2 text-stone-300">|</span>
          <Link href="/evidence/completeness" className="text-blue-700 hover:underline">
            Completeness
          </Link>
        </nav>
      </section>

      <section className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-stone-500">Disposition:</span>
        <FilterChip active={!disposition} href={href({ area, group })} label={`all ${index.rows.length}`} />
        {DISPOSITIONS.map((d) => (
          <FilterChip key={d} active={disposition === d} href={href({ area, disposition: d, group })} label={`${DISPOSITION_LABELS[d]} ${index.counts[d]}`} />
        ))}
        <span className="ml-4 text-stone-500">Area:</span>
        <FilterChip active={!area} href={href({ disposition, group })} label="all areas" />
        {index.areas.map((a) => (
          <FilterChip key={a.id} active={area === a.id} href={href({ area: a.id, disposition, group })} label={`${a.label} ${a.count}`} />
        ))}
        <span className="ml-4 text-stone-500">Group:</span>
        <FilterChip active={group === "area"} href={href({ area, disposition })} label="by area" />
        <FilterChip active={group === "none"} href={href({ area, disposition, group: "none" })} label="flat list" />
      </section>

      {rows.length === 0 ? <p className="text-sm text-stone-500">No documents match these filters.</p> : null}

      {groups.map((g) => (
        <section key={g.id} className="rounded-lg border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
            <h2 className="font-medium">{g.label}</h2>
            <span className="text-xs text-stone-500">{g.rows.length} document(s)</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-5 py-2 font-normal">Document</th>
                <th className="px-2 py-2 font-normal">Type</th>
                <th className="px-2 py-2 font-normal">Issuer</th>
                <th className="px-2 py-2 font-normal">Belongs to</th>
                <th className="px-2 py-2 font-normal">Received</th>
                <th className="px-2 py-2 text-right font-normal">Pages</th>
                <th className="px-2 py-2 font-normal">Extraction</th>
                <th className="px-2 py-2 text-right font-normal" title="Active-version return lines that cite one of this document's extracted values">
                  Direct uses
                </th>
                <th className="px-2 py-2 font-normal">Disposition</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.id} className={`border-t border-stone-100 align-top ${r.available ? "" : "text-stone-500"}`}>
                  <td className="px-5 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="num text-xs text-stone-500">{r.id}</span>
                      {r.available ? (
                        <Link href={`/evidence/${r.id}`} className="font-medium hover:underline">
                          {r.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.title}</span>
                      )}
                      {r.markedCorrected ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">corrected</span> : null}
                    </div>
                    {group === "none" ? <div className="text-xs text-stone-500">{r.areaLabel}</div> : null}
                    {r.supersededBy ? (
                      <div className="text-xs text-amber-800">
                        Superseded by{" "}
                        <Link href={`/evidence/${r.supersededBy}`} className="num hover:underline">
                          {r.supersededBy}
                        </Link>{" "}
                        in {index.version}
                      </div>
                    ) : null}
                    {r.supersedes ? (
                      <div className="text-xs text-stone-500">
                        Supersedes <span className="num">{r.supersedes}</span>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">{r.typeLabel}</td>
                  <td className="px-2 py-2">{r.issuer}</td>
                  <td className="px-2 py-2">{r.belongsToLabel}</td>
                  <td className="num px-2 py-2 whitespace-nowrap">
                    {r.available ? dateOnly(r.receivedAt) : <span className="text-amber-800">arrives on {dateOnly(r.receivedAt)}</span>}
                    <div className="text-xs text-stone-400">by {r.uploadedBy}</div>
                  </td>
                  <td className="num px-2 py-2 text-right">{r.pageCount}</td>
                  <td className="px-2 py-2">
                    <span className={r.extractionStatus === "extracted" ? "" : r.extractionStatus === "partial" ? "text-amber-800" : "text-stone-500"}>
                      {r.extractionStatus.replace(/_/g, " ")}
                    </span>
                    <span className="num ml-1 text-xs text-stone-500">{r.extractionValues} values</span>
                    {r.extractionReason ? <div className="max-w-xs text-xs text-stone-500">{r.extractionReason}</div> : null}
                  </td>
                  <td className="num px-2 py-2 text-right">
                    {r.directUses}
                    {r.usedValues ? <div className="text-xs text-stone-400">{r.usedValues} values</div> : null}
                    {r.workpaperUses ? <div className="text-xs text-stone-400">{r.workpaperUses} workpaper</div> : null}
                  </td>
                  <td className="px-2 py-2">
                    <DispositionBadge disposition={r.disposition} label={r.dispositionLabel} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function FilterChip({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link href={href} className={`rounded-full border px-2.5 py-0.5 ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100"}`}>
      {label}
    </Link>
  );
}
