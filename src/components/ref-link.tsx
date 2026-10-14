import Link from "next/link";
import { parseRef } from "@/packet/refs";

/** Where a reference opens in the app. Every ref format has one home. */
export function hrefForRef(ref: string): string | null {
  const p = parseRef(ref);
  switch (p.kind) {
    case "line":
      return `/review/line/${encodeURIComponent(p.key)}`;
    case "document":
      return `/evidence/${p.id}`;
    case "document_page":
      return `/evidence/${p.documentId}?page=${p.page}`;
    case "extracted_value":
      return `/evidence/value/${p.id}`;
    case "questionnaire":
    case "message":
    case "call_note":
      return `/evidence/client#${p.id}`;
    case "prior_year":
      return `/evidence/records?pointer=${encodeURIComponent(`py:${p.pointer}`)}`;
    case "agency":
      return `/evidence/records?pointer=${encodeURIComponent(`agency:${p.pointer}`)}`;
    case "asset":
      return `/review/assets#${p.id}`;
    case "household":
      return `/evidence/records#household-${p.id}`;
    case "parameter":
    case "fx":
      return `/evidence/records#engine-${encodeURIComponent(ref)}`;
    case "timeline":
      return `/changes/timeline#${p.id}`;
    case "version":
      return `/changes/versions?version=${p.id}`;
    case "workpaper":
      return p.table === "adjustment" ? `/changes#${p.id}` : p.table === "finding" ? `/review?finding=${p.id}` : null;
    default:
      return null;
  }
}

/** Renders a reference as a link with an optional plain-language label. */
export function RefLink({ refId, label, className }: { refId: string; label?: string; className?: string }) {
  const href = hrefForRef(refId);
  const text = label ?? refId;
  if (!href) return <span className={className ?? "num text-xs text-stone-500"}>{text}</span>;
  return (
    <Link href={href} className={className ?? "num text-xs text-blue-700 hover:underline"} title={refId}>
      {text}
    </Link>
  );
}
