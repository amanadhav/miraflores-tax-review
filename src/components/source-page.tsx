import type { PageSegment } from "@/server/queries/evidence";

/**
 * The simulated source page. The packet has no page images, so the printed
 * text is the authoritative page; highlights are exact text matches computed
 * on the server (never the packet's synthetic position boxes).
 */
export function SourcePage({
  documentId,
  page,
  segments,
  selectedValue,
  valueLabels,
  anchorLabels,
}: {
  documentId: string;
  page: number;
  segments: PageSegment[];
  selectedValue: string | null;
  valueLabels: Record<string, string>;
  anchorLabels: Record<string, string>;
}) {
  return (
    <div className="rounded-lg border border-stone-300 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
        <span className="font-medium">
          Simulated page: reconstructed from the packet&apos;s printed text for {documentId}, page {page}. No original scan exists.
        </span>
        <span className="flex flex-wrap gap-3">
          <Legend className="bg-yellow-200" label="extracted value, exact match" />
          <Legend className="bg-sky-200" label="manual anchor" />
          <Legend className="bg-rose-100 underline decoration-rose-500 decoration-dashed" label="printed value differs from the extracted one" />
        </span>
      </div>
      <div id="source-page-text" className="whitespace-pre-wrap px-5 py-4 font-serif text-[15px] leading-7 text-stone-900">
        {segments.map((seg, i) => {
          const isValue = seg.values.length > 0;
          const isAnchor = seg.anchors.length > 0;
          const isPrinted = seg.printed.length > 0;
          if (!isValue && !isAnchor && !isPrinted) return <span key={i}>{seg.text}</span>;
          const selected = selectedValue !== null && seg.values.includes(selectedValue);
          const classes = [
            "rounded-sm px-0.5",
            isValue ? "bg-yellow-200" : "",
            isAnchor ? (isValue ? "ring-2 ring-sky-400" : "bg-sky-200") : "",
            isPrinted ? "bg-rose-100 underline decoration-rose-500 decoration-dashed" : "",
            selected ? "outline outline-2 outline-orange-600" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const titles = [
            ...seg.values.map((id) => `${id}: ${valueLabels[id] ?? id}`),
            ...seg.anchors.map((id) => `anchor ${id}: ${anchorLabels[id] ?? ""}`),
            ...seg.printed.map((id) => `printed text located by label heuristic; differs from extracted value ${id}`),
          ];
          const id = seg.values[0] ? `hl-${seg.values[0]}` : seg.anchors[0] ? `hl-${seg.anchors[0]}` : seg.printed[0] ? `printed-${seg.printed[0]}` : undefined;
          return (
            <mark key={i} id={id} className={classes} title={titles.join("; ")} data-values={seg.values.join(" ")} data-anchors={seg.anchors.join(" ")}>
              {seg.text}
            </mark>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-3 w-5 rounded-sm ${className}`} />
      {label}
    </span>
  );
}
