import Link from "next/link";

/**
 * Client-safe reference links for the record views. RefLink resolves through
 * the packet reference parser, whose module graph reads the packet from disk,
 * so it cannot be bundled into a client component. This mirrors the homes
 * hrefForRef assigns to the reference formats the record forms link to.
 */
export function recordHref(ref: string): string | null {
  if (/^ev-\d+$/.test(ref)) return `/evidence/value/${ref}`;
  if (/^D\d{2}$/.test(ref)) return `/evidence/${ref}`;
  const page = ref.match(/^doc:(D\d{2})#page(\d+)$/);
  if (page) return `/evidence/${page[1]}?page=${page[2]}`;
  if (/^(qa|msg|call)-\d+$/.test(ref)) return `/evidence/client#${ref}`;
  if (/^(py|agency):\//.test(ref)) return `/evidence/records?pointer=${encodeURIComponent(ref)}`;
  if (/^[A-Za-z][A-Za-z0-9]*(?:-[A-Z])?\..+$/.test(ref)) return `/review/line/${encodeURIComponent(ref)}`;
  return null;
}

export function RecordLink({ refId, label, className }: { refId: string; label?: string; className?: string }) {
  const href = recordHref(refId);
  const text = label ?? refId;
  if (!href) return <span className={className ?? "num text-xs text-stone-500"}>{text}</span>;
  return (
    <Link href={href} className={className ?? "num text-xs text-blue-700 hover:underline"} title={refId}>
      {text}
    </Link>
  );
}
